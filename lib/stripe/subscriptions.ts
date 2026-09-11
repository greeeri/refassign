import type { SupabaseClient } from "@supabase/supabase-js";

export const STRIPE_API_VERSION = "2026-07-29.dahlia";

type StripeSubscription = {
  id: string;
  customer?: string | { id?: string } | null;
  status?: string;
  trial_end?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ current_period_end?: number | null }> };
};

function stripeId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value)
    return String((value as { id?: unknown }).id || "");
  return "";
}

function isoFromUnix(value: unknown) {
  return typeof value === "number" && value > 0
    ? new Date(value * 1000).toISOString()
    : null;
}

export async function stripeRequest<T>(path: string, key: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION },
    cache: "no-store",
  });
  const result = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(result.error?.message || `Stripe request failed (${response.status}).`);
  return result;
}

export async function syncStripeSubscription(
  service: SupabaseClient,
  subscription: StripeSubscription,
) {
  const customerId = stripeId(subscription.customer);
  const metadataId = subscription.metadata?.refassign_subscription_id || "";
  const itemEnds = subscription.items?.data
    ?.map((item) => item.current_period_end || 0)
    .filter(Boolean) || [];
  const periodEnd = subscription.current_period_end || Math.max(0, ...itemEnds);
  const values = {
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subscription.id,
    status: subscription.status || "unknown",
    trial_ends_at: isoFromUnix(subscription.trial_end),
    current_period_end: isoFromUnix(periodEnd),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  };
  let query = service.from("refassign_subscriptions").update(values);
  query = metadataId
    ? query.eq("id", metadataId)
    : query.eq("stripe_subscription_id", subscription.id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No RefAssign record matches Stripe subscription ${subscription.id}.`);
  return data.id as string;
}

export async function retrieveAndSyncStripeSubscription(
  service: SupabaseClient,
  subscriptionId: string,
  key: string,
) {
  const subscription = await stripeRequest<StripeSubscription>(
    `subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`,
    key,
  );
  return syncStripeSubscription(service, subscription);
}
