import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : null;

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await supabase.rpc(
    "can_manage_game_setup",
  );
  if (accessError || !canManage)
    return NextResponse.json(
      { error: "Administrator or Assignor access is required." },
      { status: 403 },
    );

  const service = createServiceClient();
  const { data: memberships } = await service
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", user.id);
  const organizationIds = (memberships || []).map(
    (row) => row.organization_id,
  );
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = organizationIds.length
    ? subscriptionQuery.in("organization_id", organizationIds)
    : subscriptionQuery.eq("user_id", user.id);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess =
    subscription?.reporting_access === "standard" ? "standard" : "premium";

  // The signed-in client keeps officials, assignments, games, and audit rows
  // inside the organizations and leagues permitted by the current RLS rules.
  const [officialsResult, assignmentsResult, auditResult] = await Promise.all([
    supabase
      .from("officials")
      .select("id,first_name,last_name,active,max_games_per_day")
      .order("last_name")
      .order("first_name"),
    supabase
      .from("assignments")
      .select(
        "id,official_id,status,assigned_at,published_at,responded_at,game_fee,mileage_miles,mileage_rate,payment_status,officials(id,first_name,last_name),sport_positions(name),games!inner(id,game_number,starts_at,status,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
      )
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
