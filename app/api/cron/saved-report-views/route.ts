import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";

export const maxDuration = 60;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const labels: Record<string, string> = { operations: "Organization Operations", coverage: "Assignment Coverage", audit: "Change & Audit", payroll: "Payroll & Payments" };
const advance = (frequency: string, day: number) => { const next = new Date(); next.setUTCHours(13, 0, 0, 0); if (frequency === "monthly") { next.setUTCDate(Math.min(28, day)); if (next <= new Date()) next.setUTCMonth(next.getUTCMonth() + 1); } else { const distance = (day - next.getUTCDay() + 7) % 7 || 7; next.setUTCDate(next.getUTCDate() + distance); } return next.toISOString(); };

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "RESEND_API_KEY is not configured." }, { status: 500 });
  const service = createServiceClient(), now = new Date().toISOString();
  const { data: views, error } = await service.from("report_saved_views").select("id,organization_id,user_id,report_key,name,filters,recipient_email,frequency,send_day").eq("schedule_enabled", true).lte("next_send_at", now).limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let sent = 0; const failures: string[] = [];
  for (const view of views || []) {
    try {
      const [{ data: membership }, { data: subscription }, { data: organization }] = await Promise.all([
        service.from("organization_memberships").select("role").eq("organization_id", view.organization_id).eq("user_id", view.user_id).in("role", ["owner", "admin", "assignor"]).limit(1).maybeSingle(),
        service.from("refassign_subscriptions").select("reporting_access").eq("organization_id", view.organization_id).in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        service.from("organizations").select("name").eq("id", view.organization_id).single(),
      ]);
      if (!membership || subscription?.reporting_access === "standard") { await service.from("report_saved_views").update({ schedule_enabled: false, next_send_at: null, updated_at: now }).eq("id", view.id); throw new Error(`${view.name}: delivery disabled because Premium manager access ended`); }
      const filterRows = Object.entries((view.filters || {}) as Record<string, unknown>).map(([key, value]) => `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0">${esc(key.replaceAll("_", " "))}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>${esc(value || "All")}</b></td></tr>`).join("");
      const url = `${request.nextUrl.origin}/workspace?section=reports&report=${encodeURIComponent(view.report_key)}&savedView=${encodeURIComponent(view.id)}`;
      const html = `<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#14233b;color:#fff;padding:24px 28px"><h2 style="margin:0">${esc(view.name)}</h2><p>${esc(organization?.name || "RefAssign")} • ${esc(labels[view.report_key] || view.report_key)}</p></div><div style="padding:28px"><p>Your scheduled saved report view is ready.</p><table style="width:100%;border-collapse:collapse">${filterRows}</table><p style="margin-top:24px"><a href="${esc(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 17px;border-radius:8px;font-weight:700">Open saved report</a></p><p style="margin-top:28px;color:#64748b;font-size:12px">© 2026 Ref Pro Group LLC</p></div></div></div>`;
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `saved-view-${view.id}-${now.slice(0, 10)}` }, body: JSON.stringify({ from: "RefAssign <notifications@assignments.ref-assign.com>", to: [view.recipient_email], reply_to: "assignments@ref-assign.com", subject: `${view.name} — RefAssign`, html }) });
      if (!response.ok) throw new Error(`${view.name}: email delivery failed`);
      await service.from("report_saved_views").update({ last_sent_at: now, next_send_at: advance(view.frequency, view.send_day), updated_at: now }).eq("id", view.id); sent += 1;
    } catch (reason) { failures.push(reason instanceof Error ? reason.message : "Saved report delivery failed"); }
  }
  return NextResponse.json({ checked: (views || []).length, sent, failed: failures.length, failures });
}
