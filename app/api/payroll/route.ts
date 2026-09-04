import { NextResponse } from "next/server";
import { createServiceClient } from "../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function GET() {
  const session = await createServerSupabaseClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await session.rpc(
    "can_manage_game_setup",
  );
  if (accessError || !canManage)
    return NextResponse.json(
      { error: "Administrator or Assignor access is required." },
      { status: 403 },
    );

  const service = createServiceClient();
  const [assignmentResult, originResult] = await Promise.all([
    service
      .from("assignments")
      .select(
        "id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,payroll_notes,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games(game_number,starts_at,leagues(mileage_plan),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,latitude,longitude))",
      )
      .not("official_id", "is", null)
      .in("status", ["accepted", "confirmed"])
      .order("assigned_at", { ascending: false }),
    service
      .from("official_weekday_origins")
      .select(
        "official_id,weekday,use_home,alternate_label,alternate_latitude,alternate_longitude",
      ),
  ]);

  const loadError = assignmentResult.error || originResult.error;
  if (loadError) {
    console.error("[api/payroll] manager payroll load failed", {
      userId: user.id,
      error: loadError.message,
    });
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }

  console.info("[api/payroll] manager payroll loaded", {
    userId: user.id,
    assignments: assignmentResult.data?.length || 0,
  });
  return NextResponse.json({
    assignments: assignmentResult.data || [],
    weekdayOrigins: originResult.data || [],
  });
}
