import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { retrieveAndSyncStripeSubscription, syncStripeSubscription } from "../../../../lib/stripe/subscriptions";
import { sendBillingStatusNotifications } from "../../../../lib/billing/paymentNotifications";
import { connectedAccountState, organizationRecipientState, stripeConnectRequest, stripeConnectV2Request, StripeConnectedAccount, StripeConnectedAccountV2 } from "../../../../lib/stripe/connect";
import { stripeConnectConfig } from "../../../../lib/stripe/runtime";

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
  let event: { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, any> } };
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
    if (event.type === "account.updated") {
      const account = object as StripeConnectedAccount;
      const officialId = String(object.metadata?.refassign_official_id || "");
      const organizationId = String(object.metadata?.refassign_organization_id || "");
      const stripeMode = event.livemode ? "live" : "sandbox";
      if (organizationId) {
        const v2Account = await stripeConnectV2Request<StripeConnectedAccountV2>(`core/accounts/${encodeURIComponent(account.id)}?include[]=configuration.recipient&include[]=requirements`, stripeKey);
        const result = await service.from("organization_stripe_accounts").upsert({ organization_id: organizationId, stripe_mode: stripeMode, stripe_account_id: account.id, ...organizationRecipientState(v2Account) }, { onConflict: "organization_id,stripe_mode" });
        if (result.error) throw result.error;
      } else {
       const values = { stripe_mode: stripeMode, stripe_account_id: account.id, ...connectedAccountState(account) };
       const result = officialId
        ? await service.from("official_stripe_accounts").upsert({ official_id: officialId, ...values }, { onConflict: "official_id,stripe_mode" })
        : await service.from("official_stripe_accounts").update(values).eq("stripe_account_id", account.id).eq("stripe_mode", stripeMode);
       if (result.error) throw result.error;
      }
    } else if (event.type === "checkout.session.completed" && object.metadata?.refassign_subscription_id) {
      const subscriptionId = objectId(object.subscription);
      if (!subscriptionId) throw new Error("Completed subscription checkout has no Stripe subscription ID.");
      await retrieveAndSyncStripeSubscription(service, subscriptionId, stripeKey);
      const { error } = await service.from("refassign_subscriptions").update({ stripe_checkout_session_id: object.id, stripe_customer_id: objectId(object.customer) || null, updated_at: now }).eq("id", object.metadata.refassign_subscription_id);
      if (error) throw error;
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.trial_will_end"].includes(event.type)) {
      const { data: before } = event.type === "customer.subscription.updated"
        ? await service.from("refassign_subscriptions").select("status").eq("stripe_subscription_id", objectId(object)).maybeSingle()
        : { data: null };
      await syncStripeSubscription(service, object as any);
      if (event.type === "customer.subscription.updated" && before && !["active", "trialing"].includes(before.status) && ["active", "trialing"].includes(String(object.status))) {
        await sendBillingStatusNotifications(service, { eventId: event.id, subscriptionId: objectId(object), notice: "payment_recovered", origin: new URL(request.url).origin });
      }
    } else if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const subscriptionId = invoiceSubscriptionId(object);
      if (subscriptionId) {
        const { data: before } = await service.from("refassign_subscriptions").select("status").eq("stripe_subscription_id", subscriptionId).maybeSingle();
        await retrieveAndSyncStripeSubscription(service, subscriptionId, stripeKey);
        const { data: after } = await service.from("refassign_subscriptions").select("status").eq("stripe_subscription_id", subscriptionId).maybeSingle();
        if (before && !["active", "trialing"].includes(before.status) && after && ["active", "trialing"].includes(after.status)) {
          await sendBillingStatusNotifications(service, { eventId: event.id, subscriptionId, notice: "payment_recovered", origin: new URL(request.url).origin });
        }
      }
    } else if (["invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
      const subscriptionId = invoiceSubscriptionId(object);
      if (subscriptionId) {
        const { error } = await service.from("refassign_subscriptions").update({ status: "past_due", updated_at: now }).eq("stripe_subscription_id", subscriptionId);
        if (error) throw error;
        await sendBillingStatusNotifications(service, { eventId: event.id, subscriptionId, notice: "payment_failed", origin: new URL(request.url).origin });
      }
    } else if (event.type === "checkout.session.expired" && object.metadata?.refassign_subscription_id) {
      const { error } = await service.from("refassign_subscriptions").update({ status: "checkout_error", updated_at: now }).eq("id", object.metadata.refassign_subscription_id).eq("status", "pending");
      if (error) throw error;
    } else if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && object.payment_status === "paid") {
      await processOfficialRegistrationPayment(service, object, now, stripeKey, event.id);
    } else if (event.type === "checkout.session.async_payment_failed" && object.metadata?.registration_id) {
      await service.from("payment_transactions").update({ status: "failed", failure_message: "Stripe could not complete the registration payment.", occurred_at: now }).eq("stripe_object_type", "checkout_session").eq("stripe_object_id", object.id);
    } else if (event.type === "charge.refunded") {
      await processRegistrationRefund(service, object, now, event.id);
    } else if (event.type === "charge.dispute.created") {
      await processRegistrationDispute(service, object, now, event.id, stripeKey);
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

async function processOfficialRegistrationPayment(service: any, object: Record<string, any>, now: string, stripeKey: string, eventId: string) {
  const registrationId = object.metadata?.registration_id;
  if (!registrationId) return;
  const paymentIntentId = objectId(object.payment_intent);
  const paymentIntent = paymentIntentId ? await stripeConnectRequest<Record<string, any>>(`payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`, stripeKey) : null;
  const charge = paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
  const chargeId = objectId(charge) || objectId(paymentIntent?.latest_charge);
  const transferId = objectId(charge?.transfer);
  const { data: registration, error } = await service.from("official_registrations").update({ status: "paid", payment_status: "paid", stripe_checkout_session_id: object.id, stripe_payment_intent_id: paymentIntentId || null, stripe_charge_id: chargeId || null, stripe_transfer_id: transferId || null, paid_at: now, updated_at: now }).eq("id", registrationId).select("id,organization_id,first_name,last_name,email,registration_year,registrar_notified_at,registration_program_id,registration_amount_cents,platform_fee_cents,processing_surcharge_cents,total_charged_cents,registration_programs(name)").single();
  if (error) throw error;
  await Promise.all([
    service.from("payment_transactions").update({ status: "succeeded", stripe_object_type: "payment_intent", stripe_object_id: paymentIntentId || object.id, occurred_at: now }).eq("related_record_id", registrationId).eq("transaction_type", "registration").eq("direction", "credit"),
    service.from("payment_transactions").upsert({ organization_id: registration.organization_id, transaction_type: "registration", related_record_id: registrationId, direction: "fee", status: "succeeded", amount_cents: Number(registration.platform_fee_cents || 0), idempotency_key: `registration-${registrationId}-platform-fee` }, { onConflict: "idempotency_key" }),
    service.from("payment_transactions").upsert({ organization_id: registration.organization_id, transaction_type: "registration", related_record_id: registrationId, direction: "debit", status: "succeeded", amount_cents: Number(registration.registration_amount_cents || 0), stripe_object_type: transferId ? "transfer" : null, stripe_object_id: transferId || null, idempotency_key: `registration-${registrationId}-organization-transfer` }, { onConflict: "idempotency_key" }),
    service.from("payment_audit_events").insert({ organization_id: registration.organization_id, entity_type: "official_registration", entity_id: registrationId, event_type: "registration_payment_settled", new_values: { payment_status: "paid" }, metadata: { stripe_event_id: eventId, stripe_payment_intent_id: paymentIntentId, stripe_charge_id: chargeId, stripe_transfer_id: transferId } }),
  ]);
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
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `registrar-registration-${registration.id}` }, body: JSON.stringify({ from: "Ref Pro Group <notifications@assignments.ref-assign.com>", to: recipients, reply_to: "assignments@ref-assign.com", subject: `New paid official registration: ${registration.first_name} ${registration.last_name}`, html: `<div style="font-family:Arial,sans-serif"><h2>New Official Registration</h2><p><b>${escapeHtml(registration.first_name)} ${escapeHtml(registration.last_name)}</b> has completed the ${escapeHtml(registration.registration_year)} registration payment for ${escapeHtml(program?.name || "Iowa Soccer")}.</p><p>${escapeHtml(registration.email)}</p><p>Sign in to Ref Pro Group and open Registrar to approve eligibility.</p></div>` }) });
  if (!response.ok) throw new Error(`Registrar notification failed (${response.status}).`);
  const { error: notificationError } = await service.from("official_registrations").update({ registrar_notified_at: now }).eq("id", registration.id);
  if (notificationError) throw notificationError;
}

