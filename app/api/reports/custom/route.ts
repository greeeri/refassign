import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

const nextSend = (frequency: "weekly" | "monthly", day: number) => { const now = new Date(), next = new Date(); next.setUTCHours(13, 0, 0, 0); if (frequency === "monthly") { next.setUTCDate(Math.min(28, day)); if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1); } else { const distance = (day - next.getUTCDay() + 7) % 7 || 7; next.setUTCDate(next.getUTCDate() + distance); } return next.toISOString(); };
async function context() {
  const supabase = await createServerSupabaseClient(), { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: canManage } = await supabase.rpc("can_manage_game_setup");
  if (!canManage) return { error: NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 }) };
  const service = createServiceClient(), { data: memberships } = await service.from("organization_memberships").select("organization_id,role").eq("user_id", user.id);
  const organizationIds = [...new Set((memberships || []).filter((row) => ["owner", "admin", "assignor"].includes(row.role)).map((row) => row.organization_id))];
  const { data: subscriptions } = organizationIds.length ? await service.from("refassign_subscriptions").select("organization_id,reporting_access,created_at").in("organization_id", organizationIds).in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }) : { data: [] };
  const latest = new Map<string, string>(); (subscriptions || []).forEach((row) => { if (row.organization_id && !latest.has(row.organization_id)) latest.set(row.organization_id, row.reporting_access); });
  const premiumOrganizationIds = organizationIds.filter((id) => latest.get(id) !== "standard");
  return { supabase, service, user, organizationIds: premiumOrganizationIds, premium: premiumOrganizationIds.length > 0 };
}
export async function GET() {
  const value = await context(); if (value.error) return value.error;
  const { supabase, service, user, organizationIds, premium } = value;
  if (!premium) return NextResponse.json({ reportingAccess: "standard", organizations: [], games: [], assignments: [], templates: [] });
  const [organizationsResult, gamesResult, assignmentsResult, templatesResult] = await Promise.all([
    organizationIds.length ? service.from("organizations").select("id,name").in("id", organizationIds).order("name") : Promise.resolve({ data: [], error: null }),
    supabase.from("games").select("id,organization_id,game_number,status,starts_at,officials_needed,leagues(id,name),levels(id,name),location:locations(id,name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name)").in("organization_id", organizationIds).order("starts_at", { ascending: false }),
    supabase.from("assignments").select("id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,officials(id,first_name,last_name),sport_positions(id,name),games!inner(organization_id)").in("games.organization_id", organizationIds).order("assigned_at", { ascending: false }),
    organizationIds.length ? service.from("custom_report_templates").select("id,organization_id,name,definition,recipient_email,frequency,send_day,schedule_enabled,last_sent_at,next_send_at,updated_at").eq("user_id", user.id).in("organization_id", organizationIds).order("updated_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  const error = organizationsResult.error || gamesResult.error || assignmentsResult.error || templatesResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ reportingAccess: "premium", defaultEmail: user.email || "", organizations: organizationsResult.data || [], games: gamesResult.data || [], assignments: assignmentsResult.data || [], templates: templatesResult.data || [] });
}
export async function POST(request: NextRequest) {
  const value = await context(); if (value.error) return value.error;
  const { service, user, organizationIds, premium } = value;
  if (!premium) return NextResponse.json({ error: "Premium Reporting is required for the Custom Report Builder." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as any;
  if (body.action === "delete") { const { error } = await service.from("custom_report_templates").delete().eq("id", body.id || "").eq("user_id", user.id).in("organization_id", organizationIds); return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ deleted: true }); }
  const name = String(body.name || "").trim().slice(0, 100), definition = body.definition;
  if (!name || !definition || JSON.stringify(definition).length > 20000) return NextResponse.json({ error: "Enter a report name and valid report configuration." }, { status: 400 });
  const requested = Array.isArray(definition.organizationIds) ? definition.organizationIds.filter((id: string) => organizationIds.includes(id)) : [], organizationId = requested[0] || organizationIds[0];
  if (!organizationId) return NextResponse.json({ error: "A managed organization is required." }, { status: 403 });
  const frequency = body.frequency === "monthly" ? "monthly" : "weekly", min = frequency === "weekly" ? 0 : 1, max = frequency === "weekly" ? 6 : 28, sendDay = Math.min(max, Math.max(min, Math.round(Number(body.sendDay ?? 1)))), recipient = String(body.recipientEmail || user.email || "").trim().slice(0, 320), enabled = Boolean(body.scheduleEnabled);
  if (enabled && !/^\S+@\S+\.\S+$/.test(recipient)) return NextResponse.json({ error: "Enter a valid delivery email." }, { status: 400 });
  const payload = { organization_id: organizationId, user_id: user.id, name, definition: { ...definition, organizationIds: requested }, recipient_email: recipient || null, frequency, send_day: sendDay, schedule_enabled: enabled, next_send_at: enabled ? nextSend(frequency, sendDay) : null, updated_at: new Date().toISOString() };
  let query = body.id ? service.from("custom_report_templates").update(payload).eq("id", body.id).eq("user_id", user.id).in("organization_id", organizationIds) : service.from("custom_report_templates").insert(payload);
  const { data, error } = await query.select("id,organization_id,name,definition,recipient_email,frequency,send_day,schedule_enabled,last_sent_at,next_send_at,updated_at").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ template: data });
}
