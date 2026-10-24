import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages, type PageResult } from "../supabase/readAll";
import { fieldComplexMap, complexVenueFilterValue, isParentVenueFilter, type VenueField } from "./venueFilter";

export type AssignmentVenueRow = { location_id: string; name: string; field_complex: string | null; venue_id?: string | null; venue_name?: string | null };
export type AssignmentVenueDirectory = { fields: VenueField[]; complexes: Record<string, string> };
export type VenueDirectoryRequest = {
  key: string;
  expiresAt: number;
  promise: Promise<PageResult<AssignmentVenueRow>>;
};
export const venueDirectoryMaxAgeMs = 30_000;

/** A single scope-keyed slot: never retain another user's/league's directory.
 * Auth and current grants are rechecked by the caller before every lookup.
 * Errors are not cached; explicit schedule refreshes invalidate this slot.
 */
export function loadAssignmentVenueDirectory(
  supabase: Pick<SupabaseClient, "rpc">,
  cache: { current: VenueDirectoryRequest | null },
  key: string,
  organizationId: string,
  leagueId: string,
  now = Date.now(),
): Promise<PageResult<AssignmentVenueRow>> {
  if (cache.current?.key === key && cache.current.expiresAt > now) return cache.current.promise;
  const request: VenueDirectoryRequest = {
    key, expiresAt: now + venueDirectoryMaxAgeMs,
    promise: (async () => {
      const read = (rpc: string) => readAllPages<AssignmentVenueRow>((from, to) =>
        supabase.rpc(rpc, {
          p_organization_id: organizationId, p_league_id: leagueId || null,
        }).order("location_id").range(from, to));
      const result = await read("get_assignment_venue_directory_v2");
      const error = result.error as { code?: string; message: string } | null;
      // Compatibility only for an unapplied v2 migration, not permission or
      // network failures. The legacy RPC has exactly the same league boundary.
      if (error && (error.code === "PGRST202" || error.code === "42883") &&
          error.message.includes("get_assignment_venue_directory_v2")) {
        return read("get_assignment_venue_directory");
      }
      return result;
    })(),
  };
  cache.current = request;
  request.promise = request.promise.then(result => {
    if (result.error && cache.current === request) cache.current = null;
    return result;
  }, error => {
    if (cache.current === request) cache.current = null;
    return { data: null, error: { message: error instanceof Error ? error.message : "League venues could not be loaded." } };
  });
  return request.promise;
}

export function assignmentVenueDirectory(rows: AssignmentVenueRow[]): AssignmentVenueDirectory {
  return {
    fields: rows.map(row => ({ id: row.location_id, name: row.name, venue_id: row.venue_id, venue_name: row.venue_name })),
    complexes: fieldComplexMap(rows),
  };
}

/** Prune legacy field/complex choices; unavailable parent selections fail closed. */
export function validAssignmentVenueSelection(
  selected: string[], organizationId: string, directory: AssignmentVenueDirectory,
): string[] {
  const allowed = new Set([
    ...directory.fields.map(field => field.id),
    ...Object.values(directory.complexes).map(name => complexVenueFilterValue(organizationId, name)),
  ]);
  // Keep an unavailable saved parent visible and fail closed. This also
  // prevents a rolling deployment to a legacy server clearing a venue filter
  // into an unrestricted schedule. Users may explicitly clear the selection.
  return selected.filter(value => allowed.has(value) || isParentVenueFilter(value));
}
