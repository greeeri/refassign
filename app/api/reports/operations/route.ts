import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

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

  // All operational records are read with the signed-in client so the current
  // organization and league RLS policies determine the report's boundaries.
  const [gamesResult, assignmentsResult, auditResult] = await Promise.all([
    supabase
      .from("games")
      .select(
        "id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name)",
      )
      .order("starts_at", { ascending: false }),
    supabase
      .from("assignments")
      .select(
        "id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,published_at,accept_by,responded_at,officials(id,first_name,last_name),sport_positions(name)",
      )
      .order("assigned_at", { ascending: false }),
    supabase
      .from("audit_history")
      .select("game_id,action,occurred_at")
      .in("action", ["assignment_changed", "unassigned"]),
  ]);
  const error =
    gamesResult.error || assignmentsResult.error || auditResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    games: gamesResult.data || [],
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
    audit: auditResult.data || [],
  });
}
