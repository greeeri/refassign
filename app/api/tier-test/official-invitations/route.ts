import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const testUrl = "https://slenztuopbfxqzjyrtzp.supabase.co";
const testKey = "sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ";

function esc(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer "))
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401 },
    );
  const body = (await request.json().catch(() => ({}))) as {
    organizationId?: string;
    emails?: string[];
  };
  const emails = [
    ...new Set(
      (body.emails || [])
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)),
    ),
  ];
  if (!body.organizationId || !emails.length || emails.length > 500)
    return NextResponse.json(
      { error: "Provide between 1 and 500 valid invitation emails." },
      { status: 400 },
    );

  const supabase = createClient(testUrl, testKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData.user)
    return NextResponse.json(
      { error: "Your session expired." },
      { status: 401 },
    );
  const [{ error: accessError }, { data: workspaces }] = await Promise.all([
    supabase.rpc("bulk_search_organization_official_emails", {
      p_organization_id: body.organizationId,
      p_emails: [emails[0]],
    }),
    supabase.rpc("get_my_test_workspaces"),
  ]);
  if (accessError)
    return NextResponse.json(
      { error: "You cannot invite officials to this organization." },
      { status: 403 },
    );
  const workspace = (
    (workspaces || []) as Array<{ organization_id: string; name: string }>
  ).find((item) => item.organization_id === body.organizationId);
  if (!workspace)
    return NextResponse.json(
      { error: "Organization not found." },
      { status: 404 },
    );

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "Invitation email is not configured." },
      { status: 503 },
    );
  const messages = emails.map((email) => ({
    from: "RefAssign <notifications@assignments.ref-assign.com>",
    to: [email],
    reply_to: "assignments@ref-assign.com",
    subject: `Invitation to officiate with ${workspace.name} in RefAssign`,
    html: `<div style="font-family:Arial,sans-serif;background:#eef4f9;padding:28px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dbe5ed;border-radius:16px;overflow:hidden"><div style="background:#0b2748;color:#fff;padding:24px 28px"><div style="font-size:24px;font-weight:800">REF<span style="color:#4ba3e3">ASSIGN</span></div><div style="font-size:12px;color:#b9cbe0;margin-top:4px">Assign · Develop · Manage</div></div><div style="padding:30px"><h2 style="color:#102f57;margin-top:0">You’re invited to officiate with ${esc(workspace.name)}</h2><p style="color:#52677d;line-height:1.6">Your email was added to this organization’s official roster. Sign in or create your free RefAssign official account using this same email address.</p><p style="margin:26px 0"><a href="https://test.ref-assign.com/login#official=${encodeURIComponent(email)}" style="display:inline-block;background:#75dc43;color:#0b2748;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:9px">Create or open official account</a></p></div></div></div>`,
  }));
  let sent = 0;
  for (let index = 0; index < messages.length; index += 100) {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages.slice(index, index + 100)),
    });
    const result = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            result.message ||
            `Invitation delivery stopped after ${sent} emails.`,
          sent,
        },
        { status: 502 },
      );
    sent += Math.min(100, messages.length - index);
  }
  return NextResponse.json({ sent });
}
