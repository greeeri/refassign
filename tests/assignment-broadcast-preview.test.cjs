const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const scope = require('./support/load-scope.cjs');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const copy = value => JSON.parse(JSON.stringify(value));
const pagingModule = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync('lib/supabase/readAll.ts', 'utf8')), { module: pagingModule, exports: pagingModule.exports });
const response = (body, options) => ({ body, status: options?.status || 200, headers: options?.headers });
const field = (row, name) => name.split('.').reduce((value, key) => value?.[key], row);
function allowed(row, filter) {
  const restricted = [...filter.matchAll(/and\(league_id\.eq\.([^,]+),location_id\.in\.\(([^)]+)\)\)/g)];
  if (restricted.some(match => row.league_id === match[1] && match[2].split(',').includes(row.location_id))) return true;
  const remaining = filter.replace(/and\(league_id\.eq\.([^,]+),location_id\.in\.\(([^)]+)\)\)/g, '');
  return [...remaining.matchAll(/league_id\.eq\.([^,]+)/g)].some(match => row.league_id === match[1]);
}
function setup({ owner = false, restricted = false, authError = false, fail, personalIds = null, personalError = null } = {}) {
  const calls = [], sent = [], mutations = [];
  const games = [{ id: 'game-a', organization_id: 'org', league_id: 'a', location_id: 'venue', game_number: 'A', sport_id: 'soccer', officials_needed: 1, starts_at: '2026-10-23T18:00:00Z' }, { id: 'game-b', organization_id: 'org', league_id: 'b', location_id: 'venue', sport_id: 'soccer' }];
  const roster = ['eligible-a', 'eligible-b', 'assigned-a', 'assigned-away', 'no-eligibility'].map(id => ({ organization_id: 'org', official_id: id, active: true, officials: { first_name: id, last_name: 'Official', email: `${id}@example.test`, active: true } }));
  const tables = {
    games, organization_officials: roster,
    official_league_eligibility: [{ official_id: 'eligible-a', league_id: 'a' }, { official_id: 'eligible-b', league_id: 'b' }],
    assignments: [{ game_id: 'other-a', official_id: 'assigned-a', games: { organization_id: 'org', league_id: 'a', location_id: 'venue' } }, { game_id: 'other-away', official_id: 'assigned-away', games: { organization_id: 'org', league_id: 'a', location_id: 'away' } }],
    sport_positions: [{ id: 'center', sport_id: 'soccer', sort_order: 1 }],
  };
  const service = { from(name) {
    const call = { name, operations: [] }; calls.push(call);
    const query = { then(resolve, reject) {
      if (fail?.(call)) return Promise.resolve({ data: null, error: { message: 'Read failed' } }).then(resolve, reject);
      let rows = tables[name].slice();
      for (const [method, column, value] of call.operations) {
        if (method === 'eq') rows = rows.filter(row => field(row, column) === value);
        if (method === 'in') rows = rows.filter(row => value.includes(field(row, column)));
        if (method === 'not') rows = rows.filter(row => field(row, column) != null);
        if (method === 'or') rows = rows.filter(row => allowed(value?.referencedTable ? row[value.referencedTable] : row, column));
        if (method === 'range') rows = rows.slice(column, value + 1);
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'in', 'not', 'or', 'order', 'range']) query[method] = (...args) => { call.operations.push([method, ...args]); return query; };
    return query;
  } };
  const context = { service, session: { rpc: async (...args) => { mutations.push(args); return { error: null }; } }, organizationId: 'org', fullOrganizationAccess: owner, leagueIds: ['a'], leagueAccess: [{ league_id: 'a', all_locations: !restricted, location_ids: ['venue'] }] };
  const module = { exports: {} };
  const localRequire = name => name === 'next/server' ? { NextResponse: { json: response } }
    : name.endsWith('/organizationScope') ? { ...scope, requireManagedOrganization: async () => authError ? { error: response({ error: 'Unauthorized' }, { status: 401 }) } : context }
    : name.endsWith('/assignments/personalRoster') ? { readPersonalRosterScope: async () => ({ ids: personalIds, error: personalError }) }
    : name.endsWith('/supabase/readAll') ? pagingModule.exports
    : name.endsWith('/communications/officialCc') ? { sendOfficialNotification: async (_client, id, _url, args) => { sent.push({ id, args }); return { ok: true, json: async () => ({}) }; } }
    : require(name);
  vm.runInNewContext(compile(fs.readFileSync('app/api/assignments/broadcast/route.ts', 'utf8')), { module, exports: module.exports, require: localRequire, URLSearchParams, process: { env: { RESEND_API_KEY: 'test-placeholder-not-a-secret' } } });
  const request = (ids = ['game-a'], body = {}) => ({ nextUrl: { searchParams: new URLSearchParams({ organizationId: 'org', gameIds: ids.join(',') }), origin: 'https://example.test' }, json: async () => ({ gameIds: ids, ...body }) });
  return { calls, sent, mutations, roster, get: ids => module.exports.GET(request(ids)), post: (ids, body) => module.exports.POST(request(ids, body)) };
}
for (const [label, options, expected] of [
  ['owner', { owner: true }, ['assigned-a', 'assigned-away', 'eligible-a', 'eligible-b', 'no-eligibility']],
  ['league-scoped admin/assignor', {}, ['assigned-a', 'assigned-away', 'eligible-a']],
  ['location-scoped admin/assignor', { restricted: true }, ['assigned-a']],
]) test(`${label} preview and send share the exact established recipient calculation`, async () => {
  const t = setup(options);
  const preview = await t.get();
  assert.equal(preview.status, 200); assert.equal(preview.headers['Cache-Control'], 'no-store');
  assert.deepEqual(copy(preview.body.recipients.map(row => row.id).sort()), expected);
  assert.equal(t.sent.length, 0); assert.equal(t.mutations.length, 0, 'GET never opens slots');
  const result = await t.post(['game-a'], { recipientVersion: preview.body.recipientVersion });
  assert.equal(result.status, 200); assert.deepEqual(t.sent.map(row => row.id).sort(), expected);
  assert.equal(t.mutations.length, 1);
});

test('preview rechecks authorization and rejects any selected game outside current scope before roster reads', async () => {
  for (const [options, ids, status] of [[{ authError: true }, ['game-a'], 401], [{}, ['game-a', 'game-b'], 403], [{}, [], 400]]) {
    const t = setup(options); const result = await t.get(ids);
    assert.equal(result.status, status); assert.equal(t.sent.length, 0); assert.equal(t.mutations.length, 0);
    assert(!t.calls.some(call => call.name === 'organization_officials'));
  }
});

test('recipient read errors cannot produce a successful partial preview', async () => {
  const t = setup({ fail: call => call.name === 'official_league_eligibility' });
  const result = await t.get(); assert.equal(result.status, 400); assert(result.body.error);
  assert(!result.body.recipients); assert.equal(t.sent.length, 0); assert.equal(t.mutations.length, 0);
});

test('changed recipient/email rejects stale version before opening slots or sending', async () => {
  const t = setup({ owner: true }); const preview = await t.get();
  t.roster[0].officials.email = 'changed@example.test';
  const result = await t.post(['game-a'], { recipientVersion: preview.body.recipientVersion });
  assert.equal(result.status, 409); assert.equal(t.sent.length, 0); assert.equal(t.mutations.length, 0);
});

test('legacy POST without a preview version keeps its existing send scope', async () => {
  const t = setup({ owner: true }); const result = await t.post();
  assert.equal(result.status, 200); assert.equal(t.sent.length, 5);
});

const component = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const ast = ts.createSourceFile('AssignmentsManagerV2.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) { let result; function visit(node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); } visit(ast); assert(result); return result; }
const effect = find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('Loading broadcast recipients') === false && node.getText(ast).includes('gameIds: [...linkSelected].sort().join'));
const tick = () => new Promise(resolve => setImmediate(resolve));
test('on-demand preview aborts stale reads and never borrows candidate roster as its recipient list', async () => {
  const pending = [], states = [];
  const state = { showBroadcastReview: true, canManage: true, organizationId: 'org', linkSelected: ['game-a'], broadcastPreviewKey: 'a', AbortController, URLSearchParams,
    setBroadcastPreview: value => states.push(value), fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
  };
  const run = () => vm.runInNewContext(compile(`cleanup = (${effect.arguments[0].getText(ast)})();`), state);
  run(); assert.equal(pending.length, 1); state.cleanup(); assert.equal(pending[0].options.signal.aborted, true);
  state.broadcastPreviewKey = 'b'; state.linkSelected = ['game-b']; run();
  pending[1].resolve({ ok: true, json: async () => ({ recipients: [{ id: 'b' }], recipientVersion: 'version-b' }) }); await tick();
  pending[0].resolve({ ok: true, json: async () => ({ recipients: [{ id: 'a' }], recipientVersion: 'version-a' }) }); await tick();
  assert.equal(states.at(-1).key, 'b'); assert.equal(states.filter(Boolean).length, 1);
  assert(component.includes('broadcasting || !canManage || !broadcastPreviewReady ||'));
  assert(component.includes('recipientVersion: currentBroadcastPreview!.recipientVersion'));
});

test('personal roster restricts preview and POST before profile fetch; empty roster opens no slots', async () => {
  const t = setup({personalIds: ['eligible-a', 'eligible-b']});
  const preview = await t.get(); assert.deepEqual(copy(preview.body.recipients.map(row=>row.id)), ['eligible-a']);
  const result = await t.post(['game-a'], {recipientVersion: preview.body.recipientVersion}); assert.equal(result.status, 200); assert.deepEqual(t.sent.map(row=>row.id), ['eligible-a']);
  const empty=setup({personalIds: []}); const emptyPreview=await empty.get(); assert.equal(emptyPreview.body.recipients.length,0); const rejected=await empty.post(); assert.equal(rejected.status,400);assert.equal(empty.mutations.length,0);assert.equal(empty.sent.length,0);
  const failed=setup({personalError:{message:'Could not verify roster'}});assert.equal((await failed.get()).status,400);assert.equal((await failed.post()).status,400);assert.equal(failed.sent.length,0);assert.equal(failed.mutations.length,0);
});
