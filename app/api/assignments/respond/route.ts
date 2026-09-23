import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";

const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ]!,
  );
const one = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? value[0] || null : value || null;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    response?: "accepted" | "declined";
    declineReason?: string | null;
  };
  if (!body.token || !["accepted", "declined"].includes(body.response || ""))
    return NextResponse.json(
      { error: "A valid assignment response is required." },
      { status: 400 },
    );
  const reason =
    body.response === "declined" ? body.declineReason?.trim() : null;
  if (body.response === "declined" && !reason)
    return NextResponse.json(
      { error: "A decline reason is required." },
      { status: 400 },
    );
  const service = createServiceClient(),
    { data: savedResponse, error: responseError } = await service.rpc(
      "respond_to_assignment",
      {
        p_token: body.token,
        p_response: body.response,
        p_decline_reason: reason,
      },
    );
  if (responseError)
    return NextResponse.json({ error: responseError.message }, { status: 400 });
  if (savedResponse !== body.response)
    return NextResponse.json(
      {
        error:
          "This assignment was already recorded with a different response. Reload the assignment before trying again.",
      },
      { status: 409 },
    );
  if (body.response !== "declined") return NextResponse.json({ ok: true });
  const { data: raw, error: loadError } = await service
    .from("assignments")
    .select(
      "id,published_by,responded_at,decline_reason,officials(first_name,last_name),sport_positions(name),games!inner(game_number,starts_at,organization_id,league_id,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name),levels(name))",
    )
    .eq("response_token", body.token)
    .single();
  if (loadError || !raw)
    return NextResponse.json({
      ok: true,
      notificationWarning:
        "The decline was saved, but the email copy could not be prepared.",
    });
  const assignment = raw as any,
    game = one<any>(assignment.games),
    official = one<any>(assignment.officials),
    position = one<any>(assignment.sport_positions);
  if (!game?.organization_id || !game?.league_id)
    return NextResponse.json({ ok: true });
  const { data: coverage } = await service
    .from("organization_league_coverage")
    .select("email_assignor_on_decline")
    .eq("organization_id", game.organization_id)
    .eq("league_id", game.league_id)
    .eq("active", true)
    .eq("email_assignor_on_decline", true)
    .limit(1)
    .maybeSingle();
  if (!coverage) return NextResponse.json({ ok: true, notified: 0 });
  const recipientIds = new Set<string>();
  if (assignment.published_by) recipientIds.add(assignment.published_by);
  if (!recipientIds.size) {
    const [{ data: memberships }, { data: profiles }] = await Promise.all([
      service
        .from("organization_memberships")
        .select("user_id,role")
        .eq("organization_id", game.organization_id)
        .eq("role", "assignor"),
      service
        .from("organization_user_access_profiles")
        .select("user_id,roles,league_ids")
        .eq("organization_id", game.organization_id),
    ]);
    for (const membership of memberships || [])
      recipientIds.add(membership.user_id);
    for (const profile of profiles || []) {
      const roles = (profile.roles || []) as string[],
        leagues = (profile.league_ids || []) as string[];
      if (
        roles.includes("assignor") &&
        (!leagues.length || leagues.includes(game.league_id))
      )
        recipientIds.add(profile.user_id);
    }
  }
  const recipients: string[] = [];
  for (const userId of recipientIds) {
    const { data } = await service.auth.admin.getUserById(userId);
    if (data.user?.email && !recipients.includes(data.user.email))
      recipients.push(data.user.email);
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !recipients.length) {
    const message = !apiKey
      ? "Email is not configured."
      : "No assignor email address was found.";
    await service
      .from("assignments")
      .update({ decline_copy_email_error: message })
      .eq("id", assignment.id);
    return NextResponse.json({
      ok: true,
      notificationWarning: `The decline was saved. ${message}`,
    });
  }
  const home = one<any>(game.home)?.name || "TBD",
    away = one<any>(game.away)?.name || "TBD",
    league = one<any>(game.leagues)?.name || "League",
    level = one<any>(game.levels)?.name,
    location = one<any>(game.location)?.name || "TBD";
  const when = new Date(game.starts_at).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const manageUrl = `${request.nextUrl.origin}/workspace?organization=${encodeURIComponent(game.organization_id)}&section=Assignments`;
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `assignment-decline-copy-${assignment.id}-${assignment.responded_at}`,
    },
    body: JSON.stringify({
      from: "Ref Pro Group <notifications@assignments.ref-assign.com>",
      to: recipients,
      reply_to: "assignments@ref-assign.com",
      subject: `Assignment Declined: ${home} vs ${away}`,
      html: `<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px"><h2 style="color:#991b1b">Assignment Declined</h2><p><b>${esc(official?.first_name)} ${esc(official?.last_name)}</b> declined the ${esc(position?.name || "Official")} assignment.</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Game</td><td><b>${esc(home)} vs ${esc(away)}</b>${game.game_number ? ` (#${esc(game.game_number)})` : ""}</td></tr><tr><td style="padding:8px 0;color:#64748b">Date &amp; Time</td><td>${esc(when)}</td></tr><tr><td style="padding:8px 0;color:#64748b">League / Level</td><td>${esc(league)}${level ? ` • ${esc(level)}` : ""}</td></tr><tr><td style="padding:8px 0;color:#64748b">Location</td><td>${esc(location)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Reason</td><td><b>${esc(assignment.decline_reason)}</b></td></tr></table><p style="margin-top:24px"><a href="${manageUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Open Assignment Center</a></p></div></div>`,
    }),
  });
  const result = (await emailResponse.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!emailResponse.ok) {
    const message =
      result.message || `Email provider returned ${emailResponse.status}.`;
    await service
      .from("assignments")
      .update({ decline_copy_email_error: message })
      .eq("id", assignment.id);
    return NextResponse.json({
      ok: true,
      notificationWarning: `The decline was saved, but the email copy failed: ${message}`,
    });
  }
  await service
    .from("assignments")
    .update({
      decline_copy_sent_at: new Date().toISOString(),
      decline_copy_email_error: null,
    })
    .eq("id", assignment.id);
  return NextResponse.json({ ok: true, notified: recipients.length });
}
