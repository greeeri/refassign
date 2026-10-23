import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllForChunks, readAllPages, type PageResult } from "../supabase/readAll";

import { readPersonalRosterScope } from "./personalRoster";

type LeagueGame = { league_id: string | null };
type OfficialIdentity = { id: string; first_name: string; last_name: string };
type LeagueEligibility = { official_id: string; league_id: string };
const officialColumns = "id,first_name,last_name,email,phone,sports,active,home_city,home_state,home_latitude,home_longitude";

// An empty page has no candidates. Only an actual league-less game retains
// the existing unrestricted-league behavior; [] must never mean all officials.
export function assignmentCandidateLeagueScope(games: LeagueGame[]): string[] | null {
  if (games.some((game) => !game.league_id)) return null;
  return [...new Set(games.map((game) => game.league_id!))].sort();
}

export function isLeagueCandidate(
  officialId: string,
  targets: LeagueGame[],
  candidateIds: ReadonlySet<string>,
  eligibility: LeagueEligibility[],
): boolean {
  return candidateIds.has(officialId) && targets.length > 0 && targets.every((game) =>
    !game.league_id || eligibility.some((row) =>
      row.official_id === officialId && row.league_id === game.league_id));
}

/** Filter in PostgREST before downloading profiles and candidate metadata.
 * This uses the existing caller/RLS, not a privileged RPC or changed policy.
 * Assigned profiles are display-only and do not become searchable candidates.
 */
export async function loadAssignmentOfficialRoster<T extends OfficialIdentity>(
  supabase: Pick<SupabaseClient, "from" | "rpc">,
  organizationId: string | undefined,
  leagueIds: string[] | null,
  assignedOfficialIds: string[],
): Promise<PageResult<T> & { candidateIds: string[] }> {
  const personal = organizationId ? await readPersonalRosterScope(supabase, organizationId) : { ids: null, error: null };
  if (personal.error) return { data: null, error: personal.error, candidateIds: [] };
  const rosterIds = personal.ids;
  const leagueJoin = leagueIds === null ? "" : ",official_league_eligibility!inner(league_id)";
  const roster: PageResult<T> = leagueIds?.length === 0 || rosterIds?.length === 0
    ? { data: [], error: null }
    : organizationId
      ? await (async () => {
        const chunks: (string[] | null)[] = rosterIds === null ? [null] : [];
        for (let offset = 0; rosterIds && offset < rosterIds.length; offset += 200) chunks.push(rosterIds.slice(offset, offset + 200));
        const rows: T[] = [];
        for (const chunk of chunks) {
          const result = await readAllPages<{ official_id: string; officials: T }>((from, to) => {
          // data-access: query-builder; every request is ordered and ranged below.
          let query = supabase.from("organization_officials")
            .select(`official_id,officials!inner(${officialColumns}${leagueJoin})`)
            .eq("organization_id", organizationId).eq("active", true).eq("officials.active", true);
          if (chunk) query = query.in("official_id", chunk);
          if (leagueIds !== null)
            query = query.in("officials.official_league_eligibility.league_id", leagueIds);
          return query.order("official_id").range(from, to) as unknown as PromiseLike<PageResult<{ official_id: string; officials: T }>>;
          }, 1000, 2);
          if (result.error) return { data: null, error: result.error };
          rows.push(...(result.data || []).map(row => row.officials));
        }
        return { data: rows, error: null };
      })()
      : await readAllPages<T>((from, to) => {
          // data-access: query-builder; every request is ordered and ranged below.
          let query = supabase.from("officials").select(`${officialColumns}${leagueJoin}`).eq("active", true);
          if (leagueIds !== null) query = query.in("official_league_eligibility.league_id", leagueIds);
          return query.order("last_name").order("first_name").order("id").range(from, to) as unknown as PromiseLike<PageResult<T>>;
        }, 1000, 2);
  if (roster.error) return { data: null, error: roster.error, candidateIds: [] };

  const candidateIds = (roster.data || []).map((official) => official.id);
  const candidateSet = new Set(candidateIds);
  const displayIds = [...new Set(assignedOfficialIds)].filter((id) => !candidateSet.has(id));
  const assigned = await readAllForChunks<T, string>(displayIds, (ids, from, to) =>
    supabase.from("officials").select(officialColumns).in("id", ids)
      .order("id").range(from, to) as unknown as PromiseLike<PageResult<T>>);
  if (assigned.error) return { data: null, error: assigned.error, candidateIds: [] };
  const data = [...(roster.data || []), ...(assigned.data || [])].sort((a, b) =>
    a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name) || a.id.localeCompare(b.id));
  return { data, error: null, candidateIds };
}
