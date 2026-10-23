import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages, type PageResult } from "../supabase/readAll";
import { fieldComplexMap, complexVenueFilterValue, type VenueField } from "./venueFilter";

export type AssignmentVenueRow = { location_id: string; name: string; field_complex: string | null };
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
    promise: readAllPages<AssignmentVenueRow>((from, to) =>
      supabase.rpc("get_assignment_venue_directory", {
        p_organization_id: organizationId, p_league_id: leagueId || null,
      }).order("location_id").range(from, to)),
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
    fields: rows.map(row => ({ id: row.location_id, name: row.name })),
    complexes: fieldComplexMap(rows),
  };
}

/** Keep shared fields/complexes on league changes, remove only invalid choices. */
export function validAssignmentVenueSelection(
  selected: string[], organizationId: string, directory: AssignmentVenueDirectory,
): string[] {
  const allowed = new Set([
    ...directory.fields.map(field => field.id),
    ...Object.values(directory.complexes).map(name => complexVenueFilterValue(organizationId, name)),
  ]);
  return selected.filter(value => allowed.has(value));
}
