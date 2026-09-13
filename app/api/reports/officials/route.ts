import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId)
    return NextResponse.json({ error: "Select an organization." }, { status: 400 });
  const requestedOfficialId = request.nextUrl.searchParams.get("officialId");
  const managerScope = request.nextUrl.searchParams.get("scope") === "manager";
  const service = createServiceClient();
  let officialId = requestedOfficialId;

  const [{ data: managerMembership }, { data: ownOfficial }] = await Promise.all([
    service
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .in("role", ["owner", "admin", "assignor"])
      .maybeSingle(),
    service
      .from("officials")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
  ]);
  const canManage = Boolean(managerMembership);
  const { data: ownOfficialLink } = ownOfficial
    ? await service
        .from("organization_officials")
        .select("official_id")
        .eq("organization_id", organizationId)
        .eq("official_id", ownOfficial.id)
        .eq("active", true)
        .maybeSingle()
    : { data: null };
  if (!canManage && !ownOfficialLink)
    return NextResponse.json(
      { error: "You do not have access to this organization." },
      { status: 403 },
    );

  // Prefer the organization subscription when organization workspaces are
  // enabled; direct subscriptions remain supported for legacy accounts.
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
  const { data: reportingSubscription } = await subscriptionQuery.maybeSingle();
  // Existing accounts are grandfathered into premium until a Super Admin
  // explicitly assigns standard access.
  const reportingAccess =
    reportingSubscription?.reporting_access === "standard"
      ? "standard"
      : "premium";

  // Reports are self-scoped by default, including for users who also hold a
  // manager role. The manager report UI must explicitly request manager scope.
  if (!managerScope || !canManage) {
    if (!ownOfficial || !ownOfficialLink)
      return NextResponse.json(
        { error: "Your official profile is not linked to this organization." },
        { status: 403 },
      );
    if (officialId && officialId !== ownOfficial.id)
      return NextResponse.json(
        { error: "You can only view your own report." },
        { status: 403 },
      );
    officialId = ownOfficial.id;
  }

  const [{ data: organizationOfficials, error: organizationOfficialError }, { data: organizationGames, error: organizationGameError }] = await Promise.all([
    service
      .from("organization_officials")
      .select("official_id")
      .eq("organization_id", organizationId)
      .eq("active", true),
    service.from("games").select("id").eq("organization_id", organizationId),
  ]);
  if (organizationOfficialError || organizationGameError)
    return NextResponse.json(
      { error: organizationOfficialError?.message || organizationGameError?.message },
      { status: 400 },
    );
  const organizationOfficialIds = (organizationOfficials || []).map((row) => row.official_id);
  const organizationGameIds = (organizationGames || []).map((row) => row.id);
  if (managerScope && canManage && officialId && !organizationOfficialIds.includes(officialId))
    return NextResponse.json({ error: "That official is not active in this organization." }, { status: 403 });

  let officialsQuery = service
    .from("officials")
    .select("id,first_name,last_name,active,home_latitude,home_longitude")
    .order("last_name")
    .order("first_name");
  if (organizationOfficialIds.length)
    officialsQuery = officialsQuery.in("id", organizationOfficialIds);
  else officialsQuery = officialsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  let assignmentsQuery = service
    .from("assignments")
    .select(
      "id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games(id,game_number,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,city,state,latitude,longitude),levels(name),leagues(name,mileage_plan))",
    )
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  if (officialId)
    assignmentsQuery = assignmentsQuery.eq("official_id", officialId);
  if (organizationGameIds.length)
    assignmentsQuery = assignmentsQuery.in("game_id", organizationGameIds);
  else assignmentsQuery = assignmentsQuery.eq("game_id", "00000000-0000-0000-0000-000000000000");
  let originsQuery = service
    .from("official_weekday_origins")
    .select(
      "official_id,weekday,use_home,alternate_latitude,alternate_longitude",
    );
  if (officialId) originsQuery = originsQuery.eq("official_id", officialId);

  const [officialResult, assignmentResult, originResult] = await Promise.all([
    officialsQuery,
    assignmentsQuery,
    originsQuery,
  ]);
  const error =
    officialResult.error || assignmentResult.error || originResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    canManage: Boolean(managerScope && canManage),
    selectedOfficialId: officialId,
    officials:
      managerScope && canManage
        ? officialResult.data || []
        : (officialResult.data || []).filter((item) => item.id === officialId),
    reportingAccess,
    assignments: (assignmentResult.data || []).map((assignment) =>
      reportingAccess === "premium"
        ? assignment
        : {
            ...assignment,
            game_fee: 0,
            mileage_rate: 0,
            payment_status: "unpaid",
            paid_at: null,
          },
    ),
    weekdayOrigins: originResult.data || [],
  });
}
