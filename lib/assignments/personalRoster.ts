import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "../supabase/readAll";

export type PersonalRosterState = { prepared: boolean; enabled: boolean; owner_wide: boolean; can_manage: boolean };
export async function readPersonalRosterScope(client: Pick<SupabaseClient, "rpc">, organizationId: string) {
  const state = await client.rpc("get_personal_roster_state", { p_organization_id: organizationId });
  if (state.error) return { state: null, ids: null, error: state.error };
  const value = state.data as PersonalRosterState;
  if (!value || [value.prepared, value.enabled, value.owner_wide, value.can_manage].some(flag => typeof flag !== "boolean"))
    return { state: null, ids: null, error: { message: "Could not verify your personal roster." } };
  if (!value.enabled || value.owner_wide || !value.can_manage) return { state: value, ids: null, error: null };
  const result = await readAllPages<{ official_id: string }>((from, to) => client
    .rpc("list_personal_roster_official_ids", { p_organization_id: organizationId })
    .order("official_id").range(from, to));
  return { state: value, ids: result.error ? null : (result.data || []).map(row => row.official_id), error: result.error };
}

export type RosterMatch = { official_id: string; display_name: string; email_hint: string; in_roster: boolean; match_exact: boolean };
export type RosterImportRow = { query: string; status: "match" | "duplicate" | "already added" | "not found" | "ambiguous"; official?: RosterMatch };
export function chooseRosterImportMatch(query: string, matches: RosterMatch[], seen: Set<string>): RosterImportRow {
  const exact = matches.filter(row => row.match_exact);
  if (exact.length !== 1) return { query, status: exact.length > 1 || matches.length ? "ambiguous" : "not found" };
  const official = exact[0];
  if (seen.has(official.official_id)) return { query, status: "duplicate", official };
  seen.add(official.official_id);
  return { query, status: official.in_roster ? "already added" : "match", official };
}
