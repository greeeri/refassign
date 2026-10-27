const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const copy = value => JSON.parse(JSON.stringify(value));
function moduleFrom(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), { module, exports: module.exports, require: name => dependencies[name] || require(name) });
  return module.exports;
}
const paging = moduleFrom('lib/supabase/readAll.ts');
const candidateRoster = moduleFrom('lib/assignments/candidateRoster.ts', { '../supabase/readAll': paging, './personalRoster': { readPersonalRosterScope: async () => ({ids: null, error: null}) } });
const scope = moduleFrom('components/leagueGameScope.ts');
function parse(path) {
  const text = fs.readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(predicate) {
    let found;
    function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
    visit(ast); assert(found, `Missing production node in ${path}`); return found;
  }
  return { text, ast, find };
}
function matchesScopeFilter(row, filter) {
  const restricted = [];
  const remaining = filter.replace(/and\(league_id\.eq\.("(?:[^"\\]|\\.)*"),location_id\.in\.\((.*?)\)\)/g, (_, league, locations) => {
    restricted.push({ league: JSON.parse(league), locations: JSON.parse(`[${locations}]`) }); return '';
  });
  const all = [...remaining.matchAll(/league_id\.eq\.("(?:[^"\\]|\\.)*")/g)].map(match => JSON.parse(match[1]));
  return all.includes(row.league_id) || restricted.some(grant => grant.league === row.league_id && grant.locations.includes(row.location_id));
}
function environment(source, changes = {}) {
  const calls = [], state = {};
  const tables = changes.tables || {};
  const context = {
    ...paging, ...scope, ...candidateRoster, organizationId: 'org', accessibleLeagueIds: ['league-a'], scopedLeagueIds: ['league-a'],
    leagueGameAccess: [{ league_id: 'league-a', all_locations: true, location_ids: [] }],
    fullLeagueAccess: false, leagueFilter: 'all', showArchived: false,
    gameLoadVersion: { current: 0 }, performance: { now: () => 0 }, console: { info() {} },
    ...changes.state,
  };
  for (const name of new Set(source.match(/\bset[A-Z]\w+/g))) {
    const key = name.slice(3, 4).toLowerCase() + name.slice(4);
    context[name] = value => { state[key] = typeof value === 'function' ? value(state[key]) : copy(value); };
  }
  function query(kind, name, parameters) {
    const call = { kind, name, parameters: copy(parameters || {}), operations: [] };
    calls.push(call);
    const builder = {
      async then(resolve, reject) {
        if (changes.waitFor) await changes.waitFor(call);
        if (changes.fail?.(call)) return Promise.resolve({ data: null, error: { message: 'Access changed' } }).then(resolve, reject);
        if (kind === 'rpc' && name === 'get_game_directory') return Promise.resolve({ data: {
          teams: [{ id: `${parameters.p_league_id}-team` }], levels: [{ id: `${parameters.p_league_id}-level` }],
          team_settings: [{ league_id: parameters.p_league_id, team_ids: [] }], level_settings: [],
        }, error: null }).then(resolve, reject);
        let rows = (tables[name] || []).slice();
        const ordering = call.operations.filter(([method]) => method === 'order');
        rows.sort((a, b) => { for (const [, column, options] of ordering) { const direction = options?.ascending === false ? -1 : 1; if (a[column] < b[column]) return -direction; if (a[column] > b[column]) return direction; } return 0; });
        for (const [method, column, value] of call.operations) {
          if (method === 'eq') rows = rows.filter(row => row[column] === value);
          if (method === 'in') rows = rows.filter(row => value.includes(row[column]));
          if (method === 'is') rows = rows.filter(row => row[column] === value);
          if (method === 'not') rows = rows.filter(row => row[column] !== null);
          if (method === 'gte') rows = rows.filter(row => row[column] >= value);
          if (method === 'or') rows = rows.filter(row => matchesScopeFilter(row, column));
          if (method === 'range') rows = rows.slice(column, value + 1);
          if (method === 'limit') rows = rows.slice(0, column);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    for (const method of ['select', 'eq', 'in', 'is', 'not', 'gte', 'or', 'order', 'range', 'limit']) {
      builder[method] = (...args) => { call.operations.push([method, ...copy(args)]); return builder; };
    }
    return builder;
  }
  context.sb = context.supabase = { from: table => query('from', table), rpc: (name, parameters) => query('rpc', name, parameters) };
  context.fetch = async url => { calls.push({ kind: 'fetch', name: url, operations: [] }); return { ok: true, json: async () => ({}) }; };
  return { context, calls, state, run: expression => vm.runInNewContext(compile(expression), context) };
}
const operation = (call, name, column) => call.operations.find(([method, key]) => method === name && (column === undefined || key === column));
const gamesModule = parse('components/GamesManagerV3.tsx');
const gamesLoad = gamesModule.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load').getText(gamesModule.ast);
const games = Array.from({ length: 1005 }, (_, i) => ({ id: `a-${i}`, organization_id: 'org', league_id: 'league-a', starts_at: '2099-01-01', archived_at: null }));
games.push({ id: 'forbidden', organization_id: 'org', league_id: 'league-b', starts_at: '2099-01-01', archived_at: null });
games.push({ id: 'other-org', organization_id: 'other', league_id: 'league-a', starts_at: '2099-01-01', archived_at: null });

test('Games preview and all history are league-filtered before pagination; metadata is selected-league only', async () => {
  const env = environment(gamesLoad, { tables: { games, leagues: [{ id: 'league-a', active: true }, { id: 'league-b', active: true }] } });
  await env.run(`${gamesLoad}\nload()`);
  assert.equal(env.state.games.length, 1005);
  assert.deepEqual(env.state.leagues.map(row => row.id), ['league-a']);
  const reads = env.calls.filter(call => call.name === 'games');
  assert.deepEqual(reads.map(call => operation(call, 'range').slice(1)), [[0, 49], [0, 999], [1000, 1999]]);
  for (const read of reads) {
    assert.deepEqual(operation(read, 'in', 'league_id'), ['in', 'league_id', ['league-a']]);
    assert(read.operations.findIndex(([op]) => op === 'in') < read.operations.findIndex(([op]) => op === 'range'));
  }
  assert(!env.calls.some(call => call.name === 'get_organization_locations'));
});

test('owner and protected-superadmin full scope preserves all organization games without member grant lookup', async () => {
  for (const role of ['owner', 'protected-superadmin']) {
    const env = environment(gamesLoad, { state: { fullLeagueAccess: true, scopedLeagueIds: null }, tables: { games } });
    await env.run(`${gamesLoad}\nload()`);
    assert.equal(env.state.games.length, 1006, role);
    assert(!env.calls.filter(call => call.name === 'games').some(call => operation(call, 'in', 'league_id')), role);
    assert(env.calls.some(call => call.name === 'get_organization_locations'), role);
  }
});

test('Games empty or unknown league scope performs no data requests and clears previous schedule metadata', async () => {
  const env = environment(gamesLoad, { state: { accessibleLeagueIds: [], scopedLeagueIds: [], leagueGameAccess: [] }, tables: { games } });
  await env.run(`${gamesLoad}\nload()`);
  assert.equal(env.calls.length, 0);
  assert.deepEqual(env.state.games, []); assert.deepEqual(env.state.leagues, []); assert.deepEqual(env.state.payRates, {});
  assert.equal(env.state.gamesLoading, false);
});

const directoryEffect = gamesModule.find(node => ts.isCallExpression(node) && node.expression.getText(gamesModule.ast) === 'useEffect' && node.arguments[0]?.getText(gamesModule.ast).includes('get_game_directory')).arguments[0].getText(gamesModule.ast);
test('scoped directory requests each permitted league, never the null organization-wide fallback', async () => {
  const env = environment(directoryEffect, { state: { scopedLeagueIds: ['league-a', 'league-c'], directoryLeagueId: null } });
  env.run(`(${directoryEffect})()`);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.calls.map(call => call.parameters.p_league_id), ['league-a', 'league-c']);
  assert.deepEqual(env.state.teams.map(row => row.id), ['league-a-team', 'league-c-team']);
  for (const directoryLeagueId of ['forbidden', null]) {
    const empty = environment(directoryEffect, { state: { scopedLeagueIds: directoryLeagueId ? ['league-a'] : [], directoryLeagueId } });
    empty.run(`(${directoryEffect})()`);
    assert.equal(empty.calls.length, 0);
  }
});

const dashboard = parse('components/DashboardGames.tsx');
const dashboardEffect = dashboard.find(node => ts.isCallExpression(node) && node.expression.getText(dashboard.ast) === 'useEffect').arguments[0].getText(dashboard.ast);
async function dashboardRun(changes = {}) {
  const env = environment(dashboardEffect, changes);
  // Await the actual effect's load; no query or condition is copied into the test.
  await env.run(`(${dashboardEffect.replace('void load();', 'return load();')})()`);
  return env;
}
test('Dashboard bounds games first and then assignments, declines and audit to those IDs', async () => {
  const selected = games.slice(0, 1005);
  const env = await dashboardRun({ tables: {
    games, assignments: [...selected.map(game => ({ id: `assignment-${game.id}`, game_id: game.id })), { id: 'secret', game_id: 'forbidden' }],
    assignment_declines: [{ id: 'decline', game_id: 'a-0' }, { id: 'secret', game_id: 'forbidden' }],
    audit_history: [{ id: 1, game_id: 'a-0', organization_id: 'org', occurred_at: '2026-01-01' }, { id: 2, game_id: 'forbidden', organization_id: 'org', occurred_at: '2026-01-02' }],
  } });
  assert.equal(env.state.games.length, 1005); assert.equal(env.state.assignments.length, 1005);
  assert.deepEqual(env.state.declineRows.map(row => row.id), ['decline']); assert.deepEqual(env.state.audit.map(row => row.id), [1]);
  assert(!env.calls.some(call => call.name === 'import_error_log'));
  for (const call of env.calls.filter(call => ['assignments', 'assignment_declines', 'audit_history'].includes(call.name))) {
    assert(operation(call, 'in', 'game_id'));
    assert(call.operations.findIndex(([op]) => op === 'in') < call.operations.findIndex(([op]) => op === (call.name === 'audit_history' ? 'limit' : 'range')));
  }
  const baseReads = env.calls.filter(call => call.name === 'games' && operation(call, 'gte'));
  assert.equal(baseReads.length, 3);
  assert(env.calls.findIndex(call => call.name === 'assignments') > env.calls.indexOf(baseReads.at(-1)));
  for (const call of env.calls.filter(call => call.name === 'audit_history')) assert.equal(operation(call, 'limit')[1], 8);
});
test('Dashboard unknown/empty scope makes no reads; owner still gets organization overview', async () => {
  const empty = await dashboardRun({ state: { accessibleLeagueIds: [], leagueGameAccess: [] } });
  assert.equal(empty.calls.length, 0); assert.equal(empty.state.loading, false);
  const owner = await dashboardRun({ state: { fullLeagueAccess: true }, tables: { games } });
  assert.equal(owner.state.games.length, 1006);
  assert(owner.calls.some(call => call.name === 'import_error_log'));
});
test('Dashboard failed later page never publishes a partial schedule or stale rows', async () => {
  const env = await dashboardRun({ tables: { games }, fail: call => call.name === 'games' && operation(call, 'range')?.[1] === 1000 });
  assert.deepEqual(env.state.games, []); assert.deepEqual(env.state.assignments, []);
  assert.equal(env.state.error, 'Access changed'); assert.equal(env.state.loading, false);
});

const assignments = parse('components/AssignmentsManagerV2.tsx');
const assignmentLoad = assignments.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadPage');
const declared = name => assignmentLoad.body.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(assignments.ast) === name)).getText(assignments.ast);
const candidateSource = [declared('loadAllLeagueEligibility'), declared('loadAllLevelEligibility'), declared('fetchCandidateData')].join('\n');
test('assignment candidate rankings, eligibility and availability are bounded to returned scoped roster IDs', async () => {
  const roster = Array.from({ length: 1005 }, (_, i) => ({ official_id: `official-${i}`, organization_id: 'org', active: true, 'officials.active': true, 'officials.official_league_eligibility.league_id': 'league-a', officials: { id: `official-${i}`, first_name: 'Ref', last_name: String(i) } }));
  const env = environment(candidateSource, { state: { scopedGames: [{ league_id: 'league-a' }], scopedAssignments: [], candidateLeagueIds: ['league-a'], candidateLevelIds: ['level-a'], candidateTeamIds: [] }, tables: {
    organization_officials: roster,
    my_assignment_rankings: [{ official_id: 'official-0', rank: 10 }, { official_id: 'foreign-official', rank: 99 }],
    official_availability_blocks: [{ official_id: 'official-0' }, { official_id: 'foreign-official' }],
  } });
  const result = await env.run(`${candidateSource}\nfetchCandidateData()`);
  assert.equal(result.officialRows.length, 1005);
  assert.equal(result.results[1].data.length, 1); assert.equal(result.results[4].data.length, 1);
  for (const call of env.calls.filter(call => ['my_assignment_rankings', 'official_availability_blocks', 'official_league_eligibility', 'official_level_eligibility'].includes(call.name))) {
    assert(operation(call, 'in', 'official_id'));
    assert(call.operations.findIndex(([op]) => op === 'in') < call.operations.findIndex(([op]) => op === 'range'));
  }
  assert(assignments.text.includes('"get_assignment_candidate_conflicts"'), 'safe cross-league conflict RPC retained');
});

