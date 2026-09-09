import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";

const reportKeys = new Set(["operations", "coverage", "audit", "payroll"]);
const selectFields = "id,report_key,name,filters,is_favorite,recipient_email,frequency,send_day,schedule_enabled,last_sent_at,next_send_at,updated_at";
const nextSend = (frequency: "weekly" | "monthly", day: number) => {
  const now = new Date(), next = new Date(); next.setUTCHours(13, 0, 0, 0);
  if (frequency === "monthly") { next.setUTCDate(Math.min(28, day)); if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1); }
  else { const distance = (day - next.getUTCDay() + 7) % 7 || 7; next.setUTCDate(next.getUTCDate() + distance); }
  return next.toISOString();
};
async function getContext(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return { error: scope.error };
  const { data: subscription } = await scope.service.from("refassign_subscriptions").select("reporting_access").eq("organization_id", scope.organizationId).in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { ...scope, premium: subscription?.reporting_access !== "standard" };
}
export async function GET(request: NextRequest) {
  const context = await getContext(request); if (!("service" in context) || !context.service || !context.user || !context.organizationId) return context.error;
  const reportKey = request.nextUrl.searchParams.get("reportKey") || "";
  if (!reportKeys.has(reportKey)) return NextResponse.json({ error: "Unsupported report." }, { status: 400 });
  const { data, error } = await context.service.from("report_saved_views").select(selectFields).eq("organization_id", context.organizationId).eq("user_id", context.user.id).eq("report_key", reportKey).order("is_favorite", { ascending: false }).order("updated_at", { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ reportingAccess: context.premium ? "premium" : "standard", defaultEmail: context.user.email || "", views: data || [] });
}
export async function POST(request: NextRequest) {
  const context = await getContext(request); if (!("service" in context) || !context.service || !context.user || !context.organizationId) return context.error;
  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const reportKey = String(body.reportKey || "");
  if (!reportKeys.has(reportKey)) return NextResponse.json({ error: "Unsupported report." }, { status: 400 });
  if (body.action === "delete") {
    const { error } = await context.service.from("report_saved_views").delete().eq("id", String(body.id || "")).eq("organization_id", context.organizationId).eq("user_id", context.user.id);
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ deleted: true });
  }
  const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters : {};
  if (JSON.stringify(filters).length > 10000) return NextResponse.json({ error: "The saved filters are too large." }, { status: 400 });
  const frequency = body.frequency === "monthly" ? "monthly" : "weekly";
  const sendDay = Math.min(frequency === "weekly" ? 6 : 28, Math.max(frequency === "weekly" ? 0 : 1, Math.round(Number(body.sendDay ?? 1))));
  const scheduleEnabled = context.premium && Boolean(body.scheduleEnabled);
  const recipientEmail = String(body.recipientEmail || context.user.email || "").trim().slice(0, 320);
  if (scheduleEnabled && !/^\S+@\S+\.\S+$/.test(recipientEmail)) return NextResponse.json({ error: "Enter a valid delivery email." }, { status: 400 });
  const name = String(body.name || "My saved view").trim().slice(0, 100);
  if (!name) return NextResponse.json({ error: "Enter a view name." }, { status: 400 });
  let id = String(body.id || "");
  if (!context.premium && !id) {
    const { data: existing } = await context.service.from("report_saved_views").select("id").eq("organization_id", context.organizationId).eq("user_id", context.user.id).eq("report_key", reportKey).limit(1).maybeSingle();
    id = existing?.id || "";
  }
  const payload = { organization_id: context.organizationId, user_id: context.user.id, report_key: reportKey, name: context.premium ? name : "My saved view", filters, is_favorite: context.premium && Boolean(body.isFavorite), recipient_email: context.premium ? recipientEmail || null : null, frequency, send_day: sendDay, schedule_enabled: scheduleEnabled, next_send_at: scheduleEnabled ? nextSend(frequency, sendDay) : null, updated_at: new Date().toISOString() };
  let query = id ? context.service.from("report_saved_views").update(payload).eq("id", id).eq("organization_id", context.organizationId).eq("user_id", context.user.id) : context.service.from("report_saved_views").insert(payload);
  const { data, error } = await query.select(selectFields).single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ view: data, reportingAccess: context.premium ? "premium" : "standard" });
}
