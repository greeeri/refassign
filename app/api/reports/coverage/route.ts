import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { session: supabase, organizationId } = scope;

  // Use the signed-in client so league and organization RLS policies remain
  // authoritative as organization workspaces are enabled.
  const [gamesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("games")
      .select(
        "id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)",
      )
      .eq("organization_id", organizationId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("assignments")
      .select(
        "id,game_id,status,published_at,accept_by,responded_at,decline_reason,officials(first_name,last_name),sport_positions(name),games!inner(organization_id)",
      )
      .eq("games.organization_id", organizationId),
  ]);
  const error = gamesResult.error || assignmentsResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    games: gamesResult.data || [],
    assignments: assignmentsResult.data || [],
  });
}
