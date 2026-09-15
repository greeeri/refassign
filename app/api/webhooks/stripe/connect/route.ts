import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { connectedAccountState, StripeConnectedAccount } from "../../../../../lib/stripe/connect";
import { stripeConnectConfig } from "../../../../../lib/stripe/runtime";

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
    try {
      return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
    } catch {
      return false;
    }
  });
}

export async function POST(request: Request) {
  let config;
  try { config = stripeConnectConfig(); } catch { return NextResponse.json({ error: "Stripe Connect webhook is not configured." }, { status: 503 }); }
  const secret = config.connectWebhookSecret;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) {
    return NextResponse.json({ error: "Stripe Connect webhook is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  if (!validSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  let event: { id?: string; type?: string; livemode?: boolean; data?: { object?: Record<string, any> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (event.livemode !== (config.mode === "live")) {
    return NextResponse.json({ error: `This endpoint accepts ${config.mode} Stripe events only.` }, { status: 400 });
  }
  if (event.type !== "account.updated") {
    return NextResponse.json({ received: true, ignored: true });
  }

  const account = event.data?.object as StripeConnectedAccount | undefined;
  if (!account?.id) {
    return NextResponse.json({ error: "Connected account is required." }, { status: 400 });
  }

  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const officialId = String((account as StripeConnectedAccount & { metadata?: { refassign_official_id?: string } }).metadata?.refassign_official_id || "");
  const values = { stripe_mode: config.mode, stripe_account_id: account.id, ...connectedAccountState(account) };
  const result = officialId
    ? await service.from("official_stripe_accounts").upsert({ official_id: officialId, ...values }, { onConflict: "official_id,stripe_mode" })
    : await service.from("official_stripe_accounts").update(values).eq("stripe_account_id", account.id).eq("stripe_mode", config.mode);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