test('workspace full-access formula is owner/protected-only and remounts scoped views on permission changes', () => {
  const workspace = parse('app/workspace/page.tsx');
  const declaration = workspace.find(node => ts.isVariableDeclaration(node) && node.name.getText(workspace.ast) === 'fullOrganizationAccess');
  const formula = compile(`result = ${declaration.initializer.getText(workspace.ast)}`);
  for (const role of ['admin', 'assignor', 'billing', 'viewer']) {
    const state = { isSuperAdmin: false, testWorkspace: { role, roles: [role] } };
    vm.runInNewContext(formula, state); assert.equal(state.result, false, role);
  }
  for (const state of [{ isSuperAdmin: false, testWorkspace: { role: 'owner' } }, { isSuperAdmin: true, testWorkspace: { role: 'admin' } }, { isSuperAdmin: false, testWorkspace: { full_organization_access: true } }]) {
    vm.runInNewContext(formula, state); assert.equal(state.result, true);
  }
  assert.match(workspace.text, /manager && fullOrganizationAccess && testWorkspace && section === "Team & Roles"/);
  assert.match(workspace.text, /<AssignmentsManager\s+key=\{`AssignmentsManager:\$\{workspaceScopeKey\}`\}/);
  assert.match(workspace.text, /<GamesManager key=\{`GamesManager:\$\{workspaceScopeKey\}`\}/);
  assert.match(workspace.text, /<DashboardGames\s+key=\{`DashboardGames:\$\{workspaceScopeKey\}`\}/);
});

