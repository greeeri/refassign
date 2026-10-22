import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";
import { syncJuscFeed } from "../../../lib/server/jusc-calendar-sync";
import { syncBoundFeed } from "../../../lib/server/bound-calendar-sync";
export const maxDuration = 90;
async function context(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return { ...scope, feeds: [] };
  let query = scope.service.from("calendar_sync_feeds").select("id,name,league_id,source_system,enabled,bootstrapped,last_attempt_at,last_success_at,next_run_at,last_error,event_count,lease_until").eq("organization_id", scope.organizationId).order("name").limit(100);
  if (!scope.fullOrganizationAccess) {
    if (!scope.leagueIds?.length) return { ...scope, feeds: [] };
    query = query.in("league_id", (scope.leagueAccess || []).filter((access) => access.all_locations).map((access) => access.league_id));
  }
  const league = request.nextUrl.searchParams.get("leagueId");
  if (league) query = query.eq("league_id", league);
  const result = await query;
  if (result.error) return { ...scope, feeds: [], error: NextResponse.json({ error: result.error.message }, { status: 500 }) };
  return { ...scope, feeds: result.data || [] };
}
export async function GET(request: NextRequest) {
  const scope = await context(request);
  if (scope.error) return scope.error;
  if (!scope.feeds.length) return NextResponse.json({ feeds: [], runs: [], changes: [] });
  const runs = await scope.service.from("calendar_sync_runs").select("id,feed_id,started_at,finished_at,status,events_found,games_added,games_updated,games_removed,games_held,assigned_games_affected,error").in("feed_id", scope.feeds.map(f => f.id)).order("started_at", { ascending: false }).limit(30);
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  const changes = runs.data.length ? await scope.service.from("calendar_sync_changes").select("id,run_id,game_id,uid,kind,before_source,after_source,details,assignments_affected,created_at").in("run_id", runs.data.map(r => r.id)).order("created_at", { ascending: false }).limit(100) : { data: [], error: null };
  if (changes.error) return NextResponse.json({ error: changes.error.message }, { status: 500 });
  return NextResponse.json({ feeds: scope.feeds, runs: runs.data, changes: changes.data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const scope = await context(request);
  if (scope.error) return scope.error;
  const body = await request.json().catch(() => null);
  if (!body?.feedId || !scope.feeds.some(f => f.id === body.feedId)) return NextResponse.json({ error: "Select a calendar you manage." }, { status: 403 });
  try { const feed = scope.feeds.find(f => f.id === body.feedId)!; return NextResponse.json(await (feed.source_system === "playmetrics" ? syncJuscFeed(scope.service, body.feedId, true) : syncBoundFeed(scope.service, body.feedId, true))); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed." }, { status: 500 }); }
}
