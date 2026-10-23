export type BoundedGamePageRow = { id: string; starts_at: string };
export type BoundedGamePageError = { message: string };

export type BoundedGamePageOptions<T extends BoundedGamePageRow> = {
  sourceCount: number;
  offsets?: readonly number[];
  readPage: (sourceIndex: number, from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: BoundedGamePageError | null;
  }>;
  matches: (row: T) => boolean;
  pageSize?: number;
  batchSize?: number;
  maxScanned?: number;
  maxRequests?: number;
};

export type BoundedGamePageResult<T> = {
  data: T[] | null;
  error: BoundedGamePageError | null;
  nextOffsets: number[] | null;
  hasMore: boolean;
};

// Postgres timestamptz can retain precision finer than Date's milliseconds.
// For instants in the same millisecond, compare the remaining decimal digits
// before IDs. Removing trailing zeroes makes equivalent representations equal.
function subMillisecondPart(instant: string): string {
  return (instant.match(/\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i)?.[1] || "")
    .slice(3).replace(/0+$/, "");
}

/**
 * Merge disjoint, ordered sources without collecting an entire date range.
 * Every source must already apply authorization, active query filters, and ascending
 * starts_at/id ordering. `matches` must not widen those query filters.
 * Supabase range endpoints are inclusive. Never pass filtered batches here.
 *
 * A cursor records consumed raw rows, not fetched rows. The extra matching row
 * used to detect another page is therefore returned again on the next call.
 * Keep source identities/order and all query/predicate filters unchanged while
 * using a cursor; reset it when any filter, scope, or source membership changes.
 *
 * maxScanned bounds raw rows requested, including lookahead. Initial batches
 * shrink when necessary to leave a head for every source within that budget.
 * A budget-limited page may be short or empty with hasMore=true. Only a page
 * with hasMore=false establishes exhaustion; this helper never computes totals.
 */
export async function readBoundedGamePage<T extends BoundedGamePageRow>({
  sourceCount,
  offsets,
  readPage,
  matches,
  pageSize = 50,
  batchSize = 50,
  maxScanned = 500,
  maxRequests = 20,
}: BoundedGamePageOptions<T>): Promise<BoundedGamePageResult<T>> {
  const fail = (message: string): BoundedGamePageResult<T> => ({
    data: null, error: { message }, nextOffsets: null, hasMore: false,
  });
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0
    || [pageSize, batchSize, maxScanned, maxRequests].some(value => !Number.isSafeInteger(value) || value < 1)) {
    return fail("Invalid bounded assignment page configuration.");
  }
  if (offsets && (offsets.length !== sourceCount
    || offsets.some(value => !Number.isSafeInteger(value) || value < 0))) {
    return fail("Invalid assignment page cursor. Reload the first page.");
  }
  // Without every source head, the earliest remaining game is unknowable.
  // Fail explicitly rather than skip a chunk or silently scan without a limit.
  if (sourceCount > maxRequests || sourceCount > maxScanned) {
    return fail("Too many venue groups for one assignment page. Narrow your selected venues and try again.");
  }
  if (!sourceCount) return { data: [], error: null, nextOffsets: null, hasMore: false };

  const consumed = offsets ? [...offsets] : Array<number>(sourceCount).fill(0);
  const sources = Array.from({ length: sourceCount }, () => ({
    rows: [] as T[], index: 0, exhausted: false,
  }));
  const data: T[] = [];
  let requestedRows = 0;
  let requests = 0;
  const finish = (hasMore: boolean): BoundedGamePageResult<T> => ({
    data, error: null, nextOffsets: hasMore ? [...consumed] : null, hasMore,
  });

  async function fill(sourceIndex: number, size: number): Promise<BoundedGamePageError | null> {
    const from = consumed[sourceIndex];
    if (!Number.isSafeInteger(from + size)) return { message: "Assignment page cursor is out of range." };
    requestedRows += size;
    requests++;
    const result = await readPage(sourceIndex, from, from + size - 1);
    if (result.error) return result.error;
    const rows = result.data || [];
    if (rows.length > size) return { message: "Assignment query returned an unbounded page." };
    const source = sources[sourceIndex];
    source.rows = rows;
    source.index = 0;
    // Only the raw response size can establish exhaustion, never matches().
    source.exhausted = rows.length < size;
    return null;
  }

  try {
    const initialSize = Math.min(batchSize, Math.floor(maxScanned / sourceCount));
    const initialErrors = await Promise.all(sources.map((_, index) => fill(index, initialSize)));
    const initialError = initialErrors.find(error => error);
    if (initialError) return fail(initialError.message);

    for (;;) {
      // A depleted, non-exhausted source must be replenished before comparing
      // heads. Returning other buffered rows first could break global ordering.
      for (let index = 0; index < sourceCount; index++) {
        const source = sources[index];
        if (source.index < source.rows.length || source.exhausted) continue;
        const size = Math.min(batchSize, maxScanned - requestedRows);
        if (requests >= maxRequests || !size) return finish(true);
        const error = await fill(index, size);
        if (error) return fail(error.message);
      }

      let next = -1;
      let nextTime = 0;
      let nextFraction = "";
      for (let index = 0; index < sourceCount; index++) {
        const source = sources[index];
        if (source.index >= source.rows.length) continue;
        const row = source.rows[source.index];
        const time = Date.parse(row.starts_at);
        if (!Number.isFinite(time)) return fail("Assignment query returned an invalid game start time.");
        const fraction = subMillisecondPart(row.starts_at);
        const previous = next < 0 ? null : sources[next].rows[sources[next].index];
        if (next < 0 || time < nextTime
          || (time === nextTime && (fraction < nextFraction || (fraction === nextFraction && row.id < previous!.id)))) {
          next = index;
          nextTime = time;
          nextFraction = fraction;
        }
      }
      if (next < 0) return finish(false);

      const source = sources[next];
      const row = source.rows[source.index];
      if (matches(row)) {
        if (data.length === pageSize) return finish(true);
        data.push(row);
      }
      source.index++;
      consumed[next]++;
    }
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      && typeof error.message === "string" ? error.message : "Could not load assignment games.";
    return fail(message);
  }
}
