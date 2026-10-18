const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const today = new Date().toISOString().slice(0, 10);

function setup({ user = { id: 'mentor' }, memberships = [{ role: 'mentor' }], subscription = { status: 'active' }, leagues = [{ league_id: 'allowed-league' }], games = [{ id: 'allowed-game' }], errors = {}, rpcError = null } = {}) {
  const calls = [];
  const responses = {
    organization_memberships: { data: memberships },
    refassign_subscriptions: { data: subscription },
    organization_member_league_access: { data: leagues },
    games: { data: games },
  };
  const service = { from: table => {
    const call = { table, filters: [] };
    calls.push(call);
    const q = { then: (resolve, reject) => {
      const result = { ...responses[table], error: errors[table] || null };
      const range = call.filters.find(f => f[0] === 'range');
      if (table === 'games' && range) result.data = games.slice(range[1], range[2] + 1);
      return Promise.resolve(result).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'maybeSingle', 'in', 'gte', 'range'])
      q[method] = (...args) => { call.filters.push([method, ...args]); return q; };
    return q;
  } };
  const session = {
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { error: rpcError }; },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'next/server'
    ? { NextResponse: { json: (body, opts) => ({ body, status: opts?.status || 200, headers: opts?.headers }) } }
    : name.endsWith('/supabase/server') ? { createServerSupabaseClient: async () => session }
    : name.endsWith('/supabase/admin') ? { createServiceClient: () => service } : require(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assignments/read-only/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: mockRequire, Date, Number, Promise });
  return {
    calls,
    run: (query = 'organizationId=selected-org') => module.exports.GET({ nextUrl: new URL('https://ref-assign.com/api/assignments/read-only?' + query) }),
    post: body => module.exports.POST({ json: async () => body }),
  };
}

test('rejects anonymous, unauthorized roles, and inactive subscription before reading games', async () => {
  for (const [options, status] of [
    [{ user: null }, 401], [{ memberships: [] }, 403],
    [{ memberships: [{ role: 'viewer', viewer_permissions: ['games'] }] }, 403],
    [{ memberships: [{ role: 'official' }] }, 403], [{ subscription: null }, 402],
    [{ subscription: { status: 'past_due' } }, 402],
  ]) {
    const t = setup(options);
    assert.equal((await t.run()).status, status);
    assert(!t.calls.some(c => c.table === 'games'));
  }
});

test('multiple roles retain mentor access; assignment viewers remain read-only', async () => {
  for (const [memberships, isMentor] of [
    [[{ role: 'official' }, { role: 'mentor' }], true],
    [[{ role: 'viewer', viewer_permissions: ['assignments'] }], false],
    [[{ role: 'viewer', viewer_permissions: [] }, { role: 'mentor' }], true],
  ]) {
    const result = await setup({ memberships }).run();
    assert.equal(result.status, 200);
    assert.equal(result.body.isMentor, isMentor);
  }
  assert.equal((await setup({ subscription: { status: 'inactive', access_override: true } }).run()).status, 200);
});

test('reads only granted organization and leagues with safe fields and stable ordering', async () => {
  const t = setup();
  const result = await t.run();
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  const q = t.calls.find(c => c.table === 'games');
  assert(q.filters.some(f => f[0] === 'eq' && f[1] === 'organization_id' && f[2] === 'selected-org'));
  assert(q.filters.some(f => f[0] === 'is' && f[1] === 'archived_at' && f[2] === null));
  assert.deepEqual(q.filters.find(f => f[0] === 'in')[2], ['allowed-league']);
  assert.deepEqual(q.filters.filter(f => f[0] === 'order').map(f => f[1]), ['starts_at', 'id']);
  assert.deepEqual(q.filters.find(f => f[0] === 'range'), ['range', 0, 499]);
  const projection = q.filters.find(f => f[0] === 'select')[1];
  for (const secret of ['response_token', 'email', 'phone', 'rank', 'pay_rate']) assert(!projection.includes(secret));
  const membership = t.calls.find(c => c.table === 'organization_memberships');
  assert(membership.filters.some(f => f[1] === 'user_id' && f[2] === 'mentor'));
  assert(membership.filters.some(f => f[1] === 'organization_id' && f[2] === 'selected-org'));
});

test('empty league grants skip games; dates and offsets are validated', async () => {
  const t = setup({ leagues: [] });
  const result = await t.run();
  assert.equal(result.body.games.length, 0);
  assert.equal(result.body.hasMore, false);
  assert(!t.calls.some(c => c.table === 'games'));
  assert.equal((await setup().run('')).status, 400);
  for (const query of ['from=invalid', 'from=2000-01-01', 'from=2026-02-30', 'offset=-1', 'offset=1.5', 'offset=Infinity', 'offset=9007199254740991'])
    assert.equal((await setup().run('organizationId=o&' + query)).status, 400, query);
});

test('paged schedule includes more than 5,000 games with an exact-boundary final page', async () => {
  const games = Array.from({ length: 5500 }, (_, id) => ({ id: String(id) }));
  const t = setup({ games });
  const ids = [];
  let offset = 0;
  for (;;) {
    const result = await t.run(`organizationId=selected-org&from=${today}&offset=${offset}`);
    assert.equal(result.status, 200);
    assert(result.body.games.length <= 500);
    assert.equal(result.body.from, today);
    ids.push(...result.body.games.map(g => g.id));
    if (!result.body.hasMore) { assert.equal(result.body.nextOffset, null); break; }
    offset = result.body.nextOffset;
  }
  assert.deepEqual(ids, games.map(g => g.id));
  assert.equal(t.calls.filter(c => c.table === 'games').length, 12);
});

test('database errors fail closed instead of returning incomplete schedules', async () => {
  for (const table of ['organization_memberships', 'refassign_subscriptions', 'organization_member_league_access', 'games']) {
    const result = await setup({ errors: { [table]: { message: 'failed' } } }).run();
    assert.equal(result.status, table === 'organization_memberships' ? 403 : 500);
    assert.equal(result.body.games, undefined);
  }
});

test('self-assignment uses the authenticated RPC, forwarding permission and validation failures', async () => {
  const anonymous = setup({ user: null });
  assert.equal((await anonymous.post({ gameId: 'game' })).status, 401);
  assert(!anonymous.calls.some(c => c.rpc));
  const missing = setup();
  assert.equal((await missing.post({})).status, 400);
  assert(!missing.calls.some(c => c.rpc));
  for (const [rpcError, status] of [[null, 200], [{ code: '42501', message: 'Mentor access is required.' }, 403], [{ message: 'This game already has a mentor assigned.' }, 400]]) {
    const t = setup({ rpcError });
    assert.equal((await t.post({ gameId: 'selected-game' })).status, status);
    const call = t.calls.find(c => c.rpc);
    assert.equal(call.rpc, 'self_assign_game_mentor');
    assert.equal(call.args.p_game_id, 'selected-game');
    assert(!t.calls.some(c => c.table)); // Never bypass SQL authorization via the service client.
  }
});
