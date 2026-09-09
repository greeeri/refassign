import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const { service, user, organizationId } = context;
  const assignmentResult = await service
    .from("assignments")
    .select(
      "id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,payroll_notes,officials(id,first_name,last_name,home_latitude,home_longitude),sport_positions(name),games!inner(game_number,starts_at,organization_id,leagues(name,mileage_plan),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name,latitude,longitude))",
    )
    .eq("games.organization_id", organizationId)
    .not("official_id", "is", null)
    .in("status", ["accepted", "confirmed"])
    .order("assigned_at", { ascending: false });
  const officialIds = [
    ...new Set(
      (assignmentResult.data || [])
        .map((row) => {
          const official = row.officials as unknown as
            | { id: string }
            | Array<{ id: string }>
            | null;
          return Array.isArray(official) ? official[0]?.id : official?.id;
        })
        .filter(Boolean),
    ),
  ] as string[];
  const originResult = officialIds.length
    ? await service
        .from("official_weekday_origins")
        .select(
          "official_id,weekday,use_home,alternate_label,alternate_latitude,alternate_longitude",
        )
        .in("official_id", officialIds)
    : { data: [], error: null };

  const loadError = assignmentResult.error || originResult.error;
  if (loadError) {
    console.error("[api/payroll] manager payroll load failed", {
      userId: user.id,
      organizationId,
      error: loadError.message,
    });
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }

  console.info("[api/payroll] manager payroll loaded", {
    userId: user.id,
    organizationId,
    assignments: assignmentResult.data?.length || 0,
  });
  return NextResponse.json({
    assignments: assignmentResult.data || [],
    weekdayOrigins: originResult.data || [],
  });
}
