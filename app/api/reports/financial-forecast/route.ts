import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

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

  // The signed-in client keeps all finance records inside the organizations
  // and leagues granted by the current RLS policies.
  const [assignmentsResult, gamesResult] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name),sport_positions(name),games!inner(id,organization_id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
      )
      .eq("games.organization_id", organizationId)
      .not("official_id", "is", null),
    reportingAccess === "premium"
      ? supabase
          .from("games")
          .select(
            "id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)",
          )
          .eq("organization_id", organizationId)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = assignmentsResult.error || gamesResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const one = (value: unknown) =>
    Array.isArray(value) ? value[0] || null : value;
  const normalizeGame = (value: unknown) => {
    const game = one(value) as Record<string, unknown> | null;
    return game
      ? {
          ...game,
          leagues: one(game.leagues),
          levels: one(game.levels),
          location: one(game.location),
          home: one(game.home),
          away: one(game.away),
        }
      : null;
  };
  const now = Date.now();
  const assignments = (assignmentsResult.data || []).map((row) => ({
    ...row,
    officials: one(row.officials),
    sport_positions: one(row.sport_positions),
    games: normalizeGame(row.games),
  }));
  return NextResponse.json({
    reportingAccess,
    actualAssignments: assignments.filter(
      (row) =>
        row.games &&
        new Date(
          String((row.games as Record<string, unknown>).starts_at),
        ).getTime() <= now &&
        ["accepted", "confirmed"].includes(row.status),
    ),
    forecastAssignments:
      reportingAccess === "premium"
        ? assignments.filter(
            (row) =>
              row.games &&
              new Date(
                String((row.games as Record<string, unknown>).starts_at),
              ).getTime() > now &&
              !["declined", "cancelled", "canceled"].includes(row.status),
          )
        : [],
    futureGames: (gamesResult.data || []).map((game) => normalizeGame(game)),
  });
}
