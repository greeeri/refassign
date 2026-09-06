import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const testUrl = "https://slenztuopbfxqzjyrtzp.supabase.co";
const testPublishableKey = "sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return NextResponse.json({ error: "Sign in before inviting a teammate." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { organizationId?: string; organization?: string; email?: string; roleLabel?: string; actionLink?: string; invitationId?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const actionLink = String(body.actionLink ?? "");
  if (!body.organizationId || !email.includes("@") || !actionLink) return NextResponse.json({ error: "The invitation information is incomplete." }, { status: 400 });

  const link = new URL(actionLink);
  if (link.origin !== testUrl || !link.pathname.startsWith("/auth/v1/verify")) return NextResponse.json({ error: "The invitation link is invalid." }, { status: 400 });

  const supabase = createClient(testUrl, testPublishableKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.replace("Bearer ", "");
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  const { error: accessError } = await supabase.rpc("get_organization_team", { p_organization_id: body.organizationId });
  if (accessError) return NextResponse.json({ error: "Only organization owners and administrators can send invitations." }, { status: 403 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Invitation email is not configured." }, { status: 503 });
  const organization = String(body.organization ?? "your RefAssign organization");
  const roleLabel = String(body.roleLabel ?? "team member");
  const html = `<div style="font-family:Arial,sans-serif;background:#eef4f9;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dbe5ed;border-radius:16px;overflow:hidden"><div style="background:#0b2748;color:#fff;padding:24px 28px"><div style="font-size:24px;font-weight:800">REF<span style="color:#4ba3e3">ASSIGN</span></div><div style="font-size:12px;color:#b9cbe0;margin-top:4px">Assign · Develop · Manage</div></div><div style="padding:30px"><h2 style="color:#102f57;margin-top:0">You’re invited to ${esc(organization)}</h2><p style="color:#52677d;line-height:1.6">You have been invited to join as <b>${esc(roleLabel)}</b>. Use the secure button below to sign in and activate your workspace access.</p><p style="margin:26px 0"><a href="${esc(actionLink)}" style="display:inline-block;background:#75dc43;color:#0b2748;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:9px">Accept invitation</a></p><p style="color:#7a8a9b;font-size:13px">This invitation was sent by an authorized organization administrator.</p></div></div></div>`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `organization-invitation-${body.invitationId ?? email}` }, body: JSON.stringify({ from: "RefAssign <notifications@assignments.ref-assign.com>", to: [email], reply_to: "assignments@ref-assign.com", subject: `Invitation to join ${organization} in RefAssign`, html }) });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok) {
    if (body.invitationId) await supabase.rpc("revoke_organization_invitation", { p_invitation_id: body.invitationId });
    return NextResponse.json({ error: result.message || "The invitation email could not be sent." }, { status: 502 });
  }
  return NextResponse.json({ sent: true, emailId: result.id ?? null });
}
