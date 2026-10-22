import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllForChunks, readAllPages } from "../../../../lib/supabase/readAll";
import { readReportOfficialLinks, scopeReportLeagues } from "../reportScope";

export async function GET(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId)
    return NextResponse.json({ error: "Select an organization." }, { status: 400 });
  const managerScope = request.nextUrl.searchParams.get("scope") === "manager";
  const service = createServiceClient();
  let officialId = request.nextUrl.searchParams.get("officialId");
  let leagueIds: string[] | null = null;
  let reportScope: Parameters<typeof scopeReportLeagues>[1] = { fullOrganizationAccess: true };
  let officialIds: string[];

  // Manager authority is freshly resolved from actual memberships and league
  // grants. An official's own report remains independent of any manager role.
  if (managerScope) {
    const scope = await requireManagedOrganization(request);
    if (scope.error) return scope.error;
    leagueIds = scope.leagueIds;
    reportScope = scope;
    const links = await readReportOfficialLinks(scope);
    if (links.error)
      return NextResponse.json({ error: links.error.message }, { status: 400 });
    officialIds = (links.data || []).map((row) => row.official_id);
    if (officialId && !officialIds.includes(officialId))
      return NextResponse.json({ error: "That official is outside your league access." }, { status: 403 });
  } else {
    const { data: ownOfficial, error: officialError } = await service
      .from("officials").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (officialError)
      return NextResponse.json({ error: officialError.message }, { status: 400 });
    if (!ownOfficial)
      return NextResponse.json({ error: "Your official profile is not linked to this organization." }, { status: 403 });
    const { data: ownLink, error: linkError } = await service
      .from("organization_officials").select("official_id")
      .eq("organization_id", organizationId).eq("official_id", ownOfficial.id)
      .eq("active", true).maybeSingle();
    if (linkError)
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    if (!ownLink)
      return NextResponse.json({ error: "Your official profile is not linked to this organization." }, { status: 403 });
    if (officialId && officialId !== ownOfficial.id)
      return NextResponse.json({ error: "You can only view your own report." }, { status: 403 });
    officialId = ownOfficial.id;
    officialIds = [ownOfficial.id];
  }

  const { data: subscription } = await service.from("refassign_subscriptions")
    .select("reporting_access").eq("organization_id", organizationId)
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const reportingAccess = subscription?.reporting_access === "standard" ? "standard" : "premium";

  let assignmentsQuery = scopeReportLeagues(service.from("assignments")
    .select(
      "id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games!inner(id,organization_id,league_id,game_number,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,city,state,latitude,longitude),levels(name),leagues(name,mileage_plan))",
    )
    .eq("games.organization_id", organizationId), reportScope, "games.league_id")
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  if (officialId) assignmentsQuery = assignmentsQuery.eq("official_id", officialId);

  const originOfficialIds = officialId ? [officialId] : officialIds;
  const [officialResult, assignmentResult, originResult] = await Promise.all([
    readAllForChunks<Record<string, any>, string>(officialIds, (ids, from, to) => service
      .from("officials").select("id,first_name,last_name,active,home_latitude,home_longitude")
      .in("id", ids).order("last_name").order("first_name").order("id").range(from, to)),
    readAllPages<Record<string, any>>((from, to) => assignmentsQuery.order("id").range(from, to)),
    // Always bound origins, including the manager's "all officials" view.
    readAllForChunks<Record<string, any>, string>(originOfficialIds, (ids, from, to) => service
      .from("official_weekday_origins")
      .select("official_id,weekday,use_home,alternate_latitude,alternate_longitude")
      .in("official_id", ids).order("official_id").order("weekday").range(from, to)),
  ]);
  const error = officialResult.error || assignmentResult.error || originResult.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    canManage: managerScope,
    selectedOfficialId: officialId,
    officials: officialResult.data || [],
    reportingAccess,
    assignments: (assignmentResult.data || []).map((assignment) =>
      reportingAccess === "premium" ? assignment : {
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
