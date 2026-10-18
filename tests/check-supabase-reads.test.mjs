import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { findUnboundedReads } from "../scripts/check-supabase-reads.mjs";

const check = (source) => findUnboundedReads("fixture.ts", source, new Set());

test("primary-key availability mutations returning a row are not collection reads", () => {
  for (const mutation of ["delete()", "update({ notes: 'updated' })"]) {
    assert.deepEqual(check(`
      const result = await service.from('official_availability_blocks')
        .${mutation}.eq('id', block.id).select('id');
    `), []);
    assert.deepEqual(check(`
      const result = await service.from('official_availability_blocks')
        .${mutation}.select('id').eq('id', block.id);
    `), []);
  }
});

test("unbounded or non-primary-key mutations are not broadly exempted", () => {
  for (const filter of ["", ".eq('official_id', official.id)", ".in('id', ids)"]) {
    assert.equal(check(`
      const result = await service.from('official_availability_blocks')
        .delete()${filter}.select('id');
    `).length, 1);
  }
  assert.equal(check(`
    const result = await service.from('organization_officials')
      .delete().eq('official_id', official.id).select('official_id');
  `).length, 1);
});

test("ordinary collection reads remain flagged even alongside a bounded mutation", () => {
  const failures = check(`
    const all = await service.from('official_availability_blocks').select('id');
    const removed = await service.from('official_availability_blocks')
      .delete().eq('id', block.id).select('id');
  `);
  assert.deepEqual(failures, ["fixture.ts:2 official_availability_blocks"]);
  assert.equal(check(`service.from('official_availability_blocks').select('id').eq('id', id)`)
    .length, 1);
});

test("explicit limits, pagination and unique-result APIs are recognized", () => {
  for (const bound of ["limit(500)", "range(0, 999)", "single()", "maybeSingle()"]) {
    assert.deepEqual(check(`service.from('officials').select('id').${bound}`), []);
  }
  assert.equal(check(`service.from('officials').select('id').in('id', ids)`).length, 1);
});

test("the existing availability deletion passes without exempting its table", () => {
  const file = "components/AvailabilityCalendar.tsx";
  const source = fs.readFileSync(file, "utf8");
  const failures = findUnboundedReads(file, source);
  assert.deepEqual(failures, []);
  assert.equal(findUnboundedReads(file, `${source}\nsupabase.from('official_availability_blocks').select('*');`)
    .length, 1);
});

test("the reviewed singleton mutation key is backed by the database schema", () => {
  const migration = fs.readFileSync(
    "supabase/migrations/20260907153500_complete_isolated_workspace_support_tables.sql", "utf8",
  );
  assert.match(migration, /create table if not exists public\.official_availability_blocks\s*\(\s*id uuid primary key/i);
});
