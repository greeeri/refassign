import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";
import { retrieveAndSyncStripeSubscription } from "../../../../lib/stripe/subscriptions";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Sign in required." : message === "FORBIDDEN" ? "Super-admin access required." : message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
}

export async function GET() {
  try {
    const { service } = await requireSuperAdmin();
    const { data, error } = await service.from("refassign_subscriptions").select("id,organization_id,organization_name,plan,status,stripe_subscription_id,current_period_end,cancel_at_period_end,access_override,access_override_reason,access_overridden_at,created_at,organizations(name)").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    return NextResponse.json({ subscriptions: data || [] });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = await request.json() as { id?: string; enabled?: boolean; reason?: string };
    if (!body.id) throw new Error("Subscription is required.");
    const enabled = Boolean(body.enabled);
    const reason = String(body.reason || "").trim().slice(0, 500);
    if (enabled && reason.length < 3) throw new Error("Enter a reason for granting access.");
    const now = new Date().toISOString();
    const { data, error } = await service.from("refassign_subscriptions").update({ access_override: enabled, access_override_reason: enabled ? reason : null, access_overridden_at: enabled ? now : null, access_overridden_by: enabled ? user.id : null, updated_at: now }).eq("id", body.id).select("id,organization_id,status").single();
    if (error) throw error;
    await service.from("super_admin_audit").insert({ actor_user_id: user.id, action: enabled ? "subscription_access_override_granted" : "subscription_access_override_removed", details: { subscription_id: data.id, organization_id: data.organization_id, subscription_status: data.status, reason: enabled ? reason : null } });
    return NextResponse.json({ updated: true });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("Stripe is not configured.");
    const body = await request.json() as { id?: string };
    if (!body.id) throw new Error("Subscription is required.");
    const { data: subscription, error } = await service.from("refassign_subscriptions").select("id,organization_id,stripe_subscription_id").eq("id", body.id).single();
    if (error) throw error;
    if (!subscription.stripe_subscription_id) throw new Error("This record is not connected to a Stripe subscription.");
    await retrieveAndSyncStripeSubscription(service, subscription.stripe_subscription_id, key);
    await service.from("super_admin_audit").insert({ actor_user_id: user.id, action: "stripe_subscription_reconciled", details: { subscription_id: subscription.id, organization_id: subscription.organization_id, stripe_subscription_id: subscription.stripe_subscription_id } });
    return NextResponse.json({ synchronized: true });
  } catch (error) { return failure(error); }
}
