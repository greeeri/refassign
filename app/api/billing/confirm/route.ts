import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { stripeRequest, syncStripeSubscription } from "../../../../lib/stripe/subscriptions";

export async function POST(request: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { checkout_session_id?: string };
  const checkoutId = String(body.checkout_session_id || "");
  if (!checkoutId.startsWith("cs_")) return NextResponse.json({ error: "A valid checkout session is required." }, { status: 400 });
  try {
    const checkout = await stripeRequest<Record<string, any>>(`checkout/sessions/${encodeURIComponent(checkoutId)}?expand[]=subscription`, key);
    const localId = String(checkout.metadata?.refassign_subscription_id || "");
    if (!localId || checkout.metadata?.user_id !== user.id) return NextResponse.json({ error: "This checkout does not belong to your account." }, { status: 403 });
    const service = createServiceClient();
    const { data: owned } = await service.from("refassign_subscriptions").select("id").eq("id", localId).eq("user_id", user.id).maybeSingle();
    if (!owned) return NextResponse.json({ error: "The subscription record was not found." }, { status: 404 });
    if (!checkout.subscription || typeof checkout.subscription === "string") return NextResponse.json({ error: "Stripe has not finished creating the subscription. Refresh in a moment." }, { status: 409 });
    await syncStripeSubscription(service, checkout.subscription);
    const { error } = await service.from("refassign_subscriptions").update({ stripe_checkout_session_id: checkout.id, stripe_customer_id: typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id || null, updated_at: new Date().toISOString() }).eq("id", localId);
    if (error) throw error;
    return NextResponse.json({ confirmed: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm checkout." }, { status: 502 });
  }
}
