import assert from "node:assert/strict";
import test from "node:test";

import { readAllForChunks, readAllPages } from "../lib/supabase/readAll.ts";

test("readAllPages reads beyond a 1,000-row response cap", async () => {
  const source = Array.from({ length: 2_017 }, (_, id) => ({ id }));
  const calls = [];

  const result = await readAllPages(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(result.error, null);
  assert.equal(result.data?.length, 2_017);
  assert.deepEqual(calls, [
    [0, 999],
    [1_000, 1_999],
    [2_000, 2_999],
  ]);
});

test("readAllForChunks bounds filter groups and combines every page", async () => {
  const values = [1, 2, 3, 4, 5];
  const seen = [];
  const result = await readAllForChunks(
    values,
    async (chunk, from, to) => {
      seen.push({ chunk, from, to });
      const rows = chunk.map((value) => ({ value }));
      return { data: rows.slice(from, to + 1), error: null };
    },
    2,
    2,
  );
  assert.deepEqual(result.data?.map((row) => row.value), values);
  assert.ok(seen.every((call) => call.chunk.length <= 2));
});

test("readAllPages returns an error instead of incomplete data", async () => {
  const result = await readAllPages(async (from) =>
    from === 0
      ? { data: Array.from({ length: 1_000 }, (_, id) => ({ id })), error: null }
      : { data: null, error: { message: "page failed" } },
  );

  assert.equal(result.data, null);
  assert.equal(result.error?.message, "page failed");
});
