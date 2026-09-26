import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, ["owner", "admin", "assignor", "billing"]);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  if (leagueIds?.length === 0) return NextResponse.json({ positions: [], rates: [] });
  const games = await readAllPages<{ id: string; league_id: string | null }>((from, to) => {
    let query = service.from("games").select("id,league_id").eq("organization_id", organizationId).order("id");
    if (leagueIds) query = query.in("league_id", leagueIds);
    return query.range(from, to);
  });
  if (games.error) return NextResponse.json({ error: games.error.message }, { status: 400 });
  const sports = await service.from("sport_positions").select("id,sport_id,name,sort_order").order("sort_order");
  if (sports.error) return NextResponse.json({ error: sports.error.message }, { status: 400 });
  const ids = (games.data || []).map((game) => game.id);
  const rates: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const result = await readAllPages<Record<string, unknown>>((from, to) =>
      service.from("game_position_pay").select("game_id,position_id,amount,payment_status").in("game_id", chunk).order("game_id").order("position_id").range(from, to),
    );
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    rates.push(...(result.data || []));
  }
  return NextResponse.json({ positions: sports.data || [], rates });
}

export async function PUT(request: NextRequest) {
  const context = await requireManagedOrganization(request, ["owner", "admin", "assignor"]);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  const body = await request.json() as { gameId?: string; rates?: Array<{ positionId: string; amount: number }> };
  if (!body.gameId || !Array.isArray(body.rates)) return NextResponse.json({ error: "Game and position pay are required." }, { status: 400 });
  if (body.rates.some((rate) => !Number.isFinite(rate.amount) || rate.amount < 0))
    return NextResponse.json({ error: "Pay must be a nonnegative number." }, { status: 400 });
  const { data: game } = await service.from("games").select("id,sport_id,league_id,officials_needed").eq("id", body.gameId).eq("organization_id", organizationId).single();
  if (!game || (leagueIds && (!game.league_id || !leagueIds.includes(game.league_id))))
    return NextResponse.json({ error: "Game is not available." }, { status: 404 });
  const { data: positions, error: positionError } = await service.from("sport_positions").select("id").eq("sport_id", game.sport_id).order("sort_order").order("id").limit(game.officials_needed);
  if (positionError) return NextResponse.json({ error: positionError.message }, { status: 400 });
  const allowed = new Set((positions || []).map((position) => position.id));
  if (body.rates.some((rate) => !allowed.has(rate.positionId)) || new Set(body.rates.map((rate) => rate.positionId)).size !== body.rates.length)
    return NextResponse.json({ error: "A pay position does not belong to this game." }, { status: 400 });
  for (const rate of body.rates) {
    const { error } = await service.from("game_position_pay").upsert({ game_id: game.id, position_id: rate.positionId, amount: rate.amount }, { onConflict: "game_id,position_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    // Keep unprocessed assignment amounts in sync; completed and overridden payroll stays intact.
    const { error: syncError } = await service.from("assignments").update({ game_fee: rate.amount }).eq("game_id", game.id).eq("position_id", rate.positionId).in("payment_status", ["unpaid"]).in("status", ["proposed", "accepted", "confirmed"]);
    if (syncError) return NextResponse.json({ error: syncError.message }, { status: 400 });
  }
  return NextResponse.json({ saved: true });
}
