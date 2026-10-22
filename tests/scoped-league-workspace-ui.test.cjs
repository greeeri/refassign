const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const copy = value => JSON.parse(JSON.stringify(value));
function moduleFrom(path) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), { module, exports: module.exports, require });
  return module.exports;
}
const paging = moduleFrom('lib/supabase/readAll.ts');
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
    ...paging, ...scope, organizationId: 'org', accessibleLeagueIds: ['league-a'], scopedLeagueIds: ['league-a'],
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
      then(resolve, reject) {
        if (changes.fail?.(call)) return Promise.resolve({ data: null, error: { message: 'Access changed' } }).then(resolve, reject);
        if (kind === 'rpc' && name === 'get_game_directory') return Promise.resolve({ data: {
          teams: [{ id: `${parameters.p_league_id}-team` }], levels: [{ id: `${parameters.p_league_id}-level` }],
          team_settings: [{ league_id: parameters.p_league_id, team_ids: [] }], level_settings: [],
        }, error: null }).then(resolve, reject);
        let rows = (tables[name] || []).slice();
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
    assert(call.operations.findIndex(([op]) => op === 'in') < call.operations.findIndex(([op]) => op === 'range'));
  }
  assert(env.calls.findIndex(call => call.name === 'assignments') > env.calls.findLastIndex(call => call.name === 'games'));
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
const assignmentLoad = assignments.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'load');
const declared = name => assignmentLoad.body.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(assignments.ast) === name)).getText(assignments.ast);
const candidateSource = [declared('loadAllLeagueEligibility'), declared('loadAllLevelEligibility'), declared('fetchCandidateData')].join('\n');
test('assignment candidate rankings, eligibility and availability are bounded to returned scoped roster IDs', async () => {
  const roster = Array.from({ length: 1005 }, (_, i) => ({ official_id: `official-${i}`, organization_id: 'org', active: true, 'officials.active': true, officials: { id: `official-${i}`, first_name: 'Ref', last_name: String(i) } }));
  const env = environment(candidateSource, { state: { candidateLeagueIds: ['league-a'], candidateLevelIds: ['level-a'], candidateTeamIds: [] }, tables: {
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
    assert.deepEqual(env.state.games.map(row => row.id), ['a-north', 'b-south', 'b-null']);
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
