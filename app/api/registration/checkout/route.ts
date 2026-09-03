import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY,
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !serviceKey)
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
      "id,public_token,first_name,last_name,email,payment_status,fee_cents,league_id,leagues(name)",
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
  const fee = registration.fee_cents as number | null;
  if (fee == null || fee <= 0)
    return NextResponse.json(
      { error: "The Registrar has not published a registration fee." },
      { status: 409 },
    );
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
    `RefAssign Official Registration — ${((registration.leagues as unknown as { name?: string } | null)?.name || "League")}`,
  );
  body.set("line_items[0][price_data][unit_amount]", String(fee));
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[registration_id]", registration.id);
  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2026-02-25.clover",
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", registration.id);
  return NextResponse.json({ url: session.url });
}
