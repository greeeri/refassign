export type StripeConnectedAccount = {
  id: string;
  details_submitted?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  capabilities?: { transfers?: string };
  requirements?: { currently_due?: string[]; eventually_due?: string[]; disabled_reason?: string | null };
};

export async function stripeConnectRequest<T>(path: string, key: string, body?: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), "Stripe-Version": "2026-07-29.dahlia" },
    body,
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || `Stripe request failed (${response.status}).`);
  return result;
}

export function connectedAccountState(account: StripeConnectedAccount) {
  const due = account.requirements?.currently_due || [];
  const ready = account.details_submitted === true && account.capabilities?.transfers === "active" && account.payouts_enabled === true;
  const restricted = Boolean(account.requirements?.disabled_reason);
  return {
    onboarding_status: ready ? "ready" : restricted ? "restricted" : account.details_submitted ? "pending" : "not_started",
    transfers_status: account.capabilities?.transfers === "active" ? "active" : restricted ? "restricted" : "pending",
    payouts_status: account.payouts_enabled ? "active" : restricted ? "restricted" : "pending",
    requirements_due: due,
    details_submitted: account.details_submitted === true,
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
