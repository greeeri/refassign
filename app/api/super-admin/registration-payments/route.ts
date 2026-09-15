import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";
import { stripeConnectConfig } from "../../../../lib/stripe/runtime";
import { organizationRecipientState, stripeConnectRequest, stripeConnectV2Request, StripeConnectedAccountV2 } from "../../../../lib/stripe/connect";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Sign in required." : message === "FORBIDDEN" ? "Super-admin access required." : message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
}

export async function GET() {
  try {
    const { service } = await requireSuperAdmin();
    const { mode } = stripeConnectConfig();
    const [{ data: organizations, error: organizationError }, { data: programs, error: programError }, { data: settings, error: settingsError }, { data: accounts, error: accountError }] = await Promise.all([
      service.from("organizations").select("id,name").order("name"),
      service.from("registration_programs").select("id,name,organization_id").eq("active", true).order("name"),
      service.from("organization_registration_payment_settings").select("*"),
      service.from("organization_stripe_accounts").select("organization_id,onboarding_status,transfers_status,requirements_due,last_synced_at").eq("stripe_mode", mode),
    ]);
    const error = organizationError || programError || settingsError || accountError;
    if (error) throw error;
    return NextResponse.json({ organizations: (organizations || []).map((organization) => ({
      ...organization,
      programs: (programs || []).filter((program) => program.organization_id === organization.id),
      settings: (settings || []).find((setting) => setting.organization_id === organization.id) || null,
      account: (accounts || []).find((account) => account.organization_id === organization.id) || null,
    })) });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = await request.json() as { organization_id?: string; payments_enabled?: boolean; platform_fee_cents?: number; processing_fee_payer?: string };
    if (!body.organization_id) throw new Error("Organization is required.");
    if (!Number.isInteger(body.platform_fee_cents) || Number(body.platform_fee_cents) < 0) throw new Error("Enter a valid platform fee.");
    if (!['registrant','organization','platform'].includes(body.processing_fee_payer || '')) throw new Error("Select who pays processing costs.");
    if (body.payments_enabled) {
      const { mode } = stripeConnectConfig();
      const { data: account } = await service.from("organization_stripe_accounts").select("onboarding_status,transfers_status").eq("organization_id", body.organization_id).eq("stripe_mode", mode).maybeSingle();
      if (account?.onboarding_status !== "ready" || account.transfers_status !== "active") throw new Error("Complete Iowa Soccer Stripe onboarding before enabling registration payments.");
    }
    const values = { organization_id: body.organization_id, payments_enabled: body.payments_enabled === true, platform_fee_cents: body.platform_fee_cents, processing_fee_payer: body.processing_fee_payer, refund_decision_owner: "organization", updated_by: user.id, updated_at: new Date().toISOString() };
    const { error } = await service.from("organization_registration_payment_settings").upsert(values, { onConflict: "organization_id" });
    if (error) throw error;
    await service.from("super_admin_audit").insert({ actor_user_id: user.id, action: "registration_payment_settings_updated", details: values });
    return NextResponse.json({ updated: true });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { service } = await requireSuperAdmin();
    const { secretKey: key, mode } = stripeConnectConfig();
    const body = await request.json().catch(() => ({})) as { organization_id?: string; action?: "onboard" | "dashboard" | "refresh" };
    if (!body.organization_id) throw new Error("Organization is required.");
    const { data: organization, error: organizationError } = await service.from("organizations").select("id,name").eq("id", body.organization_id).single();
    if (organizationError || !organization) throw new Error("Organization was not found.");
    const { data: stored } = await service.from("organization_stripe_accounts").select("stripe_account_id").eq("organization_id", organization.id).eq("stripe_mode", mode).maybeSingle();
    let accountId = stored?.stripe_account_id || "";
    if (!accountId) {
      const account = await stripeConnectV2Request<StripeConnectedAccountV2>("core/accounts", key, {
        display_name: organization.name,
        identity: { country: "us", entity_type: "company" },
        dashboard: "express",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
        metadata: { refassign_organization_id: organization.id },
        include: ["configuration.recipient", "defaults", "identity", "requirements"],
      }, `refassign-organization-${organization.id}-${mode}`);
      accountId = account.id;
      const { error } = await service.from("organization_stripe_accounts").upsert({ organization_id: organization.id, stripe_mode: mode, stripe_account_id: accountId, ...organizationRecipientState(account) }, { onConflict: "organization_id,stripe_mode" });
      if (error) throw error;
    }
    if (body.action === "dashboard") {
      const link = await stripeConnectRequest<{ url: string }>(`accounts/${encodeURIComponent(accountId)}/login_links`, key, new URLSearchParams());
      return NextResponse.json({ url: link.url });
    }
    if (body.action === "refresh") {
      const account = await stripeConnectV2Request<StripeConnectedAccountV2>(`core/accounts/${encodeURIComponent(accountId)}?include[]=configuration.recipient&include[]=requirements`, key);
      const state = organizationRecipientState(account);
      const { error } = await service.from("organization_stripe_accounts").update(state).eq("organization_id", organization.id).eq("stripe_mode", mode);
      if (error) throw error;
      return NextResponse.json({ refreshed: true, account: state });
    }
    const link = await stripeConnectRequest<{ url: string }>("account_links", key, new URLSearchParams({ account: accountId, type: "account_onboarding", refresh_url: `${request.nextUrl.origin}/workspace?section=Super%20Admin&registrationStripe=refresh`, return_url: `${request.nextUrl.origin}/workspace?section=Super%20Admin&registrationStripe=return` }));
    return NextResponse.json({ url: link.url });
  } catch (error) { return failure(error); }
}
