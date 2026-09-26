import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { sendOfficialNotification } from "../../../../lib/communications/officialCc";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);

export async function POST(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to review requests." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { requestId?: string; approve?: boolean };
  if (!body.requestId || typeof body.approve !== "boolean") return NextResponse.json({ error: "Request and decision are required." }, { status: 400 });
  // The RPC enforces manager access and changes the request and assignment atomically.
  const { data: assignmentId, error } = await session.rpc("review_self_assign_override", { p_request_id: body.requestId, p_approve: body.approve });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!body.approve) return NextResponse.json({ reviewed: true });

  const service = createServiceClient();
  const { data: assignment, error: detailError } = await service.from("assignments").select(
    "id,official_id,officials(first_name,email),sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name))",
  ).eq("id", assignmentId).single();
  if (detailError || !assignment) return NextResponse.json({ reviewed: true, warning: "Override approved, but the email could not be prepared. Please notify the official directly." });
  const a: any = assignment;
  const official = Array.isArray(a.officials) ? a.officials[0] : a.officials;
  const game = Array.isArray(a.games) ? a.games[0] : a.games;
  const position = Array.isArray(a.sport_positions) ? a.sport_positions[0] : a.sport_positions;
  const home = Array.isArray(game?.home) ? game.home[0] : game?.home;
  const away = Array.isArray(game?.away) ? game.away[0] : game?.away;
  const location = Array.isArray(game?.location) ? game.location[0] : game?.location;
  const apiKey = process.env.RESEND_API_KEY;
  if (!official?.email || !apiKey) return NextResponse.json({ reviewed: true, warning: "Override approved, but the confirmation email could not be sent. Please notify the official directly." });
  const when = game?.starts_at ? new Date(game.starts_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "full", timeStyle: "short" }) : "Time TBD";
  const scheduleUrl = `${request.nextUrl.origin}/workspace?${new URLSearchParams({ section: "My Schedule" })}`;
  try {
    const response = await sendOfficialNotification(service, a.official_id, "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `override-approved-${body.requestId}-${a.id}` },
      body: JSON.stringify({
        from: "Ref Pro Group <notifications@assignments.ref-assign.com>",
        to: [official.email], reply_to: "assignments@ref-assign.com",
        subject: `Override approved: Game #${game?.game_number || "—"}`,
        html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>Your override was approved</h2><p>Hi ${esc(official.first_name)}, your request was approved and you are assigned to Game #${esc(game?.game_number || "—")} as ${esc(position?.name || "an official")}.</p><p>${esc(home?.name || "TBD")} vs ${esc(away?.name || "TBD")}<br>${esc(when)}<br>${esc(location?.name || "Location TBD")}</p><p>This assignment is accepted. No further action is needed.</p><p><a href="${esc(scheduleUrl)}">View your schedule</a></p></div>`,
      }),
    });
    if (!response.ok) return NextResponse.json({ reviewed: true, warning: "Override approved, but the confirmation email failed. Please notify the official directly." });
  } catch {
    return NextResponse.json({ reviewed: true, warning: "Override approved, but the confirmation email failed. Please notify the official directly." });
  }
  return NextResponse.json({ reviewed: true, notified: true });
}
