import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { gameHoldReason, normalizeGameStatus } from "../../../../lib/game-status";

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const id = request.nextUrl.searchParams.get("gameId");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Select a game." }, { status: 400 });
  const selection = "id,game_number,league_id,status,starts_at,duration_minutes,location_id,home_team_id,away_team_id,time_tbd,field_tbd,venue_conflict_hold,notes,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),levels(name),location:locations(name,city,state)";
  const { data: game, error } = await scope.service.from("games").select(selection).eq("id", id).eq("organization_id", scope.organizationId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!game || (!scope.fullOrganizationAccess && !scope.leagueIds?.includes(game.league_id || ""))) return NextResponse.json({ error: "Game not available." }, { status: 404 });
  const start = new Date(game.starts_at).getTime();
  const end = start + (game.duration_minutes || 110) * 60000;
  const teams = [game.home_team_id, game.away_team_id].filter(Boolean) as string[];
  const { data: placeholders, error: teamError } = teams.length ? await scope.service.from("teams").select("id,name,source_system").in("id", teams) : { data: [], error: null };
  if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 });
  const realTeams = (placeholders || []).filter(t => !/\bTBD\b/i.test(t.name) && t.source_system !== "refassign-placeholder").map(t => t.id);
  const filters: string[] = [];
  if (game.location_id && !game.field_tbd) filters.push(`location_id.eq.${game.location_id}`);
  if (realTeams.length) filters.push(`home_team_id.in.(${realTeams.join(",")})`, `away_team_id.in.(${realTeams.join(",")})`);
  let conflicts: Record<string, unknown>[] = [];
  if (!game.time_tbd && filters.length) {
    let query = scope.service.from("games").select(selection).eq("organization_id", scope.organizationId).neq("id", id).is("archived_at", null)
      .not("status", "in", "(canceled,cancelled,rained_out,rain_out)").eq("time_tbd", false)
      .gte("starts_at", new Date(start - 1440 * 60000).toISOString()).lt("starts_at", new Date(end).toISOString()).or(filters.join(",")).order("starts_at").limit(500);
    if (!scope.fullOrganizationAccess) query = query.in("league_id", scope.leagueIds || []);
    const result = await query;
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    conflicts = (result.data || []).flatMap(other => {
      const otherStart = new Date(other.starts_at).getTime(), otherEnd = otherStart + (other.duration_minutes || 110) * 60000;
      const overlap = Math.min(end, otherEnd) - Math.max(start, otherStart);
      if (overlap <= 0) return [];
      const venue = Boolean(game.location_id && !game.field_tbd && !other.field_tbd && other.location_id === game.location_id);
      const team = realTeams.some(t => t === other.home_team_id || t === other.away_team_id);
      if (!venue && !team) return [];
      return [{ ...other, notes: undefined, conflict_type: [venue ? "Same field" : "", team ? "Same team" : ""].filter(Boolean).join(" and "), overlap_minutes: Math.ceil(overlap / 60000) }];
    });
  }
  const recorded = gameHoldReason(game);
  return NextResponse.json({ status: normalizeGameStatus(game.status), reason: recorded?.startsWith("No hold reason") ? null : recorded, time_tbd: game.time_tbd, field_tbd: game.field_tbd, conflict_hold: game.venue_conflict_hold, conflicts }, { headers: { "Cache-Control": "no-store" } });
}
