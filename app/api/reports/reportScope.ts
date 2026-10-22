import { scopeGameQuery, type LeagueAccess } from "../../../lib/server/organizationScope";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllForChunks, readAllPages } from "../../../lib/supabase/readAll";

// An empty explicit grant must never turn into an unfiltered service-role read.
const noLeague = "00000000-0000-0000-0000-000000000000";
export function scopeReportLeagues<Query>(query: Query, scope: { fullOrganizationAccess?: boolean; leagueAccess?: LeagueAccess[] | null }, column = "league_id"): Query {
  return scopeGameQuery(query, scope || {}, column === "league_id" ? undefined : column.replace(/\.league_id$/, ""));
}

export function scopeReportEligibility<Query>(query: Query, leagueIds: string[] | null): Query {
  if (leagueIds === null) return query;
  return (query as Query & { in(column: string, values: string[]): Query }).in("league_id", leagueIds?.length ? leagueIds : [noLeague]);
}

type ReportOfficialLink = {
  organization_id: string;
  official_id: string;
  active: boolean;
};

/** Scope the roster before reading personal data with the service client. */
export async function readReportOfficialLinks(scope: {
  service?: SupabaseClient;
  organizationId?: string;
  leagueIds?: string[] | null;
  fullOrganizationAccess?: boolean;
  leagueAccess?: LeagueAccess[] | null;
}) {
  const { service, organizationId, leagueIds } = scope;
  if (!service || !organizationId || leagueIds === undefined)
    return { data: null, error: { message: "Could not verify report scope." } };
  if (scope.fullOrganizationAccess === true) {
    return readAllPages<ReportOfficialLink>((from, to) => service
      .from("organization_officials")
      .select("organization_id,official_id,active")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("official_id").range(from, to));
  }
  if (!leagueIds?.length || !scope.leagueAccess?.length) return { data: [] as ReportOfficialLink[], error: null };
  const [eligibility, assigned] = await Promise.all([
    readAllForChunks<{ official_id: string }, string>(scope.leagueAccess.filter((access) => access.all_locations).map((access) => access.league_id), (ids, from, to) => service
      .from("official_league_eligibility").select("official_id,league_id").in("league_id", ids)
      .order("official_id").order("league_id").range(from, to)),
    readAllForChunks<{ official_id: string }, string>(leagueIds, (ids, from, to) => scopeGameQuery(service
      .from("assignments").select("official_id,games!inner(organization_id,league_id)")
      .eq("games.organization_id", organizationId).in("games.league_id", ids)
      .not("official_id", "is", null).order("id").range(from, to), scope, "games")),
  ]);
  if (eligibility.error || assigned.error)
    return { data: null, error: eligibility.error || assigned.error };
  return readAllForChunks<ReportOfficialLink, string>(
    [...new Set([...(eligibility.data || []), ...(assigned.data || [])].map((row) => row.official_id))],
    (ids, from, to) => service.from("organization_officials")
      .select("organization_id,official_id,active")
      .eq("organization_id", organizationId).eq("active", true)
      .in("official_id", ids).order("official_id").range(from, to),
  );
}

/** Cron must revalidate current authority, not a role saved with the schedule. */
export async function isCurrentReportOwner(
  service: SupabaseClient,
  userId: string,
  organizationId: string,
) {
  const [membership, protectedAccount] = await Promise.all([
    service.from("organization_memberships").select("role")
      .eq("organization_id", organizationId).eq("user_id", userId)
      .eq("role", "owner").limit(1).maybeSingle(),
    service.from("protected_accounts").select("user_id")
      .eq("user_id", userId).maybeSingle(),
  ]);
  if (membership.error || protectedAccount.error)
    throw new Error("Could not verify current report owner access.");
  return Boolean(membership.data || protectedAccount.data);
}
