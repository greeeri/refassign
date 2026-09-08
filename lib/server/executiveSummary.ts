import type { SupabaseClient } from "@supabase/supabase-js";

const inactive = new Set(["canceled", "cancelled", "rained_out", "on_hold"]);
const activeAssignment = (row: { status: string; official_id?: string | null }) =>
  Boolean(row.official_id) && !["declined", "cancelled", "canceled"].includes(row.status);

export type ExecutiveSummary = {
  organization: string;
  generatedAt: string;
  upcomingGames: number;
  openPositions: number;
  coverageRate: number;
  staffingRisks: number;
  outstandingPayroll: number;
  projected30DayCost: number;
  complianceIssues: number;
  trainingRate: number;
  declines30: number;
  communicationFailures30: number;
};

export async function getExecutiveSummary(service: SupabaseClient, organizationId: string): Promise<ExecutiveSummary> {
  const now = new Date(), in30 = new Date(now.getTime() + 30 * 86400000), since30 = new Date(now.getTime() - 30 * 86400000);
  const [{ data: organization }, gamesResult, linksResult] = await Promise.all([
    service.from("organizations").select("name").eq("id", organizationId).single(),
    service.from("games").select("id,status,starts_at,officials_needed").eq("organization_id", organizationId).lte("starts_at", in30.toISOString()),
    service.from("organization_officials").select("official_id").eq("organization_id", organizationId).eq("active", true),
  ]);
  if (gamesResult.error || linksResult.error) throw new Error(gamesResult.error?.message || linksResult.error?.message);
  const games = gamesResult.data || [], gameIds = games.map((game) => game.id), officialIds = (linksResult.data || []).map((row) => row.official_id);
  const [assignmentsResult, registrationsResult, membershipsResult, communicationsResult] = await Promise.all([
    gameIds.length ? service.from("assignments").select("id,game_id,official_id,status,game_fee,mileage_miles,mileage_rate,payment_status,assigned_at").in("game_id", gameIds) : Promise.resolve({ data: [], error: null }),
    officialIds.length ? service.from("official_registrations").select("official_id,status,payment_status,registration_year").in("official_id", officialIds).eq("registration_year", now.getFullYear()) : Promise.resolve({ data: [], error: null }),
    officialIds.length ? service.from("registration_program_officials").select("official_id,program_id").in("official_id", officialIds) : Promise.resolve({ data: [], error: null }),
    gameIds.length ? service.from("official_communications").select("delivery_status,created_at").in("game_id", gameIds).gte("created_at", since30.toISOString()) : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = assignmentsResult.error || registrationsResult.error || membershipsResult.error || communicationsResult.error;
  if (firstError) throw new Error(firstError.message);
  const assignments = assignmentsResult.data || [], byGame = new Map<string, typeof assignments>();
  assignments.forEach((row) => byGame.set(row.game_id, [...(byGame.get(row.game_id) || []), row]));
  const upcoming = games.filter((game) => new Date(game.starts_at) >= now && !inactive.has(game.status));
  let slots = 0, filled = 0, risks = 0;
  upcoming.forEach((game) => { const count = (byGame.get(game.id) || []).filter(activeAssignment).length, needed = Number(game.officials_needed || 0); slots += needed; filled += Math.min(needed, count); if (count < needed && new Date(game.starts_at).getTime() <= now.getTime() + 7 * 86400000) risks++; });
  const pastPayable = assignments.filter((row) => ["accepted", "confirmed"].includes(row.status) && ["unpaid", "approved"].includes(row.payment_status));
  const outstandingPayroll = pastPayable.reduce((sum, row) => sum + Number(row.game_fee || 0) + Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0), 0);
  const costRows = assignments.filter(activeAssignment), averageCost = costRows.length ? costRows.reduce((sum, row) => sum + Number(row.game_fee || 0) + Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0), 0) / costRows.length : 0;
  const futureCommitted = upcoming.reduce((sum, game) => sum + (byGame.get(game.id) || []).filter(activeAssignment).reduce((subtotal, row) => subtotal + Number(row.game_fee || 0) + Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0), 0), 0);
  const registrations = new Map((registrationsResult.data || []).map((row) => [row.official_id, row]));
  const complianceIssues = officialIds.filter((id) => { const row = registrations.get(id); return !row || !["approved", "active"].includes(row.status) || !["paid", "waived"].includes(row.payment_status); }).length;
  const programMembers = new Set((membershipsResult.data || []).map((row) => row.official_id));
  return {
    organization: organization?.name || "Organization", generatedAt: now.toISOString(), upcomingGames: upcoming.length,
    openPositions: Math.max(0, slots - filled), coverageRate: slots ? Math.round(filled / slots * 100) : 100, staffingRisks: risks,
    outstandingPayroll, projected30DayCost: futureCommitted + Math.max(0, slots - filled) * averageCost, complianceIssues, trainingRate: officialIds.length ? Math.round(programMembers.size / officialIds.length * 100) : 100,
    declines30: assignments.filter((row) => row.status === "declined" && new Date(row.assigned_at) >= since30).length,
    communicationFailures30: (communicationsResult.data || []).filter((row) => row.delivery_status === "failed").length,
  };
}
