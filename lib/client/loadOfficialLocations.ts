import { createClient } from "../supabase/client";

type LocationFields = {
  location_id?: string | null;
  location_name: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
};

/** Fill venue details after the assignment list is available to display. */
export async function loadOfficialLocations<T extends LocationFields>(
  sb: ReturnType<typeof createClient>,
  rows: T[],
): Promise<{ rows: T[]; error: string | null }> {
  const ids = [...new Set(rows.map((row) => row.location_id).filter((id): id is string => !!id))];
  if (!ids.length) return { rows, error: null };

  const results = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
    sb.from("locations").select("id,name,address,city,state")
      .in("id", ids.slice(index * 100, index * 100 + 100)).limit(100)));
  const error = results.find((result) => result.error)?.error;
  if (error) return { rows, error: error.message };

  const locations = new Map(results.flatMap((result) => result.data || []).map((location) => [location.id, location]));
  return {
    rows: rows.map((row) => {
      const location = row.location_id && locations.get(row.location_id);
      return location ? {
        ...row,
        location_name: location.name,
        location_address: location.address,
        location_city: location.city,
        location_state: location.state,
      } : row;
    }),
    error: null,
  };
}
