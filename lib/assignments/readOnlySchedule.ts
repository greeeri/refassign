/** Load every bounded server page before exposing global filters and counts. */
export async function readOnlySchedule<T>(organizationId: string, signal: AbortSignal): Promise<{ games: T[]; isMentor: boolean }> {
  const games: T[] = [];
  let offset = 0;
  let from = "";
  let isMentor = false;
  for (;;) {
    const params = new URLSearchParams({ organizationId, offset: String(offset) });
    if (from) params.set("from", from);
    const response = await fetch(`/api/assignments/read-only?${params}`, { signal, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load assignments.");
    if (!Array.isArray(result.games)) throw new Error("Could not load assignments.");
    games.push(...result.games);
    isMentor = Boolean(result.isMentor);
    if (!result.hasMore) return { games, isMentor };
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset || !result.from)
      throw new Error("Could not load the next assignment page.");
    offset = result.nextOffset;
    // Pin the cutoff across pages. The server asks for a reload if midnight passes.
    from = result.from;
  }
}
