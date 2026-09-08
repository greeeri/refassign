import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await supabase.rpc("can_manage_game_setup");
  if (accessError || !canManage) return NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 });

  const service = createServiceClient();
  const { data: memberships, error: membershipError } = await service
    .from("organization_memberships")
    .select("organization_id,role,viewer_permissions")
    .eq("user_id", user.id);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 400 });

  const organizationIds = [...new Set((memberships || []).filter((row) => ["owner", "admin", "assignor"].includes(row.role) || (row.role === "viewer" && (row.viewer_permissions || []).includes("reporting"))).map((row) => row.organization_id))];
  if (!organizationIds.length) return NextResponse.json({ reportingAccess: "standard", organizations: [], games: [], assignments: [], roster: [] });

  const { data: subscriptions, error: subscriptionError } = await service
    .from("refassign_subscriptions")
    .select("organization_id,reporting_access,created_at")
    .in("organization_id", organizationIds)
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false });
  if (subscriptionError) return NextResponse.json({ error: subscriptionError.message }, { status: 400 });

  const latestAccess = new Map<string, string>();
  (subscriptions || []).forEach((row) => {
    if (row.organization_id && !latestAccess.has(row.organization_id)) latestAccess.set(row.organization_id, row.reporting_access);
  });
  const premiumOrganizationIds = organizationIds.filter((id) => latestAccess.get(id) !== "standard");
  if (!premiumOrganizationIds.length) return NextResponse.json({ reportingAccess: "standard", organizations: [], games: [], assignments: [], roster: [] });

  const earliest = new Date(Date.now() - 360 * 86400000).toISOString();
  const latest = new Date(Date.now() + 180 * 86400000).toISOString();
  const [organizationsResult, gamesResult, rosterResult] = await Promise.all([
    service.from("organizations").select("id,name").in("id", premiumOrganizationIds).order("name"),
    service.from("games").select("id,organization_id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(id,name),location:locations(id,name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name)").in("organization_id", premiumOrganizationIds).gte("starts_at", earliest).lte("starts_at", latest).order("starts_at", { ascending: false }),
    service.from("organization_officials").select("organization_id,official_id,active").in("organization_id", premiumOrganizationIds),
  ]);
  const firstError = organizationsResult.error || gamesResult.error || rosterResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const gameIds = (gamesResult.data || []).map((game) => game.id);
  const assignmentsResult = gameIds.length
    ? await service.from("assignments").select("id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,assigned_at,responded_at").in("game_id", gameIds)
    : { data: [], error: null };
  if (assignmentsResult.error) return NextResponse.json({ error: assignmentsResult.error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess: "premium",
    organizations: organizationsResult.data || [],
    games: gamesResult.data || [],
    assignments: assignmentsResult.data || [],
    roster: rosterResult.data || [],
  });
}
