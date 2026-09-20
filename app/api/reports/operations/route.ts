import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

type ReportRow = Record<string, any>;

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { session: supabase, service, organizationId } = scope;
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess =
    subscription?.reporting_access === "standard" ? "standard" : "premium";

  // All operational records are read with the signed-in client so the current
  // organization and league RLS policies determine the report's boundaries.
  const [gamesResult, assignmentsResult, declinesResult, auditResult] =
    await Promise.all([
      readAllPages<ReportRow>((from, to) =>
        supabase
          .from("games")
          .select(
            "id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name)",
          )
          .eq("organization_id", organizationId)
          .order("starts_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      readAllPages<ReportRow>((from, to) =>
        supabase
          .from("assignments")
          .select(
            "id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,published_at,accept_by,responded_at,officials(id,first_name,last_name),sport_positions(name),games!inner(organization_id)",
          )
          .eq("games.organization_id", organizationId)
          .order("assigned_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      readAllPages<ReportRow>((from, to) =>
        supabase
          .from("assignment_declines")
          .select(
            "id,game_id,official_id,position_id,declined_at,decline_reason,games!inner(organization_id)",
          )
          .eq("games.organization_id", organizationId)
          .order("declined_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      readAllPages<ReportRow>((from, to) =>
        supabase
          .from("audit_history")
          .select("id,game_id,action,occurred_at")
          .in("action", ["assignment_changed", "unassigned"])
          .order("occurred_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      ),
    ]);
  const error =
    gamesResult.error ||
    assignmentsResult.error ||
    declinesResult.error ||
    auditResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    games: gamesResult.data || [],
    declines: declinesResult.data || [],
    assignments: (assignmentsResult.data || []).map((assignment) =>
      reportingAccess === "premium"
        ? assignment
        : {
            ...assignment,
            game_fee: null,
            mileage_miles: null,
            mileage_rate: null,
            payment_status: null,
          },
    ),
    audit: (auditResult.data || []).filter((row) =>
      (gamesResult.data || []).some((game) => game.id === row.game_id),
    ),
  });
}
