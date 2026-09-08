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
    const [linksResult, organizationsResult] = await Promise.all([
      service.from("organization_officials").select("organization_id,official_id").in("organization_id", organizationIds).eq("active", true),
      service.from("organizations").select("id,name").in("id", organizationIds).order("name"),
    ]);
    if (linksResult.error || organizationsResult.error) return NextResponse.json({ error: linksResult.error?.message || organizationsResult.error?.message }, { status: 400 });
    organizationOfficials = linksResult.data || [];
    organizations = organizationsResult.data || [];
  }

  let officialIds = [...new Set(organizationOfficials.map((row) => row.official_id))];
  let officials: Array<Record<string, unknown>> = [];
  if (officialIds.length) {
    const { data, error } = await service.from("officials").select("id,first_name,last_name,email,active,certification_level,college_license_level,high_school_license_level,us_soccer_license_level").in("id", officialIds).order("last_name").order("first_name");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    officials = data || [];
  } else if (!organizationIds.length) {
    // Legacy fallback remains RLS-scoped for accounts not yet attached to an organization.
    const { data, error } = await supabase.from("officials").select("id,first_name,last_name,email,active,certification_level,college_license_level,high_school_license_level,us_soccer_license_level").order("last_name").order("first_name");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    officials = data || [];
    officialIds = officials.map((row) => String(row.id));
  }

  if (!officialIds.length) return NextResponse.json({ reportingAccess, organizations, organizationOfficials, officials: [], registrations: [], programMemberships: [], programs: [], modules: [], progress: [], quizAttempts: [], leagueEligibility: [], levelEligibility: [], assignments: [] });

  const [registrationsResult, programMembershipsResult, leagueEligibilityResult, levelEligibilityResult] = await Promise.all([
    service.from("official_registrations").select("id,official_id,registration_year,status,payment_status,paid_at,reviewed_at,registration_program_id,registration_programs(id,name)").in("official_id", officialIds),
    service.from("registration_program_officials").select("program_id,official_id").in("official_id", officialIds),
    service.from("official_league_eligibility").select("official_id,league_id,leagues(id,name)").in("official_id", officialIds),
    service.from("official_level_eligibility").select("official_id,level_id,levels(id,name)").in("official_id", officialIds),
  ]);
  const firstError = registrationsResult.error || programMembershipsResult.error || leagueEligibilityResult.error || levelEligibilityResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const programIds = [...new Set((programMembershipsResult.data || []).map((row) => row.program_id))];
  const [programsResult, modulesResult, progressResult, quizResult, assignmentsResult] = await Promise.all([
    programIds.length ? service.from("registration_programs").select("id,name,slug,active").in("id", programIds) : Promise.resolve({ data: [], error: null }),
    programIds.length ? service.from("development_modules").select("id,program_id,title,required,active,content_type,course_end_at").in("program_id", programIds).eq("required", true).eq("active", true) : Promise.resolve({ data: [], error: null }),
    service.from("official_development_progress").select("module_id,official_id,status,completed_at").in("official_id", officialIds),
    service.from("development_quiz_attempts").select("module_id,official_id,score_percent,passed,completed_at").in("official_id", officialIds).eq("passed", true),
    reportingAccess === "premium" ? supabase.from("assignments").select("id,official_id,status,games!inner(id,game_number,starts_at,status,league_id,level_id,organization_id,leagues(name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)),sport_positions(name)").in("official_id", officialIds).gte("games.starts_at", new Date().toISOString()).not("status", "in", '(declined,cancelled)') : Promise.resolve({ data: [], error: null }),
  ]);
  const secondError = programsResult.error || modulesResult.error || progressResult.error || quizResult.error || assignmentsResult.error;
  if (secondError) return NextResponse.json({ error: secondError.message }, { status: 400 });

  return NextResponse.json({
    reportingAccess,
    organizations,
    organizationOfficials,
    officials,
    registrations: registrationsResult.data || [],
    programMemberships: programMembershipsResult.data || [],
    programs: programsResult.data || [],
    modules: modulesResult.data || [],
    progress: progressResult.data || [],
    quizAttempts: quizResult.data || [],
    leagueEligibility: leagueEligibilityResult.data || [],
    levelEligibility: levelEligibilityResult.data || [],
    assignments: assignmentsResult.data || [],
  });
}
