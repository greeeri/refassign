import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripeConnectConfig } from "../../../../lib/stripe/runtime";

function cardProcessingSurcharge(amountCents: number) {
  return Math.max(0, Math.ceil((amountCents + 30) / (1 - 0.029)) - amountCents);
}

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey)
    return NextResponse.json(
      { error: "Registration payment is not configured yet." },
      { status: 503 },
    );
  const { token } = (await request.json().catch(() => ({}))) as {
    token?: string;
  };
  if (!token)
    return NextResponse.json(
      { error: "Registration token is required." },
      { status: 400 },
    );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: registration, error } = await supabase
    .from("official_registrations")
    .select(
      "id,public_token,first_name,last_name,email,payment_status,parent_consent_status,fee_cents,registration_program_id,registration_programs(name,registration_fee_cents,organization_id)",
    )
    .eq("public_token", token)
    .maybeSingle();
  if (error || !registration)
    return NextResponse.json(
      { error: "Registration not found." },
      { status: 404 },
    );
  if (registration.payment_status === "paid")
    return NextResponse.json(
      { error: "This registration is already paid." },
      { status: 409 },
    );
  if (registration.parent_consent_status === "pending")
    return NextResponse.json(
      { error: "Parent consent must be signed before payment." },
      { status: 409 },
    );
  const program = registration.registration_programs as unknown as { name?: string; registration_fee_cents?: number | null; organization_id?: string | null } | null,
    fee = (registration.fee_cents ?? program?.registration_fee_cents) as number | null;
  if (fee == null || fee <= 0)
    return NextResponse.json(
      { error: "The Registrar has not published a registration fee." },
      { status: 409 },
    );
  if (!program?.organization_id) return NextResponse.json({ error: "This registration program is not assigned to an organization." }, { status: 409 });
  const { secretKey: stripeKey, mode } = stripeConnectConfig();
  const [{ data: settings, error: settingsError }, { data: recipient, error: recipientError }] = await Promise.all([
    supabase.from("organization_registration_payment_settings").select("payments_enabled,platform_fee_cents,processing_fee_payer").eq("organization_id", program.organization_id).maybeSingle(),
    supabase.from("organization_stripe_accounts").select("stripe_account_id,onboarding_status,transfers_status").eq("organization_id", program.organization_id).eq("stripe_mode", mode).maybeSingle(),
  ]);
  if (settingsError || recipientError) return NextResponse.json({ error: settingsError?.message || recipientError?.message }, { status: 500 });
  if (!settings?.payments_enabled) return NextResponse.json({ error: "Online registration payments are not enabled for this organization." }, { status: 409 });
  if (!recipient || recipient.onboarding_status !== "ready" || recipient.transfers_status !== "active") return NextResponse.json({ error: "This organization must complete Stripe setup before accepting registrations." }, { status: 409 });
  const platformFee = Number(settings.platform_fee_cents || 0);
  const preProcessingTotal = fee + platformFee;
  const processingSurcharge = settings.processing_fee_payer === "registrant" ? cardProcessingSurcharge(preProcessingTotal) : 0;
  const total = preProcessingTotal + processingSurcharge;
  const applicationFee = platformFee + (settings.processing_fee_payer === "registrant" ? processingSurcharge : 0);
  const origin = request.nextUrl.origin,
    body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${origin}/register/${token}?payment=success`);
  body.set("cancel_url", `${origin}/register/${token}?payment=cancelled`);
  body.set("client_reference_id", registration.id);
  body.set("customer_email", registration.email);
  body.set("line_items[0][price_data][currency]", "usd");
  body.set(
    "line_items[0][price_data][product_data][name]",
    `Ref Pro Group Official Registration — ${program?.name || "Iowa Soccer"}`,
  );
  body.set("line_items[0][price_data][unit_amount]", String(total));
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[registration_id]", registration.id);
  body.set("metadata[organization_id]", program.organization_id);
  body.set("metadata[registration_amount_cents]", String(fee));
  body.set("metadata[platform_fee_cents]", String(platformFee));
  body.set("metadata[processing_surcharge_cents]", String(processingSurcharge));
  body.set("payment_intent_data[application_fee_amount]", String(applicationFee));
  body.set("payment_intent_data[transfer_data][destination]", recipient.stripe_account_id);
  body.set("payment_intent_data[metadata][registration_id]", registration.id);
  body.set("payment_intent_data[metadata][organization_id]", program.organization_id);
  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2026-07-29.dahlia",
      },
      body,
    },
  );
  const session = (await stripeResponse.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!stripeResponse.ok || !session.id || !session.url)
    return NextResponse.json(
      {
        error:
          session.error?.message || "Stripe could not create the payment page.",
      },
      { status: 502 },
    );
  await supabase
    .from("official_registrations")
    .update({
      stripe_checkout_session_id: session.id,
      fee_cents: fee,
      organization_id: program.organization_id,
      registration_amount_cents: fee,
      platform_fee_cents: platformFee,
      processing_surcharge_cents: processingSurcharge,
      total_charged_cents: total,
      stripe_application_fee_amount: applicationFee,
      stripe_destination_account_id: recipient.stripe_account_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", registration.id);
  await Promise.all([
    supabase.from("payment_transactions").upsert({ organization_id: program.organization_id, transaction_type: "registration", related_record_id: registration.id, direction: "credit", status: "pending", amount_cents: total, stripe_object_type: "checkout_session", stripe_object_id: session.id, idempotency_key: `registration-${registration.id}-${session.id}` }, { onConflict: "idempotency_key" }),
    supabase.from("payment_audit_events").insert({ organization_id: program.organization_id, entity_type: "official_registration", entity_id: registration.id, event_type: "registration_checkout_created", new_values: { registration_amount_cents: fee, platform_fee_cents: platformFee, processing_surcharge_cents: processingSurcharge, total_charged_cents: total }, metadata: { stripe_checkout_session_id: session.id, stripe_destination_account_id: recipient.stripe_account_id } }),
  ]);
  return NextResponse.json({ url: session.url, amounts: { registration: fee, platformFee, processingSurcharge, total } });
}
