/** A league grant is unrestricted by venue only when that permission is explicit. */
export type LeagueGameAccess = {
  league_id: string;
  all_locations: boolean;
  location_ids: string[];
};

export function leagueGameAccessKey(grants: LeagueGameAccess[] = []): string {
  return JSON.stringify(grants.map((grant) => [
    grant.league_id, grant.all_locations === true,
    grant.all_locations === true ? [] : [...new Set(grant.location_ids || [])].sort(),
  ]).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

/**
 * Add the full league/venue boundary before order/range/limit. Missing grants,
 * unchecked All locations with no selected venues, and null venues fail closed.
 * Quoting values prevents a stored identifier from introducing filter syntax.
 */
export function applyLeagueGameAccess<T extends { in: (column: string, values: string[]) => T; or: (filters: string) => T }>(
  query: T,
  grants: LeagueGameAccess[] = [],
  fullOrganizationAccess = false,
): T | null {
  if (fullOrganizationAccess) return query;
  const usable = grants.filter((grant) => grant.league_id &&
    (grant.all_locations === true || (grant.location_ids || []).length > 0));
  if (!usable.length) return null;
  query = query.in("league_id", [...new Set(usable.map((grant) => grant.league_id))]);
  if (usable.every((grant) => grant.all_locations === true)) return query;
  const value = (id: string) => JSON.stringify(id);
  const clauses = usable.map((grant) => grant.all_locations === true
    ? `league_id.eq.${value(grant.league_id)}`
    : `and(league_id.eq.${value(grant.league_id)},location_id.in.(${[...new Set(grant.location_ids || [])].map(value).join(",")}))`);
  return query.or(clauses.join(","));
}

export function canAccessLeagueGameLocation(
  grants: LeagueGameAccess[] = [],
  leagueId: string | null | undefined,
  locationId: string | null | undefined,
  fullOrganizationAccess = false,
): boolean {
  if (fullOrganizationAccess) return true;
  return Boolean(leagueId && grants.some((grant) => grant.league_id === leagueId &&
    (grant.all_locations === true || Boolean(locationId && (grant.location_ids || []).includes(locationId)))));
}
