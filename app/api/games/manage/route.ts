import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

const actions = ["archive", "archive_cancelled", "restore", "delete"] as const;
type Action = (typeof actions)[number];

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  const body = (await request.json().catch(() => ({}))) as {
    action?: Action;
    gameIds?: string[];
  };
  const gameIds = [...new Set((body.gameIds || []).filter(Boolean))];
  if (!body.action || !actions.includes(body.action))
    return NextResponse.json(
      { error: "Choose a valid action." },
      { status: 400 },
    );
  if (body.action === "archive_cancelled") {
    if (leagueIds && !leagueIds.length)
      return NextResponse.json({ updated: 0, action: body.action });
    let query = service.from("games")
      .update({ archived_at: new Date().toISOString() }, { count: "exact" })
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .in("status", ["canceled", "cancelled"]);
    if (leagueIds) query = query.in("league_id", leagueIds);
    const { count, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ updated: count || 0, action: body.action });
  }
  if (!gameIds.length)
    return NextResponse.json({ error: "Choose at least one game." }, { status: 400 });
  if (gameIds.length > 500)
    return NextResponse.json(
      { error: "Manage up to 500 games at a time." },
      { status: 400 },
    );

  const { data: ownedGames, error: ownershipError } = await service
    .from("games")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", gameIds);
  if (ownershipError)
    return NextResponse.json({ error: ownershipError.message }, { status: 400 });
  if ((ownedGames || []).length !== gameIds.length)
    return NextResponse.json(
      { error: "One or more games do not belong to this organization." },
      { status: 403 },
    );

  const query =
    body.action === "delete"
      ? service.from("games").delete().eq("organization_id", organizationId).in("id", gameIds)
      : service
          .from("games")
          .update({ archived_at: body.action === "archive" ? new Date().toISOString() : null })
          .eq("organization_id", organizationId)
          .in("id", gameIds);
  const { data: changedGames, error } = await query.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if ((changedGames || []).length !== gameIds.length)
    return NextResponse.json(
      { error: "One or more games changed before this action completed. Refresh and try again." },
      { status: 409 },
    );
  return NextResponse.json({ updated: changedGames.length, action: body.action });
}
