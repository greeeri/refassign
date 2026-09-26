import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { session: supabase, service, organizationId } = scope;
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
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
  const { data, error } = await readAllPages<Record<string, any>>((from, to) =>
    supabase
      .from("assignments")
      .select(
        "id,position_id,status,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,officials(id,first_name,last_name),sport_positions(name),games!inner(id,organization_id,game_number,starts_at,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))",
      )
      .eq("games.organization_id", organizationId)
      .not("official_id", "is", null)
      .in("status", ["accepted", "confirmed"])
      .order("assigned_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  const gameIds = [...new Set((data || []).map((row) => row.games?.id).filter(Boolean))] as string[];
  // Include empty game positions for games the signed-in user may view.
  const visibleGames = await readAllPages<{ id: string }>((from, to) =>
    supabase.from("games").select("id").eq("organization_id", organizationId).order("id").range(from, to),
  );
  if (visibleGames.error) return NextResponse.json({ error: visibleGames.error.message }, { status: 400 });
  const allowedIds = [...new Set([...gameIds, ...(visibleGames.data || []).map((game) => game.id)])];
  const rates: Record<string, any>[] = [];
  for (let index = 0; index < allowedIds.length; index += 200) {
    const result = await readAllPages<Record<string, any>>((from, to) =>
      service.from("game_position_pay")
        .select("game_id,position_id,amount,payment_status,sport_positions(name),games!inner(id,game_number,starts_at,leagues(id,name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))")
        .in("game_id", allowedIds.slice(index, index + 200)).order("game_id").order("position_id").range(from, to),
    );
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    rates.push(...(result.data || []));
  }
  const occupied = new Set((data || []).filter((row) => ["accepted", "confirmed"].includes(row.status)).map((row) => `${row.games?.id}:${row.position_id}`));
  const vacant = rates.filter((rate) => !occupied.has(`${rate.game_id}:${rate.position_id}`)).map((rate) => ({
    id: `vacant:${rate.game_id}:${rate.position_id}`, status: "unassigned", game_fee: rate.amount,
    mileage_miles: 0, mileage_rate: 0, payment_status: rate.payment_status,
    paid_at: null, officials: null, sport_positions: rate.sport_positions, games: rate.games,
  }));
  return NextResponse.json({
    reportingAccess: "premium",
    assignments: [...(data || []), ...vacant],
  });
}
