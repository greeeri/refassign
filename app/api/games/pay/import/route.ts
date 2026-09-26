import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../../lib/server/organizationScope";

type Row = { spreadsheetRow?: number; gameId?: string; positionId?: string; gameFee?: number };

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, ["owner", "admin", "assignor"]);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  const body = await request.json().catch(() => ({})) as { rows?: Row[] };
  const rows = body.rows || [];
  if (!rows.length || rows.length > 5000) return NextResponse.json({ error: "Include between 1 and 5,000 game position fees." }, { status: 400 });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.gameId}:${row.positionId}`;
    if (!row.gameId || !row.positionId || !Number.isFinite(row.gameFee) || Number(row.gameFee) < 0 || seen.has(key))
      return NextResponse.json({ error: `Spreadsheet row ${row.spreadsheetRow || "?"}: Invalid or duplicate game position fee.` }, { status: 400 });
    seen.add(key);
  }
  const gameIds = [...new Set(rows.map((row) => row.gameId!))];
  const games: Array<{ id: string; sport_id: string; league_id: string | null; officials_needed: number }> = [];
  for (let offset = 0; offset < gameIds.length; offset += 200) {
    const { data, error } = await service.from("games").select("id,sport_id,league_id,officials_needed").eq("organization_id", organizationId).in("id", gameIds.slice(offset, offset + 200));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    games.push(...(data || []));
  }
  const byGame = new Map(games.map((game) => [game.id, game]));
  const sportIds = [...new Set(games.map((game) => game.sport_id))];
  const { data: positions, error: positionsError } = sportIds.length
    ? await service.from("sport_positions").select("id,sport_id,sort_order").in("sport_id", sportIds).order("sort_order").order("id")
    : { data: [], error: null };
  if (positionsError) return NextResponse.json({ error: positionsError.message }, { status: 400 });
  for (const row of rows) {
    const game = byGame.get(row.gameId!);
    const permitted = (positions || []).filter((position) => position.sport_id === game?.sport_id).slice(0, game?.officials_needed || 0);
    if (!game || (leagueIds && (!game.league_id || !leagueIds.includes(game.league_id))) || !permitted.some((position) => position.id === row.positionId))
      return NextResponse.json({ error: `Spreadsheet row ${row.spreadsheetRow || "?"}: Game position is unavailable for this organization.` }, { status: 400 });
  }
  const { data, error } = await service.rpc("import_game_position_pay", {
    p_organization_id: organizationId,
    p_rows: rows.map((row) => ({ spreadsheet_row: row.spreadsheetRow, game_id: row.gameId, position_id: row.positionId, amount: row.gameFee })),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ updated: Number(data) });
}
