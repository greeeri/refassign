import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!,
  );
}

export async function POST(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to request this assignment." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { slotId?: string; organizationId?: string };
  if (!body.slotId || !body.organizationId)
    return NextResponse.json({ error: "The assignment position and organization are required." }, { status: 400 });
  const { data: requestId, error: requestError } = await session.rpc("request_self_assign_override", {
    p_slot_id: body.slotId,
    p_organization_id: body.organizationId,
  });
  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 400 });

  const service = createServiceClient();
  const [{ data: detail }, { data: memberships }] = await Promise.all([
    service.from("self_assign_override_requests").select(
      "eligibility_reason,officials(first_name,last_name),assignment_self_assign_slots(sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)))",
    ).eq("id", requestId).single(),
    service.from("organization_memberships").select("user_id,role").eq("organization_id", body.organizationId).in("role", ["owner", "admin", "assignor"]),
  ]);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ requestId, notified: 0 });
  const recipients: string[] = [];
  for (const membership of memberships || []) {
    const { data } = await service.auth.admin.getUserById(membership.user_id);
    if (data.user?.email && !recipients.includes(data.user.email)) recipients.push(data.user.email);
  }
  if (!recipients.length) return NextResponse.json({ requestId, notified: 0 });
  const official: any = Array.isArray((detail as any)?.officials) ? (detail as any).officials[0] : (detail as any)?.officials;
  const slot: any = Array.isArray((detail as any)?.assignment_self_assign_slots) ? (detail as any).assignment_self_assign_slots[0] : (detail as any)?.assignment_self_assign_slots;
  const game: any = Array.isArray(slot?.games) ? slot.games[0] : slot?.games;
  const position: any = Array.isArray(slot?.sport_positions) ? slot.sport_positions[0] : slot?.sport_positions;
  const home: any = Array.isArray(game?.home) ? game.home[0] : game?.home;
  const away: any = Array.isArray(game?.away) ? game.away[0] : game?.away;
  const manageUrl = `${request.nextUrl.origin}/workspace?${new URLSearchParams({ organization: body.organizationId, section: "Assignments", override: String(requestId) })}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `self-assign-request-${requestId}` },
    body: JSON.stringify({
      from: "Ref Pro Group <notifications@assignments.ref-assign.com>",
      to: recipients,
      reply_to: "assignments@ref-assign.com",
      subject: `Assignment override requested for Game #${game?.game_number || "—"}`,
      html: `<div style="font-family:Arial,sans-serif;padding:24px"><h2>Eligibility Override Requested</h2><p><b>${esc(official?.first_name)} ${esc(official?.last_name)}</b> requested ${esc(position?.name || "an open position")} for Game #${esc(game?.game_number || "—")} — ${esc(home?.name || "TBD")} vs ${esc(away?.name || "TBD")}.</p><p><b>Eligibility issue:</b> ${esc((detail as any)?.eligibility_reason)}</p><p><a href="${esc(manageUrl)}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Approve Override</a></p><p style="color:#475569;font-size:13px">Sign in and confirm the approval on the request page.</p></div>`,
    }),
  });
  return NextResponse.json({ requestId, notified: recipients.length });
}
