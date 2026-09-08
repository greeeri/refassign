import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

async function managerContext() {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: canManage, error: accessError } = await session.rpc("can_manage_game_setup");
  if (accessError || !canManage) return { error: NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 }) };
  return { session, user };
}

export async function GET() {
  const context = await managerContext();
  if (context.error) return context.error;
  const { session, user } = context;
  const service = createServiceClient();
  const { data: memberships } = await service.from("organization_memberships").select("organization_id").eq("user_id", user.id);
  const organizationIds = (memberships || []).map((row) => row.organization_id);
  let subscriptionQuery = service.from("refassign_subscriptions").select("reporting_access").in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1);
  subscriptionQuery = organizationIds.length ? subscriptionQuery.in("organization_id", organizationIds) : subscriptionQuery.eq("user_id", user.id);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess = subscription?.reporting_access === "standard" ? "standard" : "premium";

  const [auditResult, importResult, gamesResult, assignmentsResult, organizationsResult] = await Promise.all([
    session.from("audit_history").select("id,organization_id,entity_type,entity_id,game_id,assignment_id,action,actor_name,summary,old_data,new_data,occurred_at").order("occurred_at", { ascending: false }).limit(1000),
    session.from("import_error_log").select("id,organization_id,import_type,file_name,error_message,row_number,resolved_at,created_at").order("created_at", { ascending: false }).limit(500),
    session.from("games").select("id,organization_id,game_number,starts_at,status,source_system,source_event_id,source_match_id,source_synced_at,leagues(name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)"),
    session.from("assignments").select("id,game_id,status,email_error,cancellation_email_error"),
    organizationIds.length ? service.from("organizations").select("id,name").in("id", organizationIds).order("name") : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = auditResult.error || importResult.error || gamesResult.error || assignmentsResult.error || organizationsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const games = gamesResult.data || [];
  const sourceKeys = new Set(games.filter((game) => game.source_system && game.source_event_id).map((game) => `${game.source_system}:${game.source_event_id}`));
  let syncRuns: Array<Record<string, unknown>> = [];
  if (organizationIds.length || sourceKeys.size) {
    let query = service.from("schedule_sync_runs").select("id,organization_id,source_system,source_event_id,started_at,finished_at,status,groups_checked,games_found,games_added,games_updated,games_cancelled,games_skipped,error_message").order("started_at", { ascending: false }).limit(250);
    if (organizationIds.length) query = query.in("organization_id", organizationIds);
    else query = query.in("source_system", [...new Set([...sourceKeys].map((key) => key.split(":")[0]))]);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    syncRuns = organizationIds.length ? data || [] : (data || []).filter((run) => sourceKeys.has(`${run.source_system}:${run.source_event_id}`));
  }
  const gameIds = games.map((game) => game.id);
  let communications: Array<Record<string, unknown>> = [];
  if (gameIds.length) {
    const { data, error } = await service.from("official_communications").select("id,game_id,delivery_status,error_message,created_at").in("game_id", gameIds).order("created_at", { ascending: false }).limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    communications = data || [];
  }
  return NextResponse.json({ reportingAccess, organizations: organizationsResult.data || [], audit: auditResult.data || [], importErrors: importResult.data || [], syncRuns, games, assignments: assignmentsResult.data || [], communications });
}

export async function PATCH(request: NextRequest) {
  const context = await managerContext();
  if (context.error) return context.error;
  const body = await request.json().catch(() => ({})) as { importErrorId?: number; resolved?: boolean };
  if (!Number.isInteger(body.importErrorId)) return NextResponse.json({ error: "An import error is required." }, { status: 400 });
  const { data, error } = await context.session.from("import_error_log").update({ resolved_at: body.resolved === false ? null : new Date().toISOString() }).eq("id", body.importErrorId).select("id,resolved_at").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Import error not found or access was denied." }, { status: 404 });
  return NextResponse.json(data);
}