async function processRegistrationRefund(service: any, charge: Record<string, any>, now: string, eventId: string) {
  const registrationId = String(charge.metadata?.registration_id || "");
  if (!registrationId) return;
  const refunded = Number(charge.amount_refunded || 0);
  const { data: registration, error } = await service.from("official_registrations").update({ payment_status: charge.refunded ? "refunded" : "paid", refunded_amount_cents: refunded, updated_at: now }).eq("id", registrationId).select("organization_id").single();
  if (error) throw error;
  await Promise.all([
    service.from("payment_transactions").upsert({ organization_id: registration.organization_id, transaction_type: "registration", related_record_id: registrationId, direction: "refund", status: "succeeded", amount_cents: refunded, stripe_object_type: "charge", stripe_object_id: charge.id, idempotency_key: `registration-${registrationId}-refund-${refunded}` }, { onConflict: "idempotency_key" }),
    service.from("payment_audit_events").insert({ organization_id: registration.organization_id, entity_type: "official_registration", entity_id: registrationId, event_type: "registration_refunded", new_values: { refunded_amount_cents: refunded }, metadata: { stripe_event_id: eventId, stripe_charge_id: charge.id } }),
  ]);
}

async function processRegistrationDispute(service: any, dispute: Record<string, any>, now: string, eventId: string, stripeKey: string) {
  const chargeId = objectId(dispute.charge);
  if (!chargeId) return;
  const { data: registration } = await service.from("official_registrations").select("id,organization_id,stripe_transfer_id,registration_amount_cents").eq("stripe_charge_id", chargeId).maybeSingle();
  if (!registration) return;
  let reversalId = "";
  if (registration.stripe_transfer_id) {
    const reversal = await stripeConnectRequest<{ id: string }>(`transfers/${encodeURIComponent(registration.stripe_transfer_id)}/reversals`, stripeKey, new URLSearchParams({ amount: String(registration.registration_amount_cents || 0), "metadata[registration_id]": registration.id }), `registration-dispute-${dispute.id}`);
    reversalId = reversal.id;
  }
  await Promise.all([
    service.from("payment_transactions").upsert({ organization_id: registration.organization_id, transaction_type: "registration", related_record_id: registration.id, direction: "reversal", status: "succeeded", amount_cents: Number(registration.registration_amount_cents || 0), stripe_object_type: reversalId ? "transfer_reversal" : null, stripe_object_id: reversalId || null, idempotency_key: `registration-${registration.id}-dispute-${dispute.id}` }, { onConflict: "idempotency_key" }),
    service.from("payment_audit_events").insert({ organization_id: registration.organization_id, entity_type: "official_registration", entity_id: registration.id, event_type: "registration_dispute_created", metadata: { stripe_event_id: eventId, stripe_dispute_id: dispute.id, stripe_charge_id: chargeId, stripe_transfer_reversal_id: reversalId } }),
  ]);
}
