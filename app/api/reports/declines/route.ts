import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const one = (value: unknown) => (Array.isArray(value) ? value[0] || null : value);

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await supabase.rpc("can_manage_game_setup");
  if (accessError || !canManage) return NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 });

  const service = createServiceClient();
  const { data: memberships } = await service.from("organization_memberships").select("organization_id").eq("user_id", user.id);
  const organizationIds = (memberships || []).map((row) => row.organization_id);
  let subscriptionQuery = service.from("refassign_subscriptions").select("reporting_access").in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1);
  subscriptionQuery = organizationIds.length ? subscriptionQuery.in("organization_id", organizationIds) : subscriptionQuery.eq("user_id", user.id);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess = subscription?.reporting_access === "standard" ? "standard" : "premium";

  // This signed-in query is deliberately authoritative for the game list. Audit
  // rows are then restricted to those RLS-visible game IDs before being returned.
  const { data: rawAssignments, error: assignmentError } = await supabase
    .from("assignments")
    .select("id,game_id,position_id,official_id,status,assigned_at,published_at,responded_at,decline_reason,officials(id,first_name,last_name),sport_positions(id,name),games!inner(id,game_number,status,starts_at,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))")
    .not("official_id", "is", null)
    .order("assigned_at", { ascending: false });
  if (assignmentError) return NextResponse.json({ error: assignmentError.message }, { status: 400 });

  const assignments = (rawAssignments || []).map((row) => {
    const game = one(row.games) as Record<string, unknown> | null;
    return {
      ...row,
      officials: one(row.officials),
      sport_positions: one(row.sport_positions),
      games: game ? { ...game, leagues: one(game.leagues), levels: one(game.levels), location: one(game.location), home: one(game.home), away: one(game.away) } : null,
    };
  });
  const { data: officials, error: officialsError } = await supabase
    .from("officials")
    .select("id,first_name,last_name,active")
    .order("last_name")
    .order("first_name");
  if (officialsError) return NextResponse.json({ error: officialsError.message }, { status: 400 });
  const gameIds = [...new Set(assignments.map((row) => row.game_id).filter(Boolean))];
  let history: Array<Record<string, unknown>> = [];
  if (gameIds.length) {
    const { data, error } = await supabase.from("audit_history").select("id,game_id,assignment_id,action,occurred_at,old_data,new_data").in("game_id", gameIds).in("action", ["assigned", "assignment_changed", "assignment_status_changed"]).order("occurred_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    history = data || [];
  }

  const text = (value: unknown) => typeof value === "string" ? value : null;
  const historicalDeclines = history.flatMap((event) => {
    const next = event.new_data && typeof event.new_data === "object" ? event.new_data as Record<string, unknown> : {};
    return next.status === "declined" ? [{
      key: `history-${event.id}`,
      assignment_id: text(event.assignment_id),
      game_id: text(event.game_id),
      position_id: text(next.position_id),
      official_id: text(next.official_id),
      declined_at: text(next.responded_at) || text(event.occurred_at),
      decline_reason: text(next.decline_reason),
    }] : [];
  });
  const recordedIds = new Set(historicalDeclines.map((row) => row.assignment_id).filter(Boolean));
  const currentDeclines = assignments.filter((row) => row.status === "declined" && !recordedIds.has(row.id)).map((row) => ({
    key: `current-${row.id}`,
    assignment_id: row.id,
    game_id: row.game_id,
    position_id: row.position_id,
    official_id: row.official_id,
    declined_at: row.responded_at || row.assigned_at,
    decline_reason: row.decline_reason,
  }));
  const declines = [...historicalDeclines, ...currentDeclines].map((decline) => {
    const replacementEvents = history.flatMap((event) => {
      if (event.game_id !== decline.game_id || new Date(String(event.occurred_at)).getTime() <= new Date(String(decline.declined_at)).getTime()) return [];
      const next = event.new_data && typeof event.new_data === "object" ? event.new_data as Record<string, unknown> : {};
      if (text(next.position_id) !== decline.position_id || text(next.official_id) === decline.official_id || next.status === "declined") return [];
      return [{ official_id: text(next.official_id), replaced_at: text(event.occurred_at) }];
    });
    const currentReplacement = assignments.find((row) => row.game_id === decline.game_id && row.position_id === decline.position_id && row.official_id !== decline.official_id && row.status !== "declined" && new Date(row.assigned_at).getTime() > new Date(String(decline.declined_at)).getTime());
    const replacement = replacementEvents[0] || (currentReplacement ? { official_id: currentReplacement.official_id, replaced_at: currentReplacement.assigned_at } : null);
    return { ...decline, replacement_official_id: replacement?.official_id || null, replaced_at: replacement?.replaced_at || null };
  });

  return NextResponse.json({
    reportingAccess,
    officials: officials || [],
    assignments,
    declines,
    historyAvailable: history.length > 0,
  });
}
