import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { connectedAccountState, stripeConnectRequest, stripeConnectV2Request, StripeConnectedAccount } from "../../../../lib/stripe/connect";
import { stripeConnectConfig, stripeConnectMode } from "../../../../lib/stripe/runtime";

async function context() {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) throw new Error("UNAUTHORIZED");
  const service = createServiceClient();
  const { data: official, error } = await service.from("officials").select("id,email,first_name,last_name").eq("auth_user_id", user.id).maybeSingle();
  if (error || !official) throw new Error("An official profile must be linked to this login before payments can be set up.");
  return { user, official, service };
}
function fail(error: unknown) { const message = error instanceof Error ? error.message : "Request failed."; return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Sign in required." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 }); }

export async function GET() {
  try {
    const { official, service } = await context();
    const { data } = await service.from("official_stripe_accounts").select("onboarding_status,transfers_status,payouts_status,requirements_due,details_submitted,payouts_enabled,last_synced_at,stripe_account_id").eq("official_id", official.id).eq("stripe_mode", stripeConnectMode()).maybeSingle();
    return NextResponse.json({ account: data ? { ...data, connected: Boolean(data.stripe_account_id), stripe_account_id: undefined } : { connected: false, onboarding_status: "not_started", transfers_status: "inactive", payouts_status: "inactive", requirements_due: [] } });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { official, service } = await context();
    const { secretKey: key, mode } = stripeConnectConfig();
    const body = await request.json().catch(() => ({})) as { action?: "onboard" | "dashboard" | "refresh" };
    const { data: stored } = await service.from("official_stripe_accounts").select("stripe_account_id").eq("official_id", official.id).eq("stripe_mode", mode).maybeSingle();
    let accountId = stored?.stripe_account_id || "";
    if (!accountId) {
      const account = await stripeConnectV2Request<StripeConnectedAccount>(
        "core/accounts",
        key,
        {
          contact_email: official.email || undefined,
          display_name: [official.first_name, official.last_name].filter(Boolean).join(" ") || undefined,
          identity: { country: "us", entity_type: "individual" },
          dashboard: "express",
          defaults: {
            responsibilities: {
              fees_collector: "application",
              losses_collector: "application",
            },
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: {
                  stripe_transfers: { requested: true },
                },
              },
            },
          },
          metadata: { refassign_official_id: official.id },
          include: ["configuration.recipient", "defaults", "identity", "requirements"],
        },
        `refassign-official-${official.id}`,
      );
      accountId = account.id;
      const { error } = await service.from("official_stripe_accounts").upsert({ official_id: official.id, stripe_mode: mode, stripe_account_id: accountId, ...connectedAccountState(account) }, { onConflict: "official_id,stripe_mode" });
      if (error) throw error;
    }
    if (body.action === "dashboard") {
      const link = await stripeConnectRequest<{ url: string }>(`accounts/${encodeURIComponent(accountId)}/login_links`, key, new URLSearchParams());
      return NextResponse.json({ url: link.url });
    }
    if (body.action === "refresh") {
      const account = await stripeConnectRequest<StripeConnectedAccount>(`accounts/${encodeURIComponent(accountId)}`, key);
      await service.from("official_stripe_accounts").update(connectedAccountState(account)).eq("official_id", official.id).eq("stripe_mode", mode);
      return NextResponse.json({ refreshed: true });
    }
    const link = await stripeConnectRequest<{ url: string }>("account_links", key, new URLSearchParams({ account: accountId, type: "account_onboarding", refresh_url: `${request.nextUrl.origin}/workspace?stripe=refresh`, return_url: `${request.nextUrl.origin}/workspace?stripe=return` }));
    return NextResponse.json({ url: link.url });
  } catch (error) { return fail(error); }
}
