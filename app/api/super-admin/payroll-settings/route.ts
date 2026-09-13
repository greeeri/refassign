import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";

type FeeType = "none" | "flat" | "percentage";
type FundingMethod = "ach" | "card" | "collected_funds" | "prepaid_balance";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json(
    { error: message === "UNAUTHORIZED" ? "Sign in required." : message === "FORBIDDEN" ? "Super-admin access required." : message },
    { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 },
  );
}

export async function GET() {
  try {
    const { service } = await requireSuperAdmin();
    const [{ data: leagues, error: leagueError }, { data: coverage, error: coverageError }, { data: organizations, error: organizationError }, { data: settings, error: settingsError }, { data: rules, error: rulesError }] = await Promise.all([
      service.from("leagues").select("id,name").order("name"),
      service.from("organization_league_coverage").select("organization_id,league_id").eq("active", true),
      service.from("organizations").select("id,name").order("name"),
      service.from("league_payment_settings").select("*").order("updated_at", { ascending: false }),
      service.from("transaction_fee_rules").select("*").eq("transaction_type", "payroll"),
    ]);
    const error = leagueError || coverageError || organizationError || settingsError || rulesError;
    if (error) throw error;
    const organizationNames = new Map((organizations || []).map((organization) => [organization.id, organization.name]));
    const leagueNames = new Map((leagues || []).map((league) => [league.id, league.name]));
    const scopeKey = (organizationId: string, leagueId: string) => `${organizationId}:${leagueId}`;
    const settingsByScope = new Map((settings || []).map((setting) => [scopeKey(setting.organization_id, setting.league_id), setting]));
    const rulesByScope = new Map((rules || []).filter((rule) => rule.league_id).map((rule) => [scopeKey(rule.organization_id, rule.league_id), rule]));
    const scopes = Array.from(new Map((coverage || []).map((item) => [scopeKey(item.organization_id, item.league_id), item])).values());
    return NextResponse.json({
      leagues: scopes.map((scope) => ({
        id: scope.league_id,
        name: leagueNames.get(scope.league_id) || "Unknown league",
        organization_id: scope.organization_id,
        organization_name: organizationNames.get(scope.organization_id) || "Unknown organization",
        payment_settings: settingsByScope.get(scopeKey(scope.organization_id, scope.league_id)) || null,
        payroll_fee_rule: rulesByScope.get(scopeKey(scope.organization_id, scope.league_id)) || null,
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = await request.json() as {
      league_id?: string;
      organization_id?: string;
      payroll_enabled?: boolean;
      funding_method?: FundingMethod;
      card_enabled?: boolean;
      fee_type?: FeeType;
      flat_fee_cents?: number | null;
      percentage_basis_points?: number | null;
      minimum_fee_cents?: number | null;
      maximum_fee_cents?: number | null;
    };
    if (!body.league_id || !body.organization_id) throw new Error("Organization and league are required.");
    if (!["ach", "card", "collected_funds", "prepaid_balance"].includes(body.funding_method || "")) throw new Error("Select a valid funding method.");
    if (!["none", "flat", "percentage"].includes(body.fee_type || "")) throw new Error("Select a valid fee type.");
    if (body.funding_method === "card" && !body.card_enabled) throw new Error("Card funding must be enabled before it can be the default.");
    const amounts = [body.flat_fee_cents, body.percentage_basis_points, body.minimum_fee_cents, body.maximum_fee_cents];
    if (amounts.some((value) => value != null && (!Number.isInteger(value) || value < 0))) throw new Error("Fee values cannot be negative.");
    if (body.percentage_basis_points != null && body.percentage_basis_points > 10000) throw new Error("Percentage fee cannot exceed 100%.");
    if (body.minimum_fee_cents != null && body.maximum_fee_cents != null && body.maximum_fee_cents < body.minimum_fee_cents) throw new Error("Maximum fee cannot be below the minimum fee.");

    const { data: league, error: leagueError } = await service.from("leagues").select("id,name").eq("id", body.league_id).single();
    if (leagueError || !league) throw new Error("League was not found.");
    const { data: scope, error: scopeError } = await service.from("organization_league_coverage").select("organization_id").eq("organization_id", body.organization_id).eq("league_id", league.id).eq("active", true).limit(1).maybeSingle();
    if (scopeError || !scope) throw new Error("This league is not active for the selected organization.");
    const fundingModel = body.funding_method === "collected_funds" ? "collected_funds" : body.funding_method === "prepaid_balance" ? "prepaid_balance" : "per_batch";
    const { error: settingsError } = await service.from("league_payment_settings").upsert({
      organization_id: scope.organization_id,
      league_id: league.id,
      payroll_enabled: body.payroll_enabled === true,
      funding_model: fundingModel,
      default_funding_method: body.funding_method,
      ach_enabled: true,
      card_enabled: body.card_enabled === true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,league_id" });
    if (settingsError) throw settingsError;

    const feeType = body.fee_type || "none";
    const feeValues = {
      organization_id: scope.organization_id,
      league_id: league.id,
      transaction_type: "payroll",
      fee_type: feeType,
      flat_fee_cents: feeType === "flat" ? body.flat_fee_cents ?? 0 : null,
      percentage_basis_points: feeType === "percentage" ? body.percentage_basis_points ?? 0 : null,
      minimum_fee_cents: feeType === "percentage" ? body.minimum_fee_cents ?? null : null,
      maximum_fee_cents: feeType === "percentage" ? body.maximum_fee_cents ?? null : null,
      active: true,
      created_by: user.id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const { data: existingFeeRule, error: feeLookupError } = await service
      .from("transaction_fee_rules")
      .select("id")
      .eq("league_id", league.id)
      .eq("transaction_type", "payroll")
      .maybeSingle();
    if (feeLookupError) throw feeLookupError;
    const { error: feeError } = existingFeeRule
      ? await service.from("transaction_fee_rules").update(feeValues).eq("id", existingFeeRule.id)
      : await service.from("transaction_fee_rules").insert(feeValues);
    if (feeError) throw feeError;
    await Promise.all([
      service.from("payment_audit_events").insert({ organization_id: scope.organization_id, league_id: league.id, entity_type: "league_payment_settings", entity_id: league.id, event_type: "super_admin_settings_updated", actor_user_id: user.id, new_values: body, metadata: { processing_cost_payer: "league" } }),
      service.from("super_admin_audit").insert({ actor_user_id: user.id, action: "league_payroll_settings_updated", details: { organization_id: scope.organization_id, league_id: league.id, league_name: league.name, ...body, processing_cost_payer: "league" } }),
    ]);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return failure(error);
  }
}
