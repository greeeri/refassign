const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
function load(file) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name) });
  return module.exports;
}
const api = load('lib/assignments/venueDirectory.ts');
const plain = value => JSON.parse(JSON.stringify(value));
function client() {
  const calls = [], pending = [];
  const supabase = { rpc(name, args) {
    const call = { name, args: plain(args) }; calls.push(call);
    const query = { order(column) { call.order = column; return query; }, range(from, to) {
      call.range = [from, to]; return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    } }; return query;
  } };
  return { supabase, calls, pending };
}
test('directory request sends league predicate at source and coalesces pending/completed same-key reads', async () => {
  const c = client(), cache = { current: null };
  const first = api.loadAssignmentVenueDirectory(c.supabase, cache, 'user:org:scope:a', 'org', 'a', 100);
  const second = api.loadAssignmentVenueDirectory(c.supabase, cache, 'user:org:scope:a', 'org', 'a', 110);
  assert.equal(first, second); assert.equal(c.calls.length, 1);
  assert.deepEqual(c.calls[0], { name: 'get_assignment_venue_directory_v2', args: { p_organization_id: 'org', p_league_id: 'a' }, order: 'location_id', range: [0, 999] });
  c.pending[0].resolve({ data: [{ location_id: 'a', name: 'A', field_complex: null }], error: null }); await first;
  assert.equal(api.loadAssignmentVenueDirectory(c.supabase, cache, 'user:org:scope:a', 'org', 'a', 120), first);
  const expired = api.loadAssignmentVenueDirectory(c.supabase, cache, 'user:org:scope:a', 'org', 'a', 100 + api.venueDirectoryMaxAgeMs);
  assert.equal(c.calls.length, 2);
  c.pending[1].resolve({ data: [], error: null }); await expired;
});
test('late old-league failure cannot evict a new league request, and switching back never reuses old scope', async () => {
  const c = client(), cache = { current: null };
  const old = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', 'a', 100);
  const current = api.loadAssignmentVenueDirectory(c.supabase, cache, 'b', 'org', 'b', 101);
  c.pending[0].resolve({ data: null, error: { message: 'old failure' } }); await old;
  assert.equal(cache.current.key, 'b');
  c.pending[1].resolve({ data: [], error: null }); await current;
  const back = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', 'a', 102);
  assert.equal(c.calls.length, 3); c.pending[2].resolve({ data: [], error: null }); await back;
});
test('errors and thrown failures are retryable, and schedule invalidation abandons the in-flight slot', async () => {
  const c = client(), cache = { current: null };
  const first = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', '', 100);
  c.pending[0].resolve({ data: null, error: { message: 'offline' } }); await first;
  assert.equal(cache.current, null); assert.equal(c.calls[0].args.p_league_id, null);
  const second = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', '', 101);
  c.pending[1].reject(new Error('network')); assert((await second).error); assert.equal(cache.current, null);
  const stale = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', '', 102);
  cache.current = null; // production load() on schedule edits, archive, Undo, calendar sync
  const fresh = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', '', 103);
  c.pending[2].resolve({ data: [{ location_id: 'old', name: 'Old', field_complex: null }], error: null }); await stale;
  assert.equal(cache.current.promise, fresh);
  c.pending[3].resolve({ data: [], error: null }); await fresh;
});
test('pruning retains shared exact fields/complexes and removes foreign namespaced or missing choices', () => {
  const catalog = api.assignmentVenueDirectory([{ location_id: 'shared', name: 'Shared Field', field_complex: 'North' }]);
  assert.deepEqual(plain(api.validAssignmentVenueSelection(['old', 'shared', 'complex:org:North', 'complex:other:North', 'complex:org:Missing'], 'org', catalog)), ['shared', 'complex:org:North']);
});

test('missing v2 alone falls back to the same scoped legacy directory without guessing parents', async () => {
  const c = client(), cache = { current: null };
  const loading = api.loadAssignmentVenueDirectory(c.supabase, cache, 'org:league', 'org', 'league');
  c.pending[0].resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find public.get_assignment_venue_directory_v2' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.calls[1].name, 'get_assignment_venue_directory');
  assert.deepEqual(c.calls[1].args, { p_organization_id: 'org', p_league_id: 'league' });
  c.pending[1].resolve({ data: [{ location_id: 'field', name: 'Venue - Field 1', field_complex: null }], error: null });
  const result = await loading;
  const catalog = api.assignmentVenueDirectory(result.data);
  assert.equal(catalog.fields[0].venue_id, undefined);
  assert.deepEqual(plain(api.validAssignmentVenueSelection(['venue:saved-parent'], 'org', catalog)), ['venue:saved-parent']);
});

test('permission failure never falls back or caches a directory', async () => {
  const c = client(), cache = { current: null };
  const loading = api.loadAssignmentVenueDirectory(c.supabase, cache, 'a', 'org', 'league');
  c.pending[0].resolve({ data: null, error: { code: '42501', message: 'permission denied for get_assignment_venue_directory_v2' } });
  assert((await loading).error); assert.equal(c.calls.length, 1); assert.equal(cache.current, null);
});

test('parent identity survives renames and unavailable parent choices remain visibly fail-closed', () => {
  const catalog = api.assignmentVenueDirectory([{ location_id: 'f', name: 'Field', field_complex: null, venue_id: 'v', venue_name: 'Renamed' }]);
  assert.equal(catalog.fields[0].venue_id, 'v');
  assert.deepEqual(plain(api.validAssignmentVenueSelection(['venue:v', 'venue:no-access', 'unknown-field'], 'org', catalog)), ['venue:v', 'venue:no-access']);
});
