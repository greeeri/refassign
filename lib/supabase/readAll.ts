export type PageError = {
  message: string;
};

export type PageResult<T> = {
  data: T[] | null;
  error: PageError | null;
};

/**
 * Read every row from a Supabase query without relying on the API's maximum
 * response size. Callers must apply a deterministic order before `range`.
 */
export async function readAllPages<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<PageResult<T>> {
  const data: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await readPage(from, from + pageSize - 1);
    if (page.error) return { data: null, error: page.error };

    const rows = page.data || [];
    data.push(...rows);
    if (rows.length < pageSize) return { data, error: null };
  }
}

/** Read paged rows for bounded groups of filter values to avoid oversized URLs. */
export async function readAllForChunks<T, V>(
  values: V[],
  readChunkPage: (values: V[], from: number, to: number) => PromiseLike<PageResult<T>>,
  chunkSize = 200,
  pageSize = 1000,
): Promise<PageResult<T>> {
  const data: T[] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const result = await readAllPages<T>(
      (from, to) => readChunkPage(values.slice(index, index + chunkSize), from, to),
      pageSize,
    );
    if (result.error) return result;
    data.push(...(result.data || []));
  }
  return { data, error: null };
}
