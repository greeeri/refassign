import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
function validSignature(payload: string, header: string, secret: string) {
  const parts = Object.fromEntries(
      header.split(",").map((part) => part.split("=", 2) as [string, string]),
    ),
    timestamp = parts.t,
    signature = parts.v1;
  if (
    !timestamp ||
    !signature ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey)
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  const payload = await request.text(),
    signature = request.headers.get("stripe-signature") || "";
  if (!validSignature(payload, signature, secret))
    return NextResponse.json(
      { error: "Invalid Stripe signature." },
      { status: 400 },
    );
  let event: {
    type: string;
    data: {
      object: {
        id: string;
        payment_status?: string;
        payment_intent?: string;
        metadata?: { registration_id?: string };
      };
    };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (
    event.type !== "checkout.session.completed" ||
    event.data.object.payment_status !== "paid"
  )
    return NextResponse.json({ received: true });
  const registrationId = event.data.object.metadata?.registration_id;
  if (!registrationId)
    return NextResponse.json(
      { error: "Registration metadata is missing." },
      { status: 400 },
    );
  const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
    now = new Date().toISOString();
  const { data: registration, error } = await supabase
    .from("official_registrations")
    .update({
      status: "paid",
      payment_status: "paid",
      stripe_checkout_session_id: event.data.object.id,
      stripe_payment_intent_id: event.data.object.payment_intent || null,
      paid_at: now,
      updated_at: now,
    })
    .eq("id", registrationId)
    .select(
      "id,first_name,last_name,email,registration_year,registrar_notified_at,league_id,leagues(name)",
    )
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!registration.registrar_notified_at && process.env.RESEND_API_KEY) {
    const [{ data: roles }, { data: owners }] = await Promise.all([
      supabase.from("league_staff_access").select("user_id").eq("league_id", registration.league_id),
      supabase.from("protected_accounts").select("user_id"),
    ]),
      emails: string[] = [];
    for (const role of [...(roles || []), ...(owners || [])]) {
      const { data: userData } = await supabase.auth.admin.getUserById(
        role.user_id,
      );
      if (userData.user?.email) emails.push(userData.user.email);
    }
    const unique = [...new Set(emails)];
    if (unique.length) {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `registrar-registration-${registration.id}`,
        },
        body: JSON.stringify({
          from: "RefAssign <notifications@assignments.ref-assign.com>",
          to: unique,
          reply_to: "assignments@ref-assign.com",
          subject: `New paid official registration: ${registration.first_name} ${registration.last_name}`,
          html: `<div style="font-family:Arial,sans-serif"><h2>New Official Registration</h2><p><b>${escapeHtml(registration.first_name)} ${escapeHtml(registration.last_name)}</b> has completed the ${escapeHtml(registration.registration_year)} registration payment for ${escapeHtml(((registration.leagues as unknown as {name?:string}|null)?.name)||"their league")}.</p><p>${escapeHtml(registration.email)}</p><p>Sign in to RefAssign and open Registrar to approve eligibility. The official is not available for assignments until approval.</p></div>`,
        }),
      });
      if (emailResponse.ok)
        await supabase
          .from("official_registrations")
          .update({ registrar_notified_at: now })
          .eq("id", registration.id);
    }
  }
  return NextResponse.json({ received: true });
}
