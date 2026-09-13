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

  const now = new Date().toISOString();
  // These queries use the signed-in client so every row remains constrained by
  // the manager's existing organization and league RLS policies.
  const [
    gamesResult,
    assignmentsResult,
    officialsResult,
    positionsResult,
    leagueEligibilityResult,
    levelEligibilityResult,
    blocksResult,
  ] = await Promise.all([
    supabase
      .from("games")
      .select(
        "id,game_number,status,sport_id,league_id,level_id,location_id,starts_at,duration_minutes,officials_needed,sports(name),leagues(id,name,assignment_fill_target_days),levels(id,name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name),location:locations(id,name,city,state,latitude,longitude)",
      )
      .eq("organization_id", organizationId)
      .gte("starts_at", now)
      .order("starts_at"),
    supabase
      .from("assignments")
      .select(
        "id,game_id,official_id,position_id,status,published_at,accept_by,responded_at,games!inner(organization_id,starts_at,duration_minutes)",
      )
      .eq("games.organization_id", organizationId),
    supabase
      .from("officials")
      .select(
        "id,first_name,last_name,sports,active,max_games_per_day,home_latitude,home_longitude",
      )
      .in("id", officialIds)
      .eq("active", true)
      .order("last_name")
      .order("first_name"),
    supabase
      .from("sport_positions")
      .select("id,sport_id,name,sort_order,required")
      .order("sort_order"),
    supabase
      .from("official_league_eligibility")
      .select("official_id,league_id")
      .in("official_id", officialIds),
    supabase
      .from("official_level_eligibility")
      .select("official_id,level_id")
      .in("official_id", officialIds),
    supabase
      .from("official_availability_blocks")
      .select(
        "official_id,block_type,start_date,end_date,starts_at,ends_at,location_id,team_id",
      )
      .in("official_id", officialIds),
  ]);
  const error =
    gamesResult.error ||
    assignmentsResult.error ||
    officialsResult.error ||
    positionsResult.error ||
    leagueEligibilityResult.error ||
    levelEligibilityResult.error ||
    blocksResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    games: (gamesResult.data || []).map((game) =>
      reportingAccess === "premium"
        ? game
        : {
            ...game,
            location: game.location
              ? { ...game.location, latitude: null, longitude: null }
              : null,
          },
    ),
    assignments: assignmentsResult.data || [],
    officials: (officialsResult.data || []).map((official) =>
      reportingAccess === "premium"
        ? official
        : { ...official, home_latitude: null, home_longitude: null },
    ),
    positions: positionsResult.data || [],
    leagueEligibility: leagueEligibilityResult.data || [],
    levelEligibility: levelEligibilityResult.data || [],
    blocks: blocksResult.data || [],
  });
}
