import { NextRequest, NextResponse } from "next/server";
import { addReportCopyright } from "../../../../lib/pdfCopyright";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { getExecutiveSummary } from "../../../../lib/server/executiveSummary";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const maxDuration = 60;
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const esc = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const advance = (frequency: string, day: number) => { const next = new Date(); next.setUTCHours(13, 0, 0, 0); if (frequency === "monthly") { next.setUTCDate(Math.min(28, day)); if (next <= new Date()) next.setUTCMonth(next.getUTCMonth() + 1); } else { const distance = (day - next.getUTCDay() + 7) % 7 || 7; next.setUTCDate(next.getUTCDate() + distance); } return next.toISOString(); };

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const service = createServiceClient(), now = new Date().toISOString();
  const { data: schedules, error } = await service.from("executive_report_schedules").select("id,organization_id,user_id,recipient_email,frequency,send_day,kpi_targets").eq("enabled", true).lte("next_send_at", now).limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "RESEND_API_KEY is not configured." }, { status: 500 });
  let sent = 0; const failures: string[] = [];
  for (const schedule of schedules || []) {
    try {
      const { data: membership } = await service.from("organization_memberships").select("role").eq("organization_id", schedule.organization_id).eq("user_id", schedule.user_id).maybeSingle();
      if (!membership || !["owner", "admin", "assignor"].includes(membership.role)) { await service.from("executive_report_schedules").update({ enabled: false, next_send_at: null, updated_at: now }).eq("id", schedule.id); throw new Error("Schedule disabled because manager access ended"); }
      const { data: subscription } = await service.from("refassign_subscriptions").select("reporting_access").eq("organization_id", schedule.organization_id).in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (subscription?.reporting_access === "standard") throw new Error("Premium reporting is not active");
      const summary = await getExecutiveSummary(service, schedule.organization_id), targets = schedule.kpi_targets as Record<string, number>;
      const attention = [summary.coverageRate < (targets.coverage || 95) ? `${summary.openPositions} open positions` : "", summary.complianceIssues ? `${summary.complianceIssues} compliance issues` : "", summary.communicationFailures30 ? `${summary.communicationFailures30} failed communications` : ""].filter(Boolean).join(" • ") || "All monitored KPIs are on track";
      const pdf = new jsPDF({ orientation: "landscape" }); pdf.setTextColor(12, 30, 55); pdf.setFontSize(18); pdf.text(`${summary.organization} Executive Summary`, 14, 17); pdf.setFontSize(9); pdf.text(`Generated ${new Date(summary.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} • ${attention}`, 14, 25); autoTable(pdf, { startY: 32, head: [["Upcoming games", "Coverage", "Open positions", "Staffing risks", "Outstanding payroll", "30-day cost forecast", "Compliance issues", "Training", "Declines", "Delivery failures"]], body: [[summary.upcomingGames, `${summary.coverageRate}%`, summary.openPositions, summary.staffingRisks, money(summary.outstandingPayroll), money(summary.projected30DayCost), summary.complianceIssues, `${summary.trainingRate}%`, summary.declines30, summary.communicationFailures30]], headStyles: { fillColor: [37, 99, 235] } }); addReportCopyright(pdf); const attachment = Buffer.from(pdf.output("arraybuffer")).toString("base64");
      const html = `<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:28px"><div style="max-width:680px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#14233b;color:white;padding:24px 28px"><h2 style="margin:0">${esc(summary.organization)} Executive Summary</h2><p style="margin:8px 0 0;color:#cbd5e1">${esc(schedule.frequency === "monthly" ? "Monthly" : "Weekly")} RefAssign report</p></div><div style="padding:28px"><h3>Needs attention</h3><p>${esc(attention)}</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Upcoming games</td><td><b>${summary.upcomingGames}</b></td><td>Coverage</td><td><b>${summary.coverageRate}%</b></td></tr><tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Staffing risks</td><td><b>${summary.staffingRisks}</b></td><td>Outstanding payroll</td><td><b>${money(summary.outstandingPayroll)}</b></td></tr><tr><td style="padding:10px">Compliance issues</td><td><b>${summary.complianceIssues}</b></td><td>Training participation</td><td><b>${summary.trainingRate}%</b></td></tr></table><p style="margin-top:24px"><a href="${request.nextUrl.origin}/workspace?section=reports" style="background:#2563eb;color:white;text-decoration:none;padding:11px 17px;border-radius:8px;font-weight:700">Open Executive Dashboard</a></p></div></div></div>`;
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `executive-${schedule.id}-${now.slice(0, 10)}` }, body: JSON.stringify({ from: "RefAssign <notifications@assignments.ref-assign.com>", to: [schedule.recipient_email], reply_to: "assignments@ref-assign.com", subject: `${summary.organization} — RefAssign Executive Summary`, html, attachments: [{ filename: "refassign-executive-summary.pdf", content: attachment }] }) });
      if (!response.ok) { const detail = await response.json().catch(() => ({})) as { message?: string }; throw new Error(detail.message || `Email failed (${response.status})`); }
      await service.from("executive_report_schedules").update({ last_sent_at: now, next_send_at: advance(schedule.frequency, schedule.send_day), updated_at: now }).eq("id", schedule.id); sent++;
    } catch (reason) { failures.push(reason instanceof Error ? reason.message : "Summary delivery failed"); }
  }
  return NextResponse.json({ checked: (schedules || []).length, sent, failed: failures.length, failures });
}
