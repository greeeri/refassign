import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendOfficialNotification } from "../../../../lib/communications/officialCc";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

type RecipientRow = {
  official_id: string;
  officials:
    | {
        first_name: string;
        last_name: string;
        email: string | null;
        active: boolean;
      }
    | Array<{
        first_name: string;
        last_name: string;
        email: string | null;
        active: boolean;
      }>
    | null;
};

function esc(value: unknown) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request);
  if (context.error) return context.error;
  const {
    session,
    service,
    organizationId,
    fullOrganizationAccess,
    leagueIds,
  } = context;
  const body = (await request.json().catch(() => ({}))) as {
    gameIds?: string[];
    requestId?: string;
  };
  const gameIds = [...new Set((body.gameIds || []).filter(Boolean))];
  if (!gameIds.length || gameIds.length > 250)
    return NextResponse.json(
      { error: "Select between 1 and 250 games to broadcast." },
      { status: 400 },
    );

  let gameQuery = service
    .from("games")
    .select(
      "id,game_number,sport_id,league_id,officials_needed,time_tbd,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)",
    )
    .eq("organization_id", organizationId)
    .in("id", gameIds);
  if (!fullOrganizationAccess)
    gameQuery = gameQuery.in("league_id", leagueIds || []);
  const { data: games, error: gameError } = await gameQuery;
  if (gameError)
    return NextResponse.json({ error: gameError.message }, { status: 400 });
  if ((games || []).length !== gameIds.length)
    return NextResponse.json(
      { error: "One or more selected games are outside your league access." },
      { status: 403 },
    );
  if ((games || []).some((game) => game.time_tbd))
    return NextResponse.json(
      { error: "Enter the game time before broadcasting it." },
      { status: 400 },
    );

  const sportIds = [...new Set((games || []).map((game) => game.sport_id))];
  const [
    { data: positions, error: positionError },
    { data: existing, error: assignmentError },
  ] = await Promise.all([
    service
      .from("sport_positions")
      .select("id,sport_id,sort_order")
      .in("sport_id", sportIds)
      .order("sort_order"),
    service
      .from("assignments")
      .select("game_id,position_id,status")
      .in("game_id", gameIds),
  ]);
  if (positionError || assignmentError)
    return NextResponse.json(
      { error: positionError?.message || assignmentError?.message },
      { status: 400 },
    );
  const slots = (games || []).flatMap((game) =>
    (positions || [])
      .filter((position) => position.sport_id === game.sport_id)
      .slice(0, Math.max(0, game.officials_needed || 0))
      .filter(
        (position) =>
          !(existing || []).some(
            (assignment) =>
              assignment.game_id === game.id &&
              assignment.position_id === position.id &&
              !["declined", "cancelled", "canceled"].includes(
                assignment.status,
              ),
          ),
      )
      .map((position) => ({ game_id: game.id, position_id: position.id })),
  );
  if (!slots.length)
    return NextResponse.json(
      { error: "The selected games have no open positions to broadcast." },
      { status: 400 },
    );
  const { error: openError } = await session.rpc("set_self_assign_positions", {
    p_slots: slots,
  });
  if (openError)
    return NextResponse.json({ error: openError.message }, { status: 400 });

  const { data: recipients, error: recipientError } =
    await readAllPages<RecipientRow>(
      (from, to) =>
        service
          .from("organization_officials")
          .select("official_id,officials(first_name,last_name,email,active)")
          .eq("organization_id", organizationId)
          .eq("active", true)
          .order("official_id")
          .range(from, to) as unknown as PromiseLike<{
          data: RecipientRow[] | null;
          error: { message: string } | null;
        }>,
    );
  if (recipientError)
    return NextResponse.json(
      { error: recipientError.message },
      { status: 400 },
    );
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "RESEND_API_KEY is not configured." },
      { status: 500 },
    );
  const query = new URLSearchParams({
    organization: organizationId,
    section: "Self Assign",
    games: gameIds.join(","),
  });
  const reviewUrl = `${request.nextUrl.origin}/workspace?${query.toString()}`;
  const gameList = (games || [])
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
    .map(
      (game: any) =>
        `<li style="margin:8px 0"><b>Game #${esc(game.game_number)}</b> — ${esc(game.home?.name || "TBD")} vs ${esc(game.away?.name || "TBD")}<br><span style="color:#64748b">${esc(new Date(game.starts_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }))}</span></li>`,
    )
    .join("");
  const broadcastKey = body.requestId?.trim() || randomUUID();
  let sent = 0;
  const failures: string[] = [];
  for (const row of recipients || []) {
    const official: any = Array.isArray((row as any).officials)
      ? (row as any).officials[0]
      : (row as any).officials;
    if (!official?.active || !official?.email) {
      failures.push(`${official?.first_name || "Official"}: missing email`);
      continue;
    }
    const html = `<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:660px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#14233b;color:white;padding:24px 28px"><div style="font-size:22px;font-weight:800">REF PRO <span style="color:#60a5fa">GROUP</span></div><div style="font-size:12px;color:#cbd5e1;margin-top:4px">Open Game Broadcast</div></div><div style="padding:28px"><p style="font-size:16px;color:#172033">Hi ${esc(official.first_name)},</p><p style="color:#475569">Open assignments are available for the following games:</p><ul style="padding-left:20px;color:#172033">${gameList}</ul><div style="text-align:center;margin:26px 0"><a href="${reviewUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:9px">Review Open Assignments</a></div><p style="font-size:12px;color:#64748b">If you meet the eligibility requirements, you can self-assign and confirm immediately. If you do not meet league or level eligibility, you can request an assignor override. Schedule conflicts cannot be overridden.</p></div></div></div>`;
    const response = await sendOfficialNotification(
      service,
      (row as any).official_id,
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `open-games-${createHash("sha256")
            .update(`${broadcastKey}:${(row as any).official_id}`)
            .digest("hex")}`,
        },
        body: JSON.stringify({
          from: "Ref Pro Group <notifications@assignments.ref-assign.com>",
          to: [official.email],
          reply_to: "assignments@ref-assign.com",
          subject: `${gameIds.length} game${gameIds.length === 1 ? "" : "s"} open for self assignment`,
          html,
        }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (response.ok) sent++;
    else
      failures.push(
        `${official.first_name} ${official.last_name}: ${result.message || `Email provider returned ${response.status}`}`,
      );
  }
  return NextResponse.json({
    sent,
    positions: slots.length,
    failed: failures.length,
    failures,
  });
}