test('superseded directory and dashboard effects cannot repopulate cleared state', async () => {
  const directory = environment(directoryEffect, { state: { scopedLeagueIds: ['league-a'], directoryLeagueId: null } });
  const cancelDirectory = directory.run(`(${directoryEffect})()`);
  cancelDirectory();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(directory.state.teams, []);
  assert.deepEqual(directory.state.levels, []);
  const summary = environment(dashboardEffect, { tables: { games } });
  const cancelSummary = summary.run(`(${dashboardEffect})()`);
  cancelSummary();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(summary.state.games, []);
  assert.deepEqual(summary.state.assignments, []);
  assert(!summary.calls.some(call => call.name === 'assignments'));
});

test('per-league location grants are independent and filter Games and Dashboard before pagination', async () => {
  const grants = [
    { league_id: 'league-a', all_locations: false, location_ids: ['north'] },
    { league_id: 'league-b', all_locations: true, location_ids: [] },
    { league_id: 'league-c', all_locations: false, location_ids: [] },
  ];
  const rows = [
    { id: 'a-north', league_id: 'league-a', location_id: 'north' },
    { id: 'a-south', league_id: 'league-a', location_id: 'south' },
    { id: 'a-null', league_id: 'league-a', location_id: null },
    { id: 'b-south', league_id: 'league-b', location_id: 'south' },
    { id: 'b-null', league_id: 'league-b', location_id: null },
    { id: 'c-north', league_id: 'league-c', location_id: 'north' },
  ].map(row => ({ ...row, organization_id: 'org', archived_at: null, starts_at: '2099-01-01' }));
  for (const dashboard of [false, true]) {
    const options = { state: { leagueGameAccess: grants, scopedLeagueIds: grants.map(grant => grant.league_id), accessibleLeagueIds: grants.map(grant => grant.league_id) }, tables: { games: rows } };
    const env = dashboard ? await dashboardRun(options) : environment(gamesLoad, options);
    if (!dashboard) await env.run(`${gamesLoad}\nload()`);
    assert.deepEqual(env.state.games.map(row => row.id).sort(), ['a-north', 'b-null', 'b-south']);
    for (const call of env.calls.filter(call => call.name === 'games')) {
      assert(operation(call, 'or'));
      assert(call.operations.findIndex(([op]) => op === 'or') < call.operations.findIndex(([op]) => op === 'range'));
    }
  }
});

