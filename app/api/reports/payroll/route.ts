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
  const organizationIds = (memberships || []).map((row) => row.organization_id);
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
  if (subscription?.reporting_access === "standard")
    return NextResponse.json(
      {
        error: "Premium reporting is required for payroll and payment reports.",
        reportingAccess: "standard",
      },
      { status: 403 },
    );

  // The signed-in client preserves organization and league RLS filtering.
  const { data, error } = await supabase
    .from("assignments")
    .select(
      "id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name),sport_positions(name),games(id,game_number,starts_at,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
    )
    .not("official_id", "is", null)
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    reportingAccess: "premium",
    assignments: data || [],
  });
}
