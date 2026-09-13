import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const { session, service, organizationId } = context;
  let subscriptionQuery = service.from("refassign_subscriptions").select("reporting_access").in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess = subscription?.reporting_access === "standard" ? "standard" : "premium";

  const [auditResult, importResult, gamesResult, organizationsResult] = await Promise.all([
    session.from("audit_history").select("id,organization_id,entity_type,entity_id,game_id,assignment_id,action,actor_name,summary,old_data,new_data,occurred_at").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(1000),
    session.from("import_error_log").select("id,organization_id,import_type,file_name,error_message,row_number,resolved_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(500),
    session.from("games").select("id,organization_id,game_number,starts_at,status,source_system,source_event_id,source_match_id,source_synced_at,leagues(name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)").eq("organization_id", organizationId),
    service.from("organizations").select("id,name").eq("id", organizationId).limit(1),
  ]);
  const firstError = auditResult.error || importResult.error || gamesResult.error || organizationsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const games = gamesResult.data || [];
  const gameIds = games.map((game) => game.id);
  const assignmentsResult = gameIds.length ? await session.from("assignments").select("id,game_id,status,email_error,cancellation_email_error").in("game_id", gameIds) : { data: [], error: null };
  if (assignmentsResult.error) return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });
  const sourceKeys = new Set(games.filter((game) => game.source_system && game.source_event_id).map((game) => `${game.source_system}:${game.source_event_id}`));
  let syncRuns: Array<Record<string, unknown>> = [];
  if (sourceKeys.size || organizationId) {
    const query = service.from("schedule_sync_runs").select("id,organization_id,source_system,source_event_id,started_at,finished_at,status,groups_checked,games_found,games_added,games_updated,games_cancelled,games_skipped,error_message").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(250);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    syncRuns = data || [];
  }
  let communications: Array<Record<string, unknown>> = [];
  if (gameIds.length) {
    const { data, error } = await service.from("official_communications").select("id,game_id,delivery_status,error_message,created_at").in("game_id", gameIds).order("created_at", { ascending: false }).limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    communications = data || [];
  }
  return NextResponse.json({ reportingAccess, organizations: organizationsResult.data || [], audit: auditResult.data || [], importErrors: importResult.data || [], syncRuns, games, assignments: assignmentsResult.data || [], communications });
}

export async function PATCH(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const body = await request.json().catch(() => ({})) as { importErrorId?: number; resolved?: boolean };
  if (!Number.isInteger(body.importErrorId)) return NextResponse.json({ error: "An import error is required." }, { status: 400 });
  const { data, error } = await context.session.from("import_error_log").update({ resolved_at: body.resolved === false ? null : new Date().toISOString() }).eq("id", body.importErrorId).eq("organization_id", context.organizationId).select("id,resolved_at").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Import error not found or access was denied." }, { status: 404 });
  return NextResponse.json(data);
}
