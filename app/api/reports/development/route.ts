import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { iowaEntryRulesAnswers } from "../../../../lib/server/iowaEntryRulesQuizAnswers";

const quizTopics: Record<string, string> = {
  q1: "Players & match time",
  q2: "Players & match time",
  q3: "Players & match time",
  q4: "Ball in/out & goals",
  q5: "Ball in/out & goals",
  q6: "Restarts",
  q7: "Restarts",
  q8: "Restarts",
  q9: "Restarts",
  q10: "Restarts",
  q11: "Offside",
  q12: "Offside",
  q13: "Free kicks & penalties",
  q14: "Free kicks & penalties",
  q15: "Free kicks & penalties",
  q16: "Free kicks & penalties",
  q17: "Fouls & discipline",
  q18: "Fouls & discipline",
  q19: "Fouls & discipline",
  q20: "Fouls & discipline",
  q21: "Fouls & discipline",
  q22: "Equipment & safety",
  q23: "Equipment & safety",
  q24: "Restarts",
  q25: "Free kicks & penalties",
};

type QuizAttempt = {
  id: string;
  module_id: string;
  official_id: string;
  answers: Record<string, string> | null;
  correct_count: number;
  total_questions: number;
  score_percent: number;
  passed: boolean;
  completed_at: string;
};

function topicScores(attempt: QuizAttempt) {
  const scores = new Map<string, { correct: number; total: number }>();
  Object.entries(attempt.answers || {}).forEach(([question, answer]) => {
    const topic = quizTopics[question] || "Other";
    const current = scores.get(topic) || { correct: 0, total: 0 };
    current.total += 1;
    if (iowaEntryRulesAnswers[question]?.correct === answer)
      current.correct += 1;
    scores.set(topic, current);
  });
  return [...scores].map(([topic, score]) => ({ topic, ...score }));
}

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
    const [links, organizationRows] = await Promise.all([
      service
        .from("organization_officials")
        .select("organization_id,official_id")
        .in("organization_id", organizationIds)
        .eq("active", true),
      service
        .from("organizations")
        .select("id,name")
        .in("id", organizationIds)
        .order("name"),
    ]);
    if (links.error || organizationRows.error)
      return NextResponse.json(
        { error: links.error?.message || organizationRows.error?.message },
        { status: 400 },
      );
    organizationOfficials = links.data || [];
    organizations = organizationRows.data || [];
  }

  let officialIds = [
    ...new Set(organizationOfficials.map((row) => row.official_id)),
  ];
  let officials: Array<Record<string, unknown>> = [];
  if (officialIds.length) {
    const result = await service
      .from("officials")
      .select("id,first_name,last_name,email,active,certification_level")
      .in("id", officialIds)
      .order("last_name")
      .order("first_name");
    if (result.error)
      return NextResponse.json(
        { error: result.error.message },
        { status: 400 },
      );
    officials = result.data || [];
  } else if (!organizationIds.length) {
    const result = await supabase
      .from("officials")
      .select("id,first_name,last_name,email,active,certification_level")
      .order("last_name")
      .order("first_name");
    if (result.error)
      return NextResponse.json(
        { error: result.error.message },
        { status: 400 },
      );
    officials = result.data || [];
    officialIds = officials.map((row) => String(row.id));
  }

  const empty = {
    reportingAccess,
    organizations,
    organizationOfficials,
    officials,
    programMemberships: [],
    programs: [],
    modules: [],
    progress: [],
    quizAttempts: [],
    quizTopicScores: [],
    mentorRequests: [],
    notes: [],
    questions: [],
    assignments: [],
  };
  if (!officialIds.length) return NextResponse.json(empty);

  const programMembershipsResult = await service
    .from("registration_program_officials")
    .select("program_id,official_id,added_at")
    .in("official_id", officialIds);
  if (programMembershipsResult.error)
    return NextResponse.json(
      { error: programMembershipsResult.error.message },
      { status: 400 },
    );
  const programIds = [
    ...new Set(
      (programMembershipsResult.data || []).map((row) => row.program_id),
    ),
  ];
  if (!programIds.length)
    return NextResponse.json({
      ...empty,
      programMemberships: programMembershipsResult.data || [],
    });

  const [
    programs,
    modules,
    progress,
    quizzes,
    mentorRequests,
    notes,
    questions,
    assignments,
  ] = await Promise.all([
    service
      .from("registration_programs")
      .select("id,name,slug,active")
      .in("id", programIds)
      .order("name"),
    service
      .from("development_modules")
      .select(
        "id,program_id,title,category,required,active,content_type,sort_order,course_end_at",
      )
      .in("program_id", programIds)
      .eq("active", true)
      .order("sort_order"),
    service
      .from("official_development_progress")
      .select("module_id,official_id,status,completed_at,updated_at")
      .in("official_id", officialIds),
    service
      .from("development_quiz_attempts")
      .select(
        "id,module_id,official_id,answers,correct_count,total_questions,score_percent,passed,completed_at",
      )
      .in("official_id", officialIds)
      .order("completed_at", { ascending: false }),
    service
      .from("development_mentor_requests")
      .select(
        "id,program_id,official_id,status,requested_at,responded_at,accepted_at,accepted_by_official_id",
      )
      .in("program_id", programIds)
      .in("official_id", officialIds),
    service
      .from("official_development_notes")
      .select("id,program_id,official_id,created_at")
      .in("program_id", programIds)
      .in("official_id", officialIds),
    service
      .from("development_questions")
      .select("id,program_id,official_id,status,asked_at,responded_at")
      .in("program_id", programIds)
      .in("official_id", officialIds),
    reportingAccess === "premium"
      ? supabase
          .from("assignments")
          .select(
            "id,official_id,status,assigned_at,games!inner(id,starts_at,organization_id,level_id,levels(name)),sport_positions(name)",
          )
          .in("official_id", officialIds)
          .eq("games.organization_id", organizationId)
          .in("status", ["accepted", "confirmed"])
          .lte("games.starts_at", new Date().toISOString())
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error =
    programs.error ||
    modules.error ||
    progress.error ||
    quizzes.error ||
    mentorRequests.error ||
    notes.error ||
    questions.error ||
    assignments.error;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const quizAttempts = (quizzes.data || []) as QuizAttempt[];
  return NextResponse.json({
    reportingAccess,
    organizations,
    organizationOfficials,
    officials,
    programMemberships: programMembershipsResult.data || [],
    programs: programs.data || [],
    modules: modules.data || [],
    progress: progress.data || [],
    quizAttempts: quizAttempts.map(
      ({ answers: _answers, ...attempt }) => attempt,
    ),
    quizTopicScores:
      reportingAccess === "premium"
        ? quizAttempts.map((attempt) => ({
            attempt_id: attempt.id,
            module_id: attempt.module_id,
            official_id: attempt.official_id,
            completed_at: attempt.completed_at,
            topics: topicScores(attempt),
          }))
        : [],
    mentorRequests: mentorRequests.data || [],
    notes: notes.data || [],
    questions: questions.data || [],
    assignments: assignments.data || [],
  });
}
