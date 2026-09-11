import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { retrieveAndSyncStripeSubscription, syncStripeSubscription } from "../../../../lib/stripe/subscriptions";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function validSignature(payload: string, header: string, secret: string) {
  const values = header.split(",").reduce<Record<string, string[]>>((all, part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return all;
    const key = part.slice(0, separator);
    (all[key] ||= []).push(part.slice(separator + 1));
    return all;
  }, {});
  const timestamp = values.t?.[0];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return (values.v1 || []).some((signature) => {
    try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex")); }
    catch { return false; }
  });
}

function objectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id?: unknown }).id || "");
  return "";
}

function invoiceSubscriptionId(invoice: Record<string, any>) {
  return objectId(invoice.subscription) || objectId(invoice.parent?.subscription_details?.subscription);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !serviceKey || !stripeKey) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!validSignature(payload, signature, secret)) return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  let event: { id?: string; type?: string; data?: { object?: Record<string, any> } };
  try { event = JSON.parse(payload); }
  catch { return NextResponse.json({ error: "Invalid payload." }, { status: 400 }); }
  if (!event.id || !event.type) return NextResponse.json({ error: "Stripe event ID and type are required." }, { status: 400 });

  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await service.from("stripe_webhook_events").select("processing_status,attempts").eq("event_id", event.id).maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (existing?.processing_status === "completed") return NextResponse.json({ received: true, duplicate: true });
  const eventRecord = { event_id: event.id, event_type: event.type, processing_status: "processing", attempts: Number(existing?.attempts || 0) + 1, last_error: null, updated_at: now };
  const { error: recordError } = existing
    ? await service.from("stripe_webhook_events").update(eventRecord).eq("event_id", event.id)
    : await service.from("stripe_webhook_events").insert(eventRecord);
  if (recordError) return NextResponse.json({ error: recordError.message }, { status: 500 });

  const object = event.data?.object || {};
  try {
    if (event.type === "checkout.session.completed" && object.metadata?.refassign_subscription_id) {
      const subscriptionId = objectId(object.subscription);
      if (!subscriptionId) throw new Error("Completed subscription checkout has no Stripe subscription ID.");
      await retrieveAndSyncStripeSubscription(service, subscriptionId, stripeKey);
      const { error } = await service.from("refassign_subscriptions").update({ stripe_checkout_session_id: object.id, stripe_customer_id: objectId(object.customer) || null, updated_at: now }).eq("id", object.metadata.refassign_subscription_id);
      if (error) throw error;
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.trial_will_end"].includes(event.type)) {
      await syncStripeSubscription(service, object as any);
    } else if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const subscriptionId = invoiceSubscriptionId(object);
      if (subscriptionId) await retrieveAndSyncStripeSubscription(service, subscriptionId, stripeKey);
    } else if (["invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
      const subscriptionId = invoiceSubscriptionId(object);
      if (subscriptionId) {
        const { error } = await service.from("refassign_subscriptions").update({ status: "past_due", updated_at: now }).eq("stripe_subscription_id", subscriptionId);
        if (error) throw error;
      }
    } else if (event.type === "checkout.session.expired" && object.metadata?.refassign_subscription_id) {
      const { error } = await service.from("refassign_subscriptions").update({ status: "checkout_error", updated_at: now }).eq("id", object.metadata.refassign_subscription_id).eq("status", "pending");
      if (error) throw error;
    } else if (event.type === "checkout.session.completed" && object.payment_status === "paid") {
      await processOfficialRegistrationPayment(service, object, now);
    }
    const { error: completedError } = await service.from("stripe_webhook_events").update({ processing_status: "completed", processed_at: now, updated_at: now }).eq("event_id", event.id);
    if (completedError) throw completedError;
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe event processing failed.";
    await service.from("stripe_webhook_events").update({ processing_status: "failed", last_error: message.slice(0, 1000), updated_at: now }).eq("event_id", event.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processOfficialRegistrationPayment(service: any, object: Record<string, any>, now: string) {
  const registrationId = object.metadata?.registration_id;
  if (!registrationId) return;
  const { data: registration, error } = await service.from("official_registrations").update({ status: "paid", payment_status: "paid", stripe_checkout_session_id: object.id, stripe_payment_intent_id: objectId(object.payment_intent) || null, paid_at: now, updated_at: now }).eq("id", registrationId).select("id,first_name,last_name,email,registration_year,registrar_notified_at,registration_program_id,registration_programs(name)").single();
  if (error) throw error;
  if (registration.registrar_notified_at || !process.env.RESEND_API_KEY) return;
  const [{ data: roles }, { data: owners }] = await Promise.all([
    service.from("registration_program_staff").select("user_id").eq("program_id", registration.registration_program_id),
    service.from("protected_accounts").select("user_id"),
  ]);
  const emails: string[] = [];
  for (const role of [...(roles || []), ...(owners || [])]) {
    const { data } = await service.auth.admin.getUserById(role.user_id);
    if (data.user?.email) emails.push(data.user.email);
  }
  const recipients = [...new Set(emails)];
  if (!recipients.length) return;
  const program = Array.isArray(registration.registration_programs) ? registration.registration_programs[0] : registration.registration_programs;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `registrar-registration-${registration.id}` }, body: JSON.stringify({ from: "RefAssign <notifications@assignments.ref-assign.com>", to: recipients, reply_to: "assignments@ref-assign.com", subject: `New paid official registration: ${registration.first_name} ${registration.last_name}`, html: `<div style="font-family:Arial,sans-serif"><h2>New Official Registration</h2><p><b>${escapeHtml(registration.first_name)} ${escapeHtml(registration.last_name)}</b> has completed the ${escapeHtml(registration.registration_year)} registration payment for ${escapeHtml(program?.name || "Iowa Soccer")}.</p><p>${escapeHtml(registration.email)}</p><p>Sign in to RefAssign and open Registrar to approve eligibility.</p></div>` }) });
  if (!response.ok) throw new Error(`Registrar notification failed (${response.status}).`);
  const { error: notificationError } = await service.from("official_registrations").update({ registrar_notified_at: now }).eq("id", registration.id);
  if (notificationError) throw notificationError;
}
