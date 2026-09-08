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

  const requestedOfficialId = request.nextUrl.searchParams.get("officialId");
  const managerScope = request.nextUrl.searchParams.get("scope") === "manager";
  const { data: canManage } = await session.rpc("can_manage_game_setup");
  const service = createServiceClient();
  let officialId = requestedOfficialId;

  // Reports are self-scoped by default, including for users who also hold a
  // manager role. The manager report UI must explicitly request manager scope.
  if (!managerScope || !canManage) {
    const { data: ownOfficial, error: officialError } = await service
      .from("officials")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (officialError || !ownOfficial)
      return NextResponse.json(
        {
          error:
            officialError?.message ||
            "Your login is not linked to an official record.",
        },
        { status: 403 },
      );
    if (officialId && officialId !== ownOfficial.id)
      return NextResponse.json(
        { error: "You can only view your own report." },
        { status: 403 },
      );
    officialId = ownOfficial.id;
  }

  const officialsQuery = service
    .from("officials")
    .select("id,first_name,last_name,active,home_latitude,home_longitude")
    .order("last_name")
    .order("first_name");
  let assignmentsQuery = service
    .from("assignments")
    .select(
      "id,official_id,status,mileage_miles,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games(id,game_number,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,city,state,latitude,longitude),levels(name),leagues(mileage_plan))",
    )
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  if (officialId)
    assignmentsQuery = assignmentsQuery.eq("official_id", officialId);
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
    officials: managerScope && canManage
      ? officialResult.data || []
      : (officialResult.data || []).filter((item) => item.id === officialId),
    assignments: assignmentResult.data || [],
    weekdayOrigins: originResult.data || [],
  });
}
