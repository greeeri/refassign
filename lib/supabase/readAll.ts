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
