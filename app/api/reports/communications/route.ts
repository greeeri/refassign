import { NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: canManage, error: accessError } = await supabase.rpc("can_manage_game_setup");
  if (accessError || !canManage) return NextResponse.json({ error: "Administrator or Assignor access is required." }, { status: 403 });

  const service = createServiceClient();
  const { data: memberships } = await service.from("organization_memberships").select("organization_id").eq("user_id", user.id);
  const organizationIds = (memberships || []).map((row) => row.organization_id);
  let subscriptionQuery = service.from("refassign_subscriptions").select("reporting_access").in("status", ["active", "trialing", "pending"]).order("created_at", { ascending: false }).limit(1);
  subscriptionQuery = organizationIds.length ? subscriptionQuery.in("organization_id", organizationIds) : subscriptionQuery.eq("user_id", user.id);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess = subscription?.reporting_access === "standard" ? "standard" : "premium";

  let organizationOfficials: Array<{ organization_id: string; official_id: string }> = [];
  let organizations: Array<{ id: string; name: string }> = [];
  if (organizationIds.length) {
    const [links, organizationRows] = await Promise.all([
      service.from("organization_officials").select("organization_id,official_id").in("organization_id", organizationIds).eq("active", true),
      service.from("organizations").select("id,name").in("id", organizationIds).order("name"),
    ]);
    if (links.error || organizationRows.error) return NextResponse.json({ error: links.error?.message || organizationRows.error?.message }, { status: 400 });
    organizationOfficials = links.data || [];
    organizations = organizationRows.data || [];
  }

  let officialIds = [...new Set(organizationOfficials.map((row) => row.official_id))];
  let officials: Array<Record<string, unknown>> = [];
  if (officialIds.length) {
    const result = await service.from("officials").select("id,first_name,last_name,email,phone,active").in("id", officialIds).order("last_name").order("first_name");
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    officials = result.data || [];
  } else if (!organizationIds.length) {
    const result = await supabase.from("officials").select("id,first_name,last_name,email,phone,active").order("last_name").order("first_name");
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    officials = result.data || [];
    officialIds = officials.map((row) => String(row.id));
  }

  const empty = { reportingAccess, organizations, organizationOfficials, officials, communications: [], assignments: [], developmentCommunications: [] };
  if (!officialIds.length) return NextResponse.json(empty);

  // The signed-in client keeps game access inside the current manager's RLS scope.
  const gamesResult = await supabase.from("games").select("id");
  if (gamesResult.error) return NextResponse.json({ error: gamesResult.error.message }, { status: 400 });
  const gameIds = (gamesResult.data || []).map((row) => row.id);

  const [communications, assignments, developmentCommunications] = await Promise.all([
    gameIds.length
      ? service.from("official_communications").select("id,assignment_id,game_id,official_id,channel,message_type,delivery_status,error_message,sent_at,delivered_at,opened_at,created_at,assignments(status,responded_at),games(organization_id,leagues(name),levels(name))").in("official_id", officialIds).in("game_id", gameIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("assignments").select("id,game_id,official_id,status,published_at,email_sent_at,email_error,reminder_sent_at,responded_at,games!inner(organization_id,leagues(name),levels(name))").in("official_id", officialIds).or("email_sent_at.not.is.null,reminder_sent_at.not.is.null,email_error.not.is.null").order("published_at", { ascending: false }),
    supabase.from("development_communications").select("id,program_id,official_id,channel,delivery_status,error_message,sent_at,created_at,registration_programs(name)").in("official_id", officialIds).order("created_at", { ascending: false }),
  ]);
  const error = communications.error || assignments.error || developmentCommunications.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    organizations,
    organizationOfficials,
    officials,
    communications: communications.data || [],
    assignments: assignments.data || [],
    developmentCommunications: developmentCommunications.data || [],
  });
}
