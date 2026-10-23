const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { applyScopeFilter } = require('./support/scope-query.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function moduleFrom(file, require) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require });
  return module.exports;
}
const json = (body, options) => ({ body: copy(body), status: options?.status || 200 });
const paging = moduleFrom('lib/supabase/readAll.ts', require);
const scope = moduleFrom('lib/server/organizationScope.ts', name => name === 'next/server' ? { NextResponse: { json } } : name.endsWith('/readAll') ? paging : {});
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
function setup({ owner = false, empty = false } = {}) {
  const reads = [];
  const games = Array.from({ length: 120 }, (_, i) => ({ id: id(i), organization_id: 'org', league_id: 'a', location_id: 'north' }));
  games.push({ id: id(500), organization_id: 'other', league_id: 'a', location_id: 'north' }, { id: id(501), organization_id: 'org', league_id: 'b', location_id: 'north' }, { id: id(502), organization_id: 'org', league_id: 'a', location_id: 'south' });
  const tables = { games, sport_positions: [], game_position_pay: games.map(game => ({ game_id: game.id, position_id: 'ref', amount: 50 })) };
  const service = { from(table) {
    const call = { table, methods: [] }; reads.push(call);
    const query = { then(resolve, reject) {
      let rows = [...tables[table]];
      for (const [method, key, value] of call.methods) {
        if (method === 'eq') rows = rows.filter(row => row[key] === value);
        if (method === 'in') rows = rows.filter(row => value.includes(row[key]));
        if (method === 'or') rows = rows.filter(row => applyScopeFilter(row, key, value));
        if (method === 'range') rows = rows.slice(key, value + 1);
      }
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'in', 'or', 'order', 'range']) query[method] = (...args) => { call.methods.push([method, ...copy(args)]); return query; };
    return query;
  } };
  const context = { service, organizationId: 'org', fullOrganizationAccess: owner, leagueIds: owner ? null : empty ? [] : ['a'], leagueAccess: empty ? [] : [{ league_id: 'a', all_locations: false, location_ids: ['north'] }] };
  const route = moduleFrom('app/api/games/pay/route.ts', name => name === 'next/server' ? { NextResponse: { json } } : name.endsWith('/organizationScope') ? { ...scope, requireManagedOrganization: async () => context } : paging);
  return { reads, run: search => route.GET({ nextUrl: new URL(`https://test/pay?organizationId=org${search ? `&${search}` : ''}`) }) };
}
test('page pay intersects explicit IDs with organization, league and location authority before pagination', async () => {
  const f = setup();
  const response = await f.run(`gameIds=${[id(1), id(500), id(501), id(502)].join(',')}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.rates.map(row => row.game_id), [id(1)]);
  const games = f.reads.find(read => read.table === 'games');
  const page = games.methods.findIndex(([method]) => method === 'range');
  for (const method of ['eq', 'or', 'in']) assert(games.methods.findIndex(([name]) => name === method) < page);
  assert.deepEqual(f.reads.find(read => read.table === 'game_position_pay').methods.find(([method]) => method === 'in')[2], [id(1)]);
});
test('page pay accepts 50 IDs and rejects empty, malformed or 51-ID requests before data reads', async () => {
  const f = setup();
  const response = await f.run(`gameIds=${Array.from({length:50}, (_, i) => id(i)).join(',')}`);
  assert.equal(response.body.rates.length, 50);
  for (const value of ['', 'not-a-uuid', `${id(1)},`, Array.from({length:51}, (_, i) => id(i)).join(',')]) {
    const invalid = setup();
    assert.equal((await invalid.run(`gameIds=${value}`)).status, 400);
    assert.equal(invalid.reads.length, 0);
  }
});
test('other pay callers retain existing behavior and empty grants never read game pay', async () => {
  const all = setup({ owner: true });
  assert.equal((await all.run('')).body.rates.length, 122);
  const empty = setup({ empty: true });
  assert.deepEqual((await empty.run(`gameIds=${id(1)}`)).body.rates, []);
  assert.equal(empty.reads.length, 0);
});
test('Assignment Center pay requests carry current page IDs rather than all organization games', () => {
  const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
  assert.match(source, /const pagePayGameIds = games\.map/);
  assert.match(source, /gameIds=\$\{encodeURIComponent\(pagePayGameIds\)\}/);
  assert.match(source, /\[selected, organizationId, pagePayGameIds\]/);
});
