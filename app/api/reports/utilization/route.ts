import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : null;

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
  const { data: officialLinks, error: officialLinkError } = await service
    .from("organization_officials")
    .select("official_id")
    .eq("organization_id", organizationId)
    .eq("active", true);
  if (officialLinkError)
    return NextResponse.json(
      { error: officialLinkError.message },
      { status: 400 },
    );
  const officialIds = (officialLinks || []).map((row) => row.official_id);

  // The signed-in client keeps officials, assignments, games, and audit rows
  // inside the organizations and leagues permitted by the current RLS rules.
  const [officialsResult, assignmentsResult, auditResult] = await Promise.all([
    supabase
      .from("officials")
      .select("id,first_name,last_name,active,max_games_per_day")
      .in("id", officialIds)
      .order("last_name")
      .order("first_name"),
    supabase
      .from("assignments")
      .select(
        "id,game_id,official_id,status,assigned_at,published_at,responded_at,game_fee,mileage_miles,mileage_rate,payment_status,officials(id,first_name,last_name),sport_positions(name),games!inner(id,organization_id,game_number,starts_at,status,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
      )
      .eq("games.organization_id", organizationId)
      .not("official_id", "is", null)
      .order("assigned_at", { ascending: false }),
    supabase
      .from("audit_history")
      .select("game_id,action,occurred_at,old_data,new_data")
      .eq("action", "assignment_changed"),
  ]);
  const error =
    officialsResult.error || assignmentsResult.error || auditResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    officials: officialsResult.data || [],
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
    replacements: (auditResult.data || [])
      .filter((event) =>
        (assignmentsResult.data || []).some(
          (assignment) => assignment.game_id === event.game_id,
        ),
      )
      .map((event) => {
        const oldData =
            event.old_data && typeof event.old_data === "object"
              ? (event.old_data as Record<string, unknown>)
              : {},
          newData =
            event.new_data && typeof event.new_data === "object"
              ? (event.new_data as Record<string, unknown>)
              : {};
        return {
          game_id: event.game_id,
          occurred_at: event.occurred_at,
          previous_official_id: stringValue(oldData.official_id),
          new_official_id: stringValue(newData.official_id),
        };
      })
      // assignment_changed also records position edits. Only a changed official
      // is a replacement for utilization reporting.
      .filter(
        (event) =>
          event.previous_official_id !== event.new_official_id &&
          Boolean(event.previous_official_id || event.new_official_id),
      ),
  });
}
