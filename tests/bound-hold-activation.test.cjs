const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.games(id int primary key, source_system text, status text, bound_source_status text, bound_hold_reasons text[]);`);
    const migration = fs.readFileSync('supabase/migrations/20261018220000_bound_status_hold_rechecks.sql', 'utf8');
    const guard = migration.slice(migration.indexOf('create function public.guard_bound_hold_activation()'), migration.indexOf('-- Acknowledgment is metadata only.'));
    await db.exec(guard);
    await db.exec(`insert into games values
      (1,'gobound','suspended','CONFIRMED',array['source_overlap']),
      (2,'gobound','canceled','CANCELLED','{}'),
      (3,'gobound','suspended','CONFIRMED','{}'),
      (4,'manual','suspended',null,'{}');`);
    await assert.rejects(db.exec("update games set status='active' where id=1"), /Bound source conflict/);
    await assert.rejects(db.exec("update games set status='active',bound_hold_reasons='{}' where id=1"), /Bound source conflict/);
    await assert.rejects(db.exec("update games set status='active' where id=2"), /Bound source conflict/);
    await assert.rejects(db.exec("update games set status='open' where id=1"), /Bound source conflict/);
    await assert.rejects(db.exec("update games set status='open' where id=2"), /Bound source conflict/);
    await assert.rejects(db.exec("update games set status='active',source_system='manual' where id=1"), /Bound source conflict/);
    await db.exec("update games set status='active' where id in(3,4)");
    assert.deepEqual((await db.query('select status from games order by id')).rows.map(x => x.status), ['suspended','canceled','active','active']);
    // Schema/function rollout has no executable top-level game backfill.
    assert.ok(migration.includes('No existing game statuses are changed by deployment'));
    assert.ok(migration.includes('from public,anon,authenticated'));
    console.log('Bound hold activation checks passed: blockers, cancellation, explicit resolved activation and non-Bound isolation.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
