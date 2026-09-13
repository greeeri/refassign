import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/admin";
import { STRIPE_API_VERSION } from "../../../lib/stripe/subscriptions";

export async function GET(request: NextRequest) {
  const auth = await createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/billing/recover")}`, request.nextUrl.origin));
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.redirect(new URL("/billing?portal_error=unavailable", request.nextUrl.origin));

  const service = createServiceClient();
  const { data: subscription } = await service.from("refassign_subscriptions").select("stripe_customer_id").eq("user_id", user.id).not("stripe_customer_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!subscription?.stripe_customer_id) return NextResponse.redirect(new URL("/billing?portal_error=no_customer", request.nextUrl.origin));

  const form = new URLSearchParams({ customer: subscription.stripe_customer_id, return_url: `${request.nextUrl.origin}/billing` });
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": STRIPE_API_VERSION }, body: form, cache: "no-store" });
  const result = await response.json() as { url?: string };
  return result.url ? NextResponse.redirect(result.url) : NextResponse.redirect(new URL("/billing?portal_error=create_failed", request.nextUrl.origin));
}
