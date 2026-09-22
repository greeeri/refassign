import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { readAllPages } from "../../../../lib/supabase/readAll";

export async function GET(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { session: supabase, service, organizationId } = scope;
  const organizationIds = [organizationId];
  let subscriptionQuery = service
    .from("refassign_subscriptions")
    .select("reporting_access")
    .in("status", ["active", "trialing", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);
  subscriptionQuery = subscriptionQuery.eq("organization_id", organizationId);
  const { data: subscription } = await subscriptionQuery.maybeSingle();
  const reportingAccess =
    subscription?.reporting_access === "standard" ? "standard" : "premium";

  let organizationOfficials: Array<{
    organization_id: string;
    official_id: string;
  }> = [];
  let organizations: Array<{ id: string; name: string }> = [];
  if (organizationIds.length) {
    const [linksResult, organizationsResult] = await Promise.all([
      readAllPages<{ organization_id: string; official_id: string }>(
        (from, to) =>
          service
            .from("organization_officials")
            .select("organization_id,official_id")
            .in("organization_id", organizationIds)
            .eq("active", true)
            .order("official_id")
            .range(from, to),
      ),
      service
        .from("organizations")
        .select("id,name")
        .in("id", organizationIds)
        .order("name"),
    ]);
    if (linksResult.error || organizationsResult.error)
      return NextResponse.json(
        {
          error:
            linksResult.error?.message || organizationsResult.error?.message,
        },
        { status: 400 },
      );
    organizationOfficials = linksResult.data || [];
    organizations = organizationsResult.data || [];
  }

  let officialIds = [
    ...new Set(organizationOfficials.map((row) => row.official_id)),
  ];
  let officials: Array<Record<string, unknown>> = [];
  if (officialIds.length) {
    const { data, error } = await readAllPages<Record<string, unknown>>(
      (from, to) =>
        service
          .from("officials")
          .select(
            "id,first_name,last_name,email,active,certification_level,college_license_level,high_school_license_level,us_soccer_license_level",
          )
          .in("id", officialIds)
          .order("last_name")
          .order("first_name")
          .order("id")
          .range(from, to),
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    officials = data || [];
  } else if (!organizationIds.length) {
    // Legacy fallback remains RLS-scoped for accounts not yet attached to an organization.
    const { data, error } = await readAllPages<Record<string, unknown>>(
      (from, to) =>
        supabase
          .from("officials")
          .select(
            "id,first_name,last_name,email,active,certification_level,college_license_level,high_school_license_level,us_soccer_license_level",
          )
          .order("last_name")
          .order("first_name")
          .order("id")
          .range(from, to),
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });
    officials = data || [];
    officialIds = officials.map((row) => String(row.id));
  }

  if (!officialIds.length)
    return NextResponse.json({
      reportingAccess,
      organizations,
      organizationOfficials,
      officials: [],
      registrations: [],
      programMemberships: [],
      programs: [],
      modules: [],
      progress: [],
      quizAttempts: [],
      leagueEligibility: [],
      levelEligibility: [],
      assignments: [],
    });

  const [
    registrationsResult,
    programMembershipsResult,
    leagueEligibilityResult,
    levelEligibilityResult,
  ] = await Promise.all([
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("official_registrations")
        .select(
          "id,official_id,registration_year,status,payment_status,paid_at,reviewed_at,registration_program_id,registration_programs(id,name)",
        )
        .in("official_id", officialIds)
        .order("id")
        .range(from, to),
    ),
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("registration_program_officials")
        .select("program_id,official_id")
        .in("official_id", officialIds)
        .order("official_id")
        .order("program_id")
        .range(from, to),
    ),
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("official_league_eligibility")
        .select("official_id,league_id,leagues(id,name)")
        .in("official_id", officialIds)
        .order("official_id")
        .order("league_id")
        .range(from, to),
    ),
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("official_level_eligibility")
        .select("official_id,level_id,center_eligible,ar_eligible,levels(id,name)")
        .in("official_id", officialIds)
        .order("official_id")
        .order("level_id")
        .range(from, to),
    ),
  ]);
  const firstError =
    registrationsResult.error ||
    programMembershipsResult.error ||
    leagueEligibilityResult.error ||
    levelEligibilityResult.error;
  if (firstError)
    return NextResponse.json({ error: firstError.message }, { status: 400 });

  const programIds = [
    ...new Set(
      (programMembershipsResult.data || []).map((row) => row.program_id),
    ),
  ];
  const [
    programsResult,
    modulesResult,
    progressResult,
    quizResult,
    assignmentsResult,
  ] = await Promise.all([
    programIds.length
      ? service
          .from("registration_programs")
          .select("id,name,slug,active")
          .in("id", programIds)
      : Promise.resolve({ data: [], error: null }),
    programIds.length
      ? service
          .from("development_modules")
          .select(
            "id,program_id,title,required,active,content_type,course_end_at",
          )
          .in("program_id", programIds)
          .eq("required", true)
          .eq("active", true)
      : Promise.resolve({ data: [], error: null }),
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("official_development_progress")
        .select("module_id,official_id,status,completed_at")
        .in("official_id", officialIds)
        .order("official_id")
        .order("module_id")
        .range(from, to),
    ),
    readAllPages<Record<string, any>>((from, to) =>
      service
        .from("development_quiz_attempts")
        .select("module_id,official_id,score_percent,passed,completed_at")
        .in("official_id", officialIds)
        .eq("passed", true)
        .order("id")
        .range(from, to),
    ),
    reportingAccess === "premium"
      ? readAllPages<Record<string, any>>((from, to) =>
          supabase
            .from("assignments")
            .select(
              "id,official_id,status,games!inner(id,game_number,starts_at,status,league_id,level_id,organization_id,leagues(name),levels(name),location:locations(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)),sport_positions(name)",
            )
            .in("official_id", officialIds)
            .eq("games.organization_id", organizationId)
            .gte("games.starts_at", new Date().toISOString())
            .not("status", "in", "(declined,cancelled)")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);
  const secondError =
    programsResult.error ||
    modulesResult.error ||
    progressResult.error ||
    quizResult.error ||
    assignmentsResult.error;
  if (secondError)
    return NextResponse.json({ error: secondError.message }, { status: 400 });

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
