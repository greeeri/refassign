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
  const byGameRows = new Map<string, Row[]>();
  for (const row of rows) byGameRows.set(row.gameId!, [...(byGameRows.get(row.gameId!) || []), row]);
  const normalizedRows: Row[] = [];
  let splitGames = 0;
  let skippedUnused = 0;
  for (const [gameId, gameRows] of byGameRows) {
    const game = byGame.get(gameId);
    const sportPositions = (positions || []).filter((position) => position.sport_id === game?.sport_id);
    const permitted = sportPositions.slice(0, game?.officials_needed || 0);
    const firstInvalid = gameRows.find((row) => !sportPositions.some((position) => position.id === row.positionId));
    if (!game || (leagueIds && (!game.league_id || !leagueIds.includes(game.league_id))) || firstInvalid)
      return NextResponse.json({ error: `Spreadsheet row ${firstInvalid?.spreadsheetRow || gameRows[0].spreadsheetRow || "?"}: Game position is unavailable for this organization.` }, { status: 400 });
    const extraRows = gameRows.filter((row) => !permitted.some((position) => position.id === row.positionId));
    const activeRows = gameRows.filter((row) => permitted.some((position) => position.id === row.positionId));
    if (extraRows.length === 1 && game.officials_needed === 2 && activeRows.length === 2
      && extraRows[0].positionId === sportPositions[2]?.id) {
      const totalCents = gameRows.reduce((total, row) => total + Math.round(row.gameFee! * 100), 0);
      const halfCents = Math.floor(totalCents / 2);
      normalizedRows.push(...activeRows.map((row, index) => ({ ...row, gameFee: (halfCents + (index === 0 ? totalCents % 2 : 0)) / 100 })));
      splitGames++;
    } else if (extraRows.length && game.officials_needed === 1) {
      normalizedRows.push(...activeRows);
      skippedUnused += extraRows.length;
    } else if (extraRows.length) {
      return NextResponse.json({ error: `Spreadsheet row ${extraRows[0].spreadsheetRow || "?"}: This game uses ${game.officials_needed} positions. Enter all three fees for a two-official split, or leave unused position fees blank.` }, { status: 400 });
    } else normalizedRows.push(...activeRows);
  }
  const protectedKeys = new Set<string>();
  for (let offset = 0; offset < gameIds.length; offset += 100) {
    const { data: protectedAssignments, error: protectedError } = await service.from("assignments")
      .select("game_id,position_id,payment_status,status")
      .in("game_id", gameIds.slice(offset, offset + 100))
      .in("payment_status", ["approved", "paid"])
      .in("status", ["proposed", "accepted", "confirmed"]);
    if (protectedError) return NextResponse.json({ error: protectedError.message }, { status: 400 });
    for (const assignment of protectedAssignments || [])
      protectedKeys.add(`${assignment.game_id}:${assignment.position_id}`);
  }
  const eligibleRows = normalizedRows.filter((row) => !protectedKeys.has(`${row.gameId}:${row.positionId}`));
  const skippedProtected = normalizedRows.length - eligibleRows.length;
  if (!eligibleRows.length)
    return NextResponse.json({ error: `All ${skippedProtected} game position fees belong to approved or paid payroll. No fees were changed. Correct those payments in Payroll first.` }, { status: 409 });
  const { data, error } = await service.rpc("import_game_position_pay", {
    p_organization_id: organizationId,
    p_rows: eligibleRows.map((row) => ({ spreadsheet_row: row.spreadsheetRow, game_id: row.gameId, position_id: row.positionId, amount: row.gameFee })),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ updated: Number(data), splitGames, skippedUnused, skippedProtected });
}
