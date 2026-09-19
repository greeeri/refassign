import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

type FeeRow = {
  spreadsheetRow?: number;
  assignmentId?: string;
  gameId?: string;
  gameFee?: number;
};

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, [
    "owner",
    "admin",
    "assignor",
    "billing",
  ]);
  if (context.error) return context.error;
  const { session, service, user, organizationId, leagueIds } = context;
  const body = (await request.json().catch(() => ({}))) as { rows?: FeeRow[] };
  const rows = body.rows || [];
  if (!rows.length || rows.length > 5000)
    return NextResponse.json(
      { error: "Include between 1 and 5,000 assignment fee rows." },
      { status: 400 },
    );

  const ids = rows.map((row) => String(row.assignmentId || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    return NextResponse.json(
      { error: "Every fee row must have one unique Assignment ID." },
      { status: 400 },
    );
  const invalid = rows.find(
    (row) => !Number.isFinite(Number(row.gameFee)) || Number(row.gameFee) < 0,
  );
  if (invalid)
    return NextResponse.json(
      { error: `Spreadsheet row ${invalid.spreadsheetRow || "?"}: Game Fee must be zero or greater.` },
      { status: 400 },
    );

  const { data: assignments, error: loadError } = await service
    .from("assignments")
    .select("id,game_id,status,payment_status,games!inner(organization_id,league_id)")
    .in("id", ids)
    .eq("games.organization_id", organizationId);
  if (loadError)
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  const byId = new Map((assignments || []).map((row) => [row.id, row]));
  for (const row of rows) {
    const assignment = byId.get(String(row.assignmentId));
    const sheetRow = row.spreadsheetRow || "?";
    if (!assignment)
      return NextResponse.json(
        { error: `Spreadsheet row ${sheetRow}: Assignment was not found in this organization.` },
        { status: 400 },
      );
    const game = Array.isArray(assignment.games) ? assignment.games[0] : assignment.games;
    if (row.gameId && row.gameId !== assignment.game_id)
      return NextResponse.json(
        { error: `Spreadsheet row ${sheetRow}: Assignment ID no longer matches the exported game.` },
        { status: 400 },
      );
    if (leagueIds && (!game?.league_id || !leagueIds.includes(game.league_id)))
      return NextResponse.json(
        { error: `Spreadsheet row ${sheetRow}: You do not have access to update this league.` },
        { status: 403 },
      );
    if (["declined", "cancelled", "canceled"].includes(assignment.status))
      return NextResponse.json(
        { error: `Spreadsheet row ${sheetRow}: The assignment is no longer active.` },
        { status: 400 },
      );
    if (assignment.payment_status === "paid")
      return NextResponse.json(
        { error: `Spreadsheet row ${sheetRow}: A paid assignment fee cannot be changed.` },
        { status: 400 },
      );
  }

  const { data: updated, error: importError } = await session.rpc(
    "import_assignment_game_fees",
    {
      p_organization_id: organizationId,
      p_rows: rows.map((row) => ({
        spreadsheet_row: row.spreadsheetRow,
        assignment_id: row.assignmentId,
        game_id: row.gameId || null,
        game_fee: Number(row.gameFee),
      })),
    },
  );
  if (importError)
    return NextResponse.json({ error: importError.message }, { status: 400 });
  console.info("[api/assignments/import-fees] assignment fees imported", {
    userId: user.id,
    organizationId,
    updated: Number(updated || rows.length),
  });
  return NextResponse.json({ updated: Number(updated || rows.length) });
}