test('unchecked All with no locations, missing scope metadata and null restricted venues fail closed', () => {
  for (const grant of [{ league_id: 'a', all_locations: false, location_ids: [] }, { league_id: 'a' }]) {
    const env = environment('');
    assert.equal(scope.applyLeagueGameAccess(env.context.sb.from('games'), [grant], false), null);
  }
  const env = environment('');
  const query = env.context.sb.from('games');
  assert.equal(scope.applyLeagueGameAccess(query, [], true), query, 'owner full access preserved');
  assert.equal(scope.leagueGameAccessKey([{ league_id: 'a', all_locations: false, location_ids: ['y', 'x', 'x'] }]), scope.leagueGameAccessKey([{ league_id: 'a', all_locations: false, location_ids: ['x', 'y'] }]));
  assert.notEqual(scope.leagueGameAccessKey([{ league_id: 'a', all_locations: false, location_ids: ['x'] }]), scope.leagueGameAccessKey([{ league_id: 'a', all_locations: false, location_ids: ['y'] }]));
});

test('manual game creation, import and quick-edit venue checks use the matching league grant', () => {
  const grants = [
    { league_id: 'a', all_locations: false, location_ids: ['north'] },
    { league_id: 'b', all_locations: false, location_ids: ['south'] },
    { league_id: 'all', all_locations: true, location_ids: [] },
  ];
  assert.equal(scope.canAccessLeagueGameLocation(grants, 'a', 'north'), true);
  assert.equal(scope.canAccessLeagueGameLocation(grants, 'a', 'south'), false);
  assert.equal(scope.canAccessLeagueGameLocation(grants, 'b', 'north'), false);
  assert.equal(scope.canAccessLeagueGameLocation(grants, 'a', null), false);
  assert.equal(scope.canAccessLeagueGameLocation(grants, 'all', null), true);
  assert.equal(scope.canAccessLeagueGameLocation([], null, null, true), true);
  for (const name of ['save', 'validate', 'importPayload']) {
    const node = gamesModule.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert(node.getText(gamesModule.ast).includes('canAccessLeagueGameLocation'), name);
  }
  assert.match(gamesModule.text, /fullLeagueAccess \? await sb\.rpc\(\s*"prepare_game_import_locations"/);
  assert(assignments.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveQuickEdit').getText(assignments.ast).includes('canAccessLeagueGameLocation'));
});

test('shared AutoAssign rules are owner-only while publication is scoped by league and venue', async () => {
  const auto = parse('components/AutoAssignManager.tsx');
  for (const name of ['save', 'remove']) {
    const source = auto.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(auto.ast);
    const env = environment(source, { state: { current: () => true, fullOrganizationAccess: false } });
    await env.run(`${source}\n${name}('rule')`);
    assert.equal(env.calls.length, 0, name);
  }
  const publish = auto.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'publishAll').getText(auto.ast);
  assert(publish.includes('applyLeagueGameAccess(query, leagueGameAccess, fullOrganizationAccess)'));
  assert(auto.text.includes('Only organization owners can change organization-wide AutoAssign rules.'));
});

test('Undo UI, snapshot reads and announcements are owner-only', () => {
  const workspace = fs.readFileSync('app/workspace/page.tsx', 'utf8');
  assert.match(workspace, /manager && fullOrganizationAccess && \(\s*<UndoCenter/);
  const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
  assert.equal((source.match(/fullLeagueAccess \? await supabase\.rpc\(\s*"latest_undo_operation"/g) || []).length, 2);
  assert.match(source, /if \(fullLeagueAccess && succeeded && \(action === "status" \|\| action === "unassign"\)\)/);
  assert.match(source, /if \(fullLeagueAccess\) announceUndoAvailable\(description\)/);
});

test('shared contacts and geocoding are owner-only; sport catalog is protected-superadmin-only', () => {
  const workspace = fs.readFileSync('app/workspace/page.tsx', 'utf8');
  assert.match(workspace, /fullOrganizationAccess && <button\s*className=\{`topNavButton \$\{section === "Contacts"/);
  assert.match(workspace, /manager && fullOrganizationAccess && section === "Contacts"/);
  assert.match(workspace, /canGeocode=\{manager && fullOrganizationAccess\}/);
  assert.match(workspace, /manager && fullOrganizationAccess && \(\s*<MileageCoordinatesManager/);
  assert.match(workspace, /isSuperAdmin && <button\s*className=\{`topNavButton \$\{section === "Sports & Rules"/);
  assert.match(workspace, /manager && isSuperAdmin && section === "Sports & Rules"/);
  assert.match(workspace, /<AvailabilityCalendar\s*key=\{`AvailabilityCalendar:\$\{workspaceScopeKey\}`\}\s*managerView\s*fullOrganizationAccess=\{fullOrganizationAccess\}/);
  assert.match(workspace, /<BlockRemovalRequests\s*key=\{`BlockRemovalRequests:\$\{workspaceScopeKey\}`\}\s*fullOrganizationAccess=\{fullOrganizationAccess\}/);
});

test('scoped payroll can read bill-to options but cannot mutate shared billing accounts', async () => {
  const payroll = parse('components/PayrollManager.tsx');
  assert.match(payroll.text, /setCanManageBillTos\(canEditSharedBilling\(\) && Boolean\(billToResult.canManageBillTos\)\)/);
  assert.match(payroll.text, /fullOrganizationAccess && canManageBillTos &&/);
  for (const name of ['addBillTo', 'saveBillToEmail']) {
    const source = payroll.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(payroll.ast);
    const env = environment(source, { state: { canEditSharedBilling: () => false } });
    await env.run(`${source}\n${name}()`);
    assert.equal(env.calls.length, 0, name);
  }
});

test('scoped overdue review cannot create shared availability blocks', async () => {
  const source = assignments.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'resolveOverdue').getText(assignments.ast);
  for (const fullLeagueAccess of [false, true]) {
    const env = environment(source, { state: { fullLeagueAccess, fullLeagueAccessRef: { current: false } } });
    await env.run(`${source}\nresolveOverdue('remove_and_block')`);
    assert.equal(env.calls.length, 0);
  }
  assert.match(assignments.text, /fullLeagueAccess && <button[\s\S]{0,250}resolveOverdue\("remove_and_block"\)/);
});


test('Dashboard reads whole local today and future scalars, not historical joins', async () => {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-27T18:00:00Z'])); } static now() { return Date.parse('2026-10-27T18:00:00Z'); } }
  const midnight = new FixedDate(); midnight.setHours(0, 0, 0, 0);
  const row = (id, starts_at) => ({ id, starts_at, organization_id: 'org', league_id: 'league-a', archived_at: null,
    home_team_id: 'team', away_team_id: 'team', location_id: 'field', level_id: 'level' });
  const env = await dashboardRun({ state: { Date: FixedDate }, tables: {
    games: [row('past', new Date(+midnight - 1).toISOString()), row('today', midnight.toISOString()), row('future', '2099-01-01')],
    teams: [{ id: 'team', name: 'Scoped team' }], locations: [{ id: 'field', name: 'Field', latitude: 42, longitude: -93 }],
    leagues: [{ id: 'league-a', name: 'League' }], levels: [{ id: 'level', name: 'Level' }],
    assignments: [{ id: 'a', game_id: 'today' }, { id: 'past-a', game_id: 'past' }],
    audit_history: [{ id: 99, game_id: 'past', organization_id: 'org', occurred_at: '2026-10-27T17:00:00Z' }],
  } });
  assert.deepEqual(env.state.games.map(g => g.id), ['today', 'future']);
  assert.equal(env.state.games[0].home.name, 'Scoped team'); assert.equal(env.state.games[0].location.latitude, 42);
  assert.deepEqual(env.state.assignments.map(a => a.id), ['a']);
  assert.deepEqual(env.state.audit.map(a => a.id), [99], 'historical activity remains visible independently');
  for (const call of env.calls.filter(c => ['games', 'assignments'].includes(c.name))) assert(!operation(call, 'select')[1].includes('('), 'no per-game resource hydration');
  for (const table of ['teams', 'locations', 'leagues', 'levels']) {
    const reads = env.calls.filter(c => c.name === table); assert.equal(reads.length, 1);
    assert.equal(operation(reads[0], 'in', 'id')[2].length, 1, 'deduplicated resources');
    assert.deepEqual(operation(reads[0], 'range').slice(1), [0, 200]);
  }
});

test('Dashboard ancillary failure does not discard successful games', async () => {
  for (const table of ['audit_history', 'organization_officials', 'import_error_log']) {
    const env = await dashboardRun({ state: { fullLeagueAccess: true }, tables: { games: games.slice(0, 1) }, fail: call => call.name === table });
    assert.equal(env.state.games.length, 1, table); assert.equal(env.state.loading, false);
    assert.equal(env.state.error, ''); assert.match(env.state.overviewError, /could not load/);
  }
});

test('Dashboard games publish before deferred ancillary activity finishes', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const env = environment(dashboardEffect, { state: { fullLeagueAccess: true }, tables: { games: games.slice(0, 1) }, waitFor: call => call.name === 'audit_history' ? gate : undefined });
  const cancel = env.run(`(${dashboardEffect})()`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.state.games.length, 1); assert.equal(env.state.loading, false);
  assert.equal(env.state.overviewLoading, true);
  cancel(); release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.state.audit, [], 'unmounted activity cannot update state');
  assert.equal(env.state.overviewLoading, true);
});

test('Dashboard failed core data uses unavailable states rather than false zero/empty claims', () => {
  assert.match(dashboard.text, /error \? "Upcoming games unavailable\."/);
  assert.match(dashboard.text, /error \? "Action details unavailable\."/);
  assert.match(dashboard.text, /loading \? "…" : error \? "—" : todayGames.length/);
  assert.match(dashboard.text, /overviewLoading \? "…" : overviewError \? "—" : totalOfficials/);
});


test('Dashboard recent activity merges exact newest8 across historical ID partitions', async () => {
  const history = Array.from({ length: 450 }, (_, i) => ({ id: `history-${String(i).padStart(3, '0')}`, organization_id: 'org', league_id: 'league-a', archived_at: null, starts_at: '2000-01-01' }));
  const audits = history.flatMap((g, i) => Array.from({ length: 2 }, (_, j) => ({ id: i * 2 + j, game_id: g.id, organization_id: 'org', occurred_at: `2026-10-${String(1 + i % 27).padStart(2, '0')}T12:00:00Z` })));
  const env = await dashboardRun({ tables: { games: history, audit_history: audits } });
  const expected = audits.slice().sort((a,b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id).slice(0, 8).map(a => a.id);
  assert.deepEqual(env.state.audit.map(a => a.id), expected);
  assert.deepEqual(env.state.games, [], 'history is not hydrated into games');
  const reads = env.calls.filter(c => c.name === 'audit_history'); assert.equal(reads.length, 3);
  for (const call of reads) { assert.equal(operation(call, 'limit')[1], 8); assert(operation(call, 'in', 'game_id')[2].length <= 200); }
});

test('Dashboard superseded core resource requests cannot publish old games', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const env = environment(dashboardEffect, { state: { fullLeagueAccess: true }, tables: { games: games.slice(0, 1) }, waitFor: call => call.name === 'assignments' ? gate : undefined });
  const cancel = env.run(`(${dashboardEffect})()`);
  await new Promise(resolve => setImmediate(resolve));
  assert(env.calls.some(c => c.name === 'assignments')); cancel(); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.state.games, []); assert.deepEqual(env.state.assignments, []);
});

function renderedDashboard(states) {
  let index = 0;
  const react = require('react');
  const Dashboard = moduleFrom('components/DashboardGames.tsx', {
    react: { ...react, useMemo: fn => fn(), useEffect() {}, useState: initial => [states[index++] ?? initial, () => {}] },
    './leagueGameScope': scope,
    '../lib/supabase/client': { createClient: () => ({}) },
    '../lib/supabase/readAll': paging,
  }).default;
  return Dashboard({ organizationId: 'org', fullLeagueAccess: true });
}
function elements(node) {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return typeof node === 'object' ? [node, ...elements(node.props?.children)] : [];
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return typeof node === 'object' ? textOf(node.props?.children) : String(node);
}
test('Dashboard actual component renders unavailable states on core failure, not zeros', () => {
  const view = renderedDashboard([[], [], [], [], [], [], 'needs', 'timeout', '', false, false]);
  const values = elements(view).filter(n => n.props?.className === 'dashboardMetricValue').map(textOf);
  assert.deepEqual(values, ['—', '—', '—', '—']);
  assert.match(textOf(view), /Upcoming games unavailable/); assert.doesNotMatch(textOf(view), /No upcoming games\./);
  assert.match(textOf(view), /Action details unavailable/);
  const donut = elements(view).find(n => n.props?.className === 'statusDonut');
  assert.equal(donut.props.style.background, '#e7edf2');
  assert.doesNotMatch(textOf(view), /—%/);
});
test('Dashboard actual component retains all-future card calculations and null relationships', () => {
  const now = Date.now();
  const game = (id, offset, status = 'scheduled', needed = 2) => ({ id, starts_at: new Date(now + offset).toISOString(), duration_minutes: 60, officials_needed: needed, status,
    home: null, away: null, location: null, leagues: null, levels: null, location_id: null });
  const rows = [game('past', -60000), game('full', 60000), game('partial', 120000), game('empty', 180000), game('hold', 240000, 'suspended'), game('canceled', 300000, 'canceled')];
  const assignments = [{id:'1',game_id:'full',official_id:'one',status:'confirmed'}, {id:'2',game_id:'full',official_id:'two',status:'accepted'},
    {id:'3',game_id:'partial',official_id:'three',status:'proposed',published_at:'2026-01-01'}, {id:'4',game_id:'empty',official_id:'four',status:'declined'}];
  const view = renderedDashboard([rows, assignments, [], [], [], [], 'needs', '', '', false, false]);
  const values = elements(view).filter(n => n.props?.className === 'dashboardMetricValue').map(textOf);
  assert.equal(values[0], String(rows.filter(g => new Date(g.starts_at).toDateString() === new Date().toDateString()).length));
  assert.equal(values[2], '2'); assert.equal(values[3], '1');
  const donut = elements(view).find(n => n.props?.className === 'statusDonut'); assert.match(textOf(donut), /3 Total Games/);
  assert.match(textOf(view), /TBD\s+vs\s+TBD/);
});


test('Dashboard unique resource chunks do not repeat authorization for an empty extra page', async () => {
  const rows = Array.from({length: 200}, (_, index) => ({ id: `game-${index}`, organization_id: 'org', league_id: 'league-a', archived_at: null, starts_at: '2099-01-01', home_team_id: `team-${index}`, away_team_id: `team-${index}` }));
  const env = await dashboardRun({ tables: { games: rows, teams: rows.map(g => ({id: g.home_team_id, name: 'Team'})) } });
  const teamReads = env.calls.filter(c => c.name === 'teams');
  assert.equal(env.state.games.length, 200); assert.equal(teamReads.length, 1);
  assert.equal(operation(teamReads[0], 'in', 'id')[2].length, 200);
  assert.deepEqual(operation(teamReads[0], 'range').slice(1), [0, 200]);
});
