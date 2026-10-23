const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
function loadModule(path) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), { module, exports: module.exports, require });
  return module.exports;
}
const copy = value => JSON.parse(JSON.stringify(value));
const venue = loadModule('lib/assignments/venueFilter.ts');
const paging = { ...loadModule('lib/supabase/readAll.ts'), ...loadModule('lib/assignments/boundedGamePage.ts') };
const scope = loadModule('components/leagueGameScope.ts');
const { fieldComplexRpcMissing } = loadModule('lib/field-complex-support.ts');
const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const ast = ts.createSourceFile('AssignmentsManagerV2.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate) {
  let found;
  function visit(node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, 'Expected production AST node was not found');
  return found;
}
const functionNode = name => findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const functionSource = name => functionNode(name).getText(ast);
const declares = (statement, name) => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name);
// Execute the actual production load setup and query. Do not copy the query into the test.
const loadStatements = functionNode('loadPage').body.statements;
const gamePromiseIndex = loadStatements.findIndex(statement => declares(statement, 'gamePromise'));
assert(gamePromiseIndex >= 0, 'Production load must define its game query');
const loadQuerySource = `async function runLoadQuery() {\n${loadStatements.slice(0, gamePromiseIndex + 1).map(statement => statement.getText(ast)).join('\n')}\nreturn await gamePromise;\n}`;
const token = name => venue.complexVenueFilterValue('selected-org', name);
const id = index => `field-${String(index).padStart(4, '0')}`;
const game = (index, locationId, changes = {}) => ({
  id: `game-${String(index).padStart(5, '0')}`,
  organization_id: 'selected-org', league_id: 'allowed-league', level_id: 'u16',
  location_id: locationId, archived_at: null, starts_at: '2099-10-22T15:00:00.000Z',
  location: { id: locationId, name: `Park Field ${locationId}`, address: '1 Same Address', venue_id: 'shared-venue' },
  ...changes,
});
function matchesScopeFilter(row, filter) {
  const restricted = [];
  const remaining = filter.replace(/and\(league_id\.eq\.("(?:[^"\\]|\\.)*"),location_id\.in\.\((.*?)\)\)/g, (_, league, locations) => {
    restricted.push({ league: JSON.parse(league), locations: JSON.parse(`[${locations}]`) }); return '';
  });
  const all = [...remaining.matchAll(/league_id\.eq\.("(?:[^"\\]|\\.)*")/g)].map(match => JSON.parse(match[1]));
  return all.includes(row.league_id) || restricted.some(grant => grant.league === row.league_id && grant.locations.includes(row.location_id));
}
function setup(options = {}) {
  const reads = [];
  const calls = [];
  const state = {
    ...paging, ...venue, ...scope, ...loadModule('lib/assignments/matchingGames.ts'), fieldComplexRpcMissing,
    organizationId: 'selected-org', accessibleLeagueIds: ['allowed-league'], fullLeagueAccess: false,
    range: 'all', customDate: '', fromDate: '', toDate: '', locationFilter: [], dayFilter: [], timeFilter: [], officialFilter: '', leagueFilter: '', levelFilter: '',
    unpublishedOnly: false, selfAssignOnly: false, replacementOnly: false, completenessFilter: [], focusGameId: undefined,
    matchingTotalsRequest: { current: null }, gamePaging: { current: { key: '', page: 1, asOf: '2026-10-23T00:00:00Z' } }, loadVersion: { current: 0 }, candidateCache: { current: null }, allowedGameAccess: [], canManage: true, allowedLeagueIds: null, error: '', games: ['old-game'], initialGamesReady: false,
    performance: { now: () => 0 }, document: { documentElement: { clientWidth: 1440 } }, console: { info() {} },
    ...options.state,
  };
  for (const name of ['MatchingTotals', 'TotalsError', 'GamePageNumber', 'GamePageHasMore', 'LinkSelected', 'SelfAssignSelected', 'ExpandedGameIds', 'Error', 'CanManage', 'AllowedLeagueIds', 'AllowedGameAccess', 'VenueDirectory', 'Games', 'InitialGamesReady', 'Officials', 'CandidateOfficialIds', 'Assignments', 'Blocks', 'Ranks', 'PositionRanks', 'Powers', 'TeamSuggestions', 'LeagueElig', 'LevelElig', 'CandidateScheduleConflicts', 'LinkGroups', 'LinkMembers', 'AssignmentTemplates', 'SelfAssignSlots', 'MentorSlots']) {
    state[`set${name}`] = value => { state[name[0].toLowerCase() + name.slice(1)] = copy(value); };
  }
  const tables = {
    games: options.games || [],
    organization_member_league_access: options.access || [{ organization_id: 'selected-org', user_id: 'current-user', league_id: 'allowed-league', all_locations: true, location_ids: [] }],
    locations: options.fields || [],
    get_organization_field_complexes: options.complexes || [],
  };
  function query(kind, name, parameters) {
    const call = { kind, name, parameters: copy(parameters || {}), operations: [] };
    calls.push(call);
    const builder = {
      then(resolve, reject) {
        reads.push(call);
        const error = options.fail?.(call);
        if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
        let rows = tables[name].slice();
        for (const [method, column, value] of call.operations) {
          if (method === 'eq' || method === 'is') rows = rows.filter(row => row[column] === value);
          if (method === 'in') rows = rows.filter(row => value.includes(row[column]));
          if (method === 'gte') rows = rows.filter(row => row[column] >= value);
          if (method === 'or') rows = rows.filter(row => matchesScopeFilter(row, column));
        }
        const orders = call.operations.filter(([method]) => method === 'order');
        rows.sort((left, right) => {
          for (const [, column, options] of orders) {
            const difference = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0;
            if (difference) return options?.ascending === false ? -difference : difference;
          }
          return 0;
        });
        const range = call.operations.find(([method]) => method === 'range');
        const from = range?.[1] || 0;
        const to = range?.[2] ?? 999;
        rows = rows.slice(from, Math.min(to + 1, from + 1000));
        options.onRead?.(call, state);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    for (const method of ['select', 'eq', 'is', 'in', 'gte', 'or', 'order', 'range']) {
      builder[method] = (...args) => { call.operations.push(copy([method, ...args])); return builder; };
    }
    return builder;
  }
  state.supabase = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'current-user' } } }) },
    from: name => query('from', name),
    rpc(name, parameters) {
      if (name === 'current_user_roles') return Promise.resolve({ data: options.roles || ['assignor'], error: null });
      if (name === 'get_assignment_matching_game_page' || name === 'get_assignment_matching_game_totals') {
        const call = { kind: 'rpc', name, parameters: copy(parameters), operations: [] }; calls.push(call); reads.push(call);
        const f = parameters.p_filters;
        // This mock is the documented server contract; actual SQL predicates and RLS
        // are tested separately using executable PostgreSQL fixtures.
        let rows = tables.games.filter(row => row.organization_id === parameters.p_organization_id && row.archived_at === null);
        rows = rows.filter(row => state.fullLeagueAccess || tables.organization_member_league_access.some(a => a.organization_id === state.organizationId && a.user_id === 'current-user' && a.league_id === row.league_id && (a.all_locations || a.location_ids.includes(row.location_id))));
        if (f.locationIds !== null) rows = rows.filter(row => f.locationIds.includes(row.location_id));
        if (f.leagueId) rows = rows.filter(row => row.league_id === f.leagueId);
        if (f.levelId) rows = rows.filter(row => row.level_id === f.levelId);
        if (f.officialId && options.matchingOfficialIds) rows = rows.filter(row => options.matchingOfficialIds.includes(row.id));
        const explicit = f.range !== 'all' || f.locationIds !== null || f.days.length || f.times.length || f.officialId || f.leagueId || f.levelId || f.unpublishedOnly || f.selfAssignOnly || f.replacementOnly || f.completeness.length;
        if (!explicit && f.focusGameId) rows = rows.filter(row => row.id === f.focusGameId);
        else if (!explicit) rows = rows.filter(row => row.starts_at >= f.asOf);
        rows.sort((a,b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
        const error = options.fail?.(call); if (error) return Promise.resolve({ data: null, error });
        if (options.rpcOverride) { const result = options.rpcOverride(call, state); if (result) return result; }
        if (name.endsWith('_totals')) return Promise.resolve({ data: { total: rows.length, ranges: {}, completeness: {}, queue: {}, unpublished: 0, selfAssign: 0, replacement: 0, allStatuses: rows.length }, error: null });
        const start = (parameters.p_page - 1) * parameters.p_page_size;
        return Promise.resolve({ data: rows.slice(start, start + parameters.p_page_size).map(row => ({ game_id: row.id })), error: null });
      }
      return query('rpc', name, parameters);
    },
  };
  vm.runInNewContext(compile(loadQuerySource), state);
  return { state, reads, calls, run: async () => { const result = await state.runLoadQuery(); state.matchingTotalsRequest.current?.start?.(); await new Promise(resolve => setImmediate(resolve)); return result; }, gameReads: () => reads.filter(call => call.name === 'games'), pageReads: () => reads.filter(call => call.name === 'get_assignment_matching_game_page') };
}
const operation = (call, method, column) => call.operations.find(([m, c]) => m === method && (column === undefined || column === c));
const resultIds = result => Array.from(result.data, row => row.id);

// Pure value and membership rules.
test('only an empty selection is unrestricted; raw field IDs remain backwards compatible', () => {
  assert.equal(venue.resolveVenueLocationIds([], 'selected-org', {}), null);
  assert.deepEqual(copy(venue.resolveVenueLocationIds(['old-field'], 'selected-org', {})), ['old-field']);
  assert.deepEqual(copy(venue.resolveVenueLocationIds(['old-field', 'old-field'], undefined, {})), ['old-field']);
});

test('complexes use explicit exact membership, not field names, address, venue, prefixes or case folding', () => {
  const memberships = venue.fieldComplexMap([
    { location_id: 'a', field_complex: '  Riverside  ' },
    { location_id: 'b', field_complex: 'Riverside' },
    { location_id: 'c', field_complex: 'Riverside Annex' },
    { location_id: 'd', field_complex: 'riverside' },
    { location_id: 'same-address', field_complex: null },
    { location_id: 'same-venue', field_complex: '   ' },
  ]);
  assert.deepEqual(copy(memberships), { a: 'Riverside', b: 'Riverside', c: 'Riverside Annex', d: 'riverside' });
  assert.deepEqual(copy(venue.resolveVenueLocationIds([token('Riverside')], 'selected-org', memberships)), ['a', 'b']);
});

test('organization-namespaced complex values preserve punctuation and Unicode without collisions', () => {
  const names = ["St. John's: North / East (A&B), 50% + #1", 'スポーツ 🏟️', 'A:B', 'A%3AB'];
  for (const name of names) {
    const value = token(name);
    assert.equal(value, `complex:selected-org:${encodeURIComponent(name)}`);
    assert.notEqual(value, venue.complexVenueFilterValue('other-org', name));
    assert.deepEqual(copy(venue.resolveVenueLocationIds([value], 'selected-org', { field: name })), ['field']);
    assert.deepEqual(copy(venue.resolveVenueLocationIds([value], 'other-org', { field: name })), []);
  }
  assert.equal(new Set(names.map(token)).size, names.length);
  assert.equal(venue.complexVenueFilterValue('org:one/two', ' A:B '), 'complex:org%3Aone%2Ftwo:A%3AB');
});

test('multiple complexes and individual fields form a deduplicated union', () => {
  const memberships = { a: 'North', b: 'North', c: 'South', d: 'Elsewhere' };
  const resolved = venue.resolveVenueLocationIds([token('North'), 'a', token('South'), 'historic', token('North'), 'historic'], 'selected-org', memberships);
  assert.deepEqual([...resolved].sort(), ['a', 'b', 'c', 'historic']);
});

test('missing, foreign and malformed complex tokens fail closed, including without an organization', () => {
  for (const value of [token('Removed'), venue.complexVenueFilterValue('foreign-org', 'North'), 'complex:', 'complex:%ZZ:North', 'complex:selected-org:%E0%A4%A', 'complex:North']) {
    assert.deepEqual(copy(venue.resolveVenueLocationIds([value], 'selected-org', { a: 'North' })), [], value);
    assert.deepEqual(copy(venue.resolveVenueLocationIds([value], undefined, { a: 'North' })), [], value);
  }
  assert.deepEqual(copy(venue.resolveVenueLocationIds([token('Removed'), 'valid-field'], 'selected-org', {})), ['valid-field']);
});

test('options remain sorted and stable when the selected filter leaves no visible games', () => {
  const fields = [{ id: 'b', name: 'Zulu Field' }, { id: 'a', name: 'Alpha Field' }];
  const memberships = { b: 'South', a: 'North', c: 'North' };
  const before = venue.assignmentVenueOptions('selected-org', memberships, fields, fields, []);
  const after = venue.assignmentVenueOptions('selected-org', memberships, fields, [], [token('North')]);
  assert.deepEqual(copy(before), [
    [token('North'), 'Complex: North (all fields)'], [token('South'), 'Complex: South (all fields)'],
    ['a', 'Field: Alpha Field'], ['b', 'Field: Zulu Field'],
  ]);
  assert.deepEqual(copy(after), copy(before));
  assert.deepEqual(fields, [{ id: 'b', name: 'Zulu Field' }, { id: 'a', name: 'Alpha Field' }], 'option building does not mutate input');
});

test('historical fields stay selectable, directory names win, and unavailable selections stay clearable', () => {
  const removed = token('Removed');
  const options = venue.assignmentVenueOptions('selected-org', {}, [{ id: 'active', name: 'Current Name' }], [
    { id: 'historic', name: 'Historic Field' }, { id: 'active', name: 'Old Name' },
  ], [removed, 'deleted-field', removed]);
  assert.deepEqual(copy(options), [
    ['active', 'Field: Current Name'], ['historic', 'Field: Historic Field'],
    [removed, 'Unavailable complex (clear to choose another)'],
    ['deleted-field', 'Unavailable field (clear to choose another)'],
  ]);
  assert.deepEqual(copy(venue.assignmentVenueOptions(undefined, { a: 'North' }, [], [], [])), []);
});

// Production catalog and game-query integration, backed by a capped local query mock.
test('catalog RPCs page past 1,000 rows and discover a member not present in the initial 50 games', async () => {
  const fields = Array.from({ length: 1005 }, (_, index) => ({ id: id(index), name: `Field ${index}` })).reverse();
  const complexes = fields.map(field => ({ location_id: field.id, field_complex: field.id === id(1004) ? 'Late Complex' : 'Other' }));
  const games = Array.from({ length: 60 }, (_, index) => game(index, id(index)));
  games.push(game(60, id(1004)));
  const s = setup({ fields, complexes, games, state: { locationFilter: [token('Late Complex')] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00060']);
  assert.equal(s.state.venueDirectory.fields.length, 1005);
  assert.equal(s.state.venueDirectory.complexes[id(1004)], 'Late Complex');
  const complexReads = s.reads.filter(call => call.name === 'get_organization_field_complexes');
  assert.deepEqual(complexReads.map(call => operation(call, 'range').slice(1)), [[0, 999], [1000, 1999]]);
  for (const call of complexReads) {
    assert.deepEqual(call.parameters, { p_organization_id: 'selected-org' });
    assert.deepEqual(operation(call, 'order'), ['order', 'location_id']);
  }
  const fieldReads = s.reads.filter(call => call.name === 'locations');
  assert.equal(fieldReads.length, 6, '1,005 authorized field IDs are read in bounded 200-ID chunks');
  assert.equal(fieldReads.flatMap(call => operation(call, 'in', 'id')[2]).length, 1005);
  for (const call of fieldReads) {
    assert.deepEqual(operation(call, 'select'), ['select', 'id,name']);
    assert.deepEqual(operation(call, 'order'), ['order', 'id']);
    assert.deepEqual(operation(call, 'range'), ['range', 0, 999]);
    assert(operation(call, 'in', 'id')[2].length <= 200);
  }
  assert(!s.calls.some(call => call.name === 'get_organization_locations'), 'the owner/admin-only settings directory is not assignor accessible');
  assert(s.reads.findIndex(call => call.name === 'games') > s.reads.findLastIndex(call => call.name === 'get_organization_field_complexes'));
});

test('ordinary assignors load grouped and ungrouped field names only from authorized organization memberships', async () => {
  const s = setup({
    roles: ['assignor'],
    fields: [{ id: 'member', name: 'North Field' }, { id: 'ungrouped', name: 'Solo Field' }, { id: 'foreign', name: 'Foreign Secret Field' }],
    complexes: [{ location_id: 'member', field_complex: 'North' }, { location_id: 'ungrouped', field_complex: null }],
    games: [game(1, 'member')], state: { locationFilter: [token('North')] },
  });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.equal(s.state.error, '');
  assert.deepEqual(s.state.venueDirectory.fields, [{ id: 'member', name: 'North Field' }, { id: 'ungrouped', name: 'Solo Field' }]);
  assert.deepEqual(s.state.venueDirectory.complexes, { member: 'North' });
  assert(!s.calls.some(call => call.name === 'get_organization_locations'));
  const names = s.reads.filter(call => call.name === 'locations');
  assert.equal(names.length, 1);
  assert.deepEqual(operation(names[0], 'in', 'id'), ['in', 'id', ['member', 'ungrouped']]);
  assert(names[0].operations.findIndex(([method]) => method === 'in') < names[0].operations.findIndex(([method]) => method === 'range'));
  assert(!names.some(call => operation(call, 'in', 'id')[2].includes('foreign')));
});

test('an empty membership catalog never falls back to an unrestricted location-directory read', async () => {
  const s = setup({ fields: [{ id: 'foreign', name: 'Foreign Secret Field' }], complexes: [] });
  await s.run();
  assert.deepEqual(s.state.venueDirectory.fields, []);
  assert(!s.calls.some(call => call.name === 'locations' || call.name === 'get_organization_locations'));
});

test('initial view stays capped at 50, but selecting a complex searches past that cap and into past games', async () => {
  const games = Array.from({ length: 85 }, (_, index) => game(index, index < 60 ? 'other' : 'member'));
  games.push(game(100, 'member', { starts_at: '2000-01-01T00:00:00.000Z' }));
  const shared = { games, complexes: [{ location_id: 'member', field_complex: 'North' }] };
  const initial = setup(shared);
  assert.equal((await initial.run()).data.length, 50);
  assert.equal(operation(initial.gameReads()[0], 'in', 'id')[2].length, 50);
  assert.equal(initial.pageReads()[0].parameters.p_filters.range, 'all');
  const filtered = setup({ ...shared, state: { locationFilter: [token('North')] } });
  const result = await filtered.run();
  assert.equal(result.data.length, 26);
  assert(resultIds(result).includes('game-00100'));
  assert(result.data.every(row => row.location_id === 'member'));
  assert.equal(operation(filtered.gameReads()[0], 'gte', 'starts_at'), undefined);
  assert.equal(operation(filtered.gameReads()[0], 'in', 'id')[2].length, 26);
});

test('production complex filters select server IDs before bounded hydration and preserve scope', async () => {
  const games = Array.from({ length: 1005 }, (_, index) => game(index, 'member')).reverse();
  games.push(game(2000, 'member', { organization_id: 'foreign-org' }), game(2001, 'member', { league_id: 'blocked-league' }), game(2002, 'member', { archived_at: '2026-01-01' }), game(2003, 'same-venue-not-member'));
  const s = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')] } });
  const result = await s.run(); assert.equal(result.data.length, 50); assert.equal(new Set(resultIds(result)).size, 50);
  assert.equal(s.state.matchingTotals.total, 1005); assert.equal(s.state.gamePageHasMore, true);
  assert.deepEqual(s.pageReads()[0].parameters.p_filters.locationIds, ['member']);
  for (const call of s.gameReads()) {
    assert.equal(operation(call, 'in', 'id')[2].length, 50);
    assert.deepEqual(operation(call, 'eq', 'organization_id'), ['eq', 'organization_id', 'selected-org']);
    assert.deepEqual(operation(call, 'in', 'league_id'), ['in', 'league_id', ['allowed-league']]);
    assert.deepEqual(operation(call, 'is', 'archived_at'), ['is', 'archived_at', null]);
    assert.equal(operation(call, 'range'), undefined);
  }
});

test('large complex filter is deduplicated in POST RPC and hydrates no more than 50 IDs', async () => {
  const complexes = Array.from({ length: 205 }, (_, index) => ({ location_id: id(index), field_complex: index < 203 ? 'North' : 'South' }));
  const games = complexes.map((row, index) => game(index, row.location_id));
  const s = setup({ complexes, games, state: { locationFilter: [token('North'), id(0), token('South'), id(204), token('North')] } });
  const result = await s.run(); assert.equal(result.data.length, 50); assert.equal(s.state.matchingTotals.total, 205);
  const requestedIds = s.pageReads()[0].parameters.p_filters.locationIds;
  assert.equal(requestedIds.length, 205); assert.equal(new Set(requestedIds).size, 205);
  assert.equal(s.gameReads().length, 1); assert.equal(operation(s.gameReads()[0], 'in', 'id')[2].length, 50);
});

test('a raw saved field ID searches games even when absent from the active location catalog', async () => {
  const s = setup({ games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.deepEqual(s.pageReads()[0].parameters.p_filters.locationIds, ['historic']);
});

test('invalid or unavailable selected complexes return zero games without issuing an unrestricted game request', async () => {
  for (const value of [token('Missing'), venue.complexVenueFilterValue('foreign-org', 'North'), 'complex:', 'complex:selected-org:%ZZ']) {
    const s = setup({ games: [game(1, 'member')], complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [value] } });
    assert.deepEqual(resultIds(await s.run()), [], value);
    assert.equal(s.gameReads().length, 0, value);
  }
});

test('explicit league and level filters intersect complex membership and existing allowed leagues', async () => {
  const games = [game(1, 'member'), game(2, 'member', { level_id: 'u18' }), game(3, 'member', { league_id: 'blocked-league' })];
  const s = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')], leagueFilter: 'allowed-league', levelFilter: 'u16' } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.equal(s.pageReads()[0].parameters.p_filters.leagueId, 'allowed-league');
  assert.equal(s.pageReads()[0].parameters.p_filters.levelId, 'u16');
  const denied = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')], leagueFilter: 'blocked-league' } });
  assert.deepEqual(resultIds(await denied.run()), []);
});

test('member league access is rechecked, organization-scoped, and cannot be bypassed by selecting a complex', async () => {
  const games = [game(1, 'member'), game(2, 'member', { league_id: 'blocked-league' })];
  const complexes = [{ location_id: 'member', field_complex: 'North' }];
  const s = setup({ games, complexes, access: [
    { organization_id: 'selected-org', user_id: 'current-user', league_id: 'allowed-league', all_locations: true, location_ids: [] },
    { organization_id: 'foreign-org', user_id: 'current-user', league_id: 'blocked-league', all_locations: true, location_ids: [] },
    { organization_id: 'selected-org', user_id: 'someone-else', league_id: 'blocked-league', all_locations: true, location_ids: [] },
  ], state: { locationFilter: [token('North')], fullLeagueAccess: false, accessibleLeagueIds: ['blocked-league'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.deepEqual(s.state.allowedLeagueIds, ['allowed-league']);
  const access = s.reads.find(call => call.name === 'organization_member_league_access');
  assert.deepEqual(operation(access, 'eq', 'organization_id'), ['eq', 'organization_id', 'selected-org']);
  assert.deepEqual(operation(access, 'eq', 'user_id'), ['eq', 'user_id', 'current-user']);
  const empty = setup({ games, complexes, access: [], state: { fullLeagueAccess: false, locationFilter: [token('North')] } });
  assert.equal(await empty.run(), undefined);
  assert.deepEqual(empty.state.games, []);
  assert.equal(empty.state.initialGamesReady, true);
  assert.equal(empty.gameReads().length, 0);
});

test('league authorization errors stop before catalog and game reads', async () => {
  const s = setup({ state: { fullLeagueAccess: false, locationFilter: [token('North')] }, fail: call => call.name === 'organization_member_league_access' && { message: 'Access lookup failed' } });
  assert.equal(await s.run(), undefined);
  assert.equal(s.state.error, 'Access lookup failed');
  assert.equal(s.reads.length, 1);
});

test('a later complex-catalog page failure clears filtered games instead of using partial membership', async () => {
  const complexes = Array.from({ length: 1005 }, (_, index) => ({ location_id: id(index), field_complex: 'North' }));
  const s = setup({ complexes, games: [game(1, id(0))], state: { locationFilter: [token('North')] }, fail: call => call.name === 'get_organization_field_complexes' && operation(call, 'range')?.[1] === 1000 && { message: 'Later membership page failed' } });
  assert.equal(await s.run(), undefined);
  assert.equal(s.state.error, 'Later membership page failed');
  assert.deepEqual(s.state.games, []);
  assert.equal(s.state.initialGamesReady, true);
  assert.equal(s.gameReads().length, 0);
});

test('an optional missing complex RPC leaves old field-only filters usable but never broadens a complex filter', async () => {
  const fail = call => call.name === 'get_organization_field_complexes' && { code: 'PGRST202', message: 'Could not find get_organization_field_complexes in the schema cache' };
  const field = setup({ games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] }, fail });
  assert.deepEqual(resultIds(await field.run()), ['game-00001']);
  assert.equal(field.state.error, '');
  const complex = setup({ games: [game(1, 'historic')], state: { locationFilter: [token('North')] }, fail });
  assert.deepEqual(resultIds(await complex.run()), []);
  assert.equal(complex.gameReads().length, 0);
  assert.equal(complex.state.error, '');
});

test('non-managers do not call management directory RPCs and old raw-field filtering still works', async () => {
  const s = setup({ roles: ['official'], games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert(!s.reads.some(call => call.name === 'get_organization_field_complexes'));
  assert.deepEqual(s.state.venueDirectory, { organizationId: 'selected-org', fields: [], complexes: {} });
});

test('stale directory loads do not replace a newer organization catalog or launch game reads', async () => {
  let changed = false;
  const s = setup({ state: { locationFilter: [token('North')] }, onRead(call, state) {
    if (!changed && call.name === 'get_organization_field_complexes') { changed = true; state.loadVersion.current++; }
  } });
  assert.equal(await s.run(), undefined);
  assert.equal(s.state.venueDirectory, undefined);
  assert.equal(s.gameReads().length, 0);
});

// Execute actual production UI handlers rather than matching their source text.
function handlerSetup() {
  const state = {
    require, exports: {}, range: 'custom', customDate: '2026-10-22', fromDate: '', toDate: '', showCalendar: true,
    dayFilter: ['2026-10-22'], timeFilter: ['15:00'], locationFilter: [token('North'), 'historic'],
    officialFilter: 'official', leagueFilter: 'allowed-league', levelFilter: 'u16', completenessFilter: ['partial'],
    unpublishedOnly: true, selfAssignOnly: true, replacementOnly: true,
    selected: 'selected-game', linkSelected: ['bulk-game'], error: '', notice: '',
    saved: [], loadCount: 0, window: { prompt: () => '  North venues  ' },
  };
  for (const name of ['Range', 'CustomDate', 'FromDate', 'ToDate', 'ShowCalendar', 'DayFilter', 'TimeFilter', 'LocationFilter', 'OfficialFilter', 'LeagueFilter', 'LevelFilter', 'CompletenessFilter', 'UnpublishedOnly', 'SelfAssignOnly', 'ReplacementOnly', 'Selected', 'LinkSelected', 'Error', 'Notice']) {
    state[`set${name}`] = value => { state[name[0].toLowerCase() + name.slice(1)] = copy(value); };
  }
  state.supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'current-user' } } }) },
    from: table => ({ upsert: async (row, options) => { state.saved.push({ table, row: copy(row), options: copy(options) }); return { error: null }; } }),
  };
  state.loadSavedViews = async () => { state.loadCount++; };
  const names = ['normalizeMultiFilter', 'clearGameFilters', 'saveCurrentView', 'applySavedView', 'matchesLocationFilter'];
  vm.runInNewContext(compile(names.map(functionSource).join('\n')), state);
  const control = findNode(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'MultiSelectGameFilter' && node.attributes.properties.some(prop => prop.name?.text === 'label' && prop.initializer?.text === 'Venue'));
  const onChange = control.attributes.properties.find(prop => prop.name?.text === 'onChange');
  vm.runInNewContext(compile(`const venueOnChange = ${onChange.initializer.expression.getText(ast)}; globalThis.changeVenue = venueOnChange;`), state);
  return state;
}

test('production Venue callback accepts complex and field values and clears active/bulk game selections', () => {
  const s = handlerSetup();
  s.changeVenue([token('South'), 'historic']);
  assert.deepEqual(s.locationFilter, [token('South'), 'historic']);
  assert.equal(s.selected, '');
  assert.deepEqual(s.linkSelected, []);
  s.changeVenue([]);
  assert.deepEqual(s.locationFilter, []);
});

test('production clear filters removes complex selections and resets all other game filters', () => {
  const s = handlerSetup();
  s.clearGameFilters();
  for (const key of ['locationFilter', 'dayFilter', 'timeFilter', 'completenessFilter', 'linkSelected']) assert.deepEqual(s[key], [], key);
  for (const key of ['customDate', 'officialFilter', 'leagueFilter', 'levelFilter', 'selected']) assert.equal(s[key], '', key);
  for (const key of ['showCalendar', 'unpublishedOnly', 'selfAssignOnly', 'replacementOnly']) assert.equal(s[key], false, key);
  assert.equal(s.range, 'all');
});

test('production save/apply handlers round-trip encoded complex values and field IDs without expanding stored membership', async () => {
  const s = handlerSetup();
  s.locationFilter = [token("St. John's: North / East (A&B), 50% + #1"), 'historic'];
  const selected = s.locationFilter.slice();
  await s.saveCurrentView();
  assert.equal(s.saved.length, 1);
  const saved = s.saved[0];
  assert.equal(saved.table, 'assignment_saved_views');
  assert.equal(saved.row.name, 'North venues');
  assert.equal(saved.row.user_id, 'current-user');
  assert.deepEqual(saved.row.filters.locationFilter, selected);
  assert.deepEqual(saved.options, { onConflict: 'user_id,name' });
  assert.equal(s.loadCount, 1);
  s.clearGameFilters();
  s.applySavedView({ ...saved.row.filters, id: 'view', name: saved.row.name });
  assert.deepEqual(s.locationFilter, selected);
  assert.equal(s.range, 'custom');
  assert.equal(s.levelFilter, 'u16');
  assert.equal(s.replacementOnly, false);
  assert.equal(s.selected, '');
  assert.deepEqual(s.linkSelected, []);
});

test('production saved-view handler accepts legacy single field IDs and empty old values', () => {
  const s = handlerSetup();
  const view = { name: 'Legacy', range: 'all', customDate: '', dayFilter: '', timeFilter: undefined, locationFilter: 'historic', officialFilter: '', completenessFilter: 'all', unpublishedOnly: false, selfAssignOnly: false };
  s.applySavedView(view);
  assert.deepEqual(s.locationFilter, ['historic']);
  assert.deepEqual(s.completenessFilter, []);
  assert.deepEqual(s.dayFilter, []);
  s.applySavedView({ ...view, locationFilter: undefined });
  assert.deepEqual(s.locationFilter, []);
});

test('production client-side predicate agrees with resolved membership and never treats an empty match as unrestricted', () => {
  const s = handlerSetup();
  const memberships = { a: 'North', b: 'North', c: 'South' };
  s.venueLocationIds = venue.resolveVenueLocationIds([token('North'), 'historic'], 'selected-org', memberships);
  assert.equal(s.matchesLocationFilter({ location_id: 'a' }), true);
  assert.equal(s.matchesLocationFilter({ location_id: 'b' }), true);
  assert.equal(s.matchesLocationFilter({ location_id: 'historic' }), true);
  assert.equal(s.matchesLocationFilter({ location_id: 'c' }), false);
  assert.equal(s.matchesLocationFilter({ location_id: null }), false);
  s.venueLocationIds = [];
  assert.equal(s.matchesLocationFilter({ location_id: 'a' }), false);
  s.venueLocationIds = null;
  assert.equal(s.matchesLocationFilter({ location_id: null }), true);
});

test('production derived catalog ignores cached complex membership from another organization', () => {
  const declarations = ['locationComplexes', 'venueLocationIds', 'venueFilterOptions'].map(name => findNode(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name));
  const state = {
    ...venue, organizationId: 'new-org', locationFilter: [venue.complexVenueFilterValue('old-org', 'North')], games: [],
    venueDirectory: { organizationId: 'old-org', fields: [{ id: 'old-field', name: 'Old' }], complexes: { 'old-field': 'North' } },
  };
  vm.runInNewContext(compile(declarations.map(node => `globalThis.${node.name.getText(ast)} = ${node.initializer.getText(ast)};`).join('\n')), state);
  assert.deepEqual(copy(state.locationComplexes), {});
  assert.deepEqual(copy(state.venueLocationIds), []);
  assert.deepEqual(copy(state.venueFilterOptions), [[state.locationFilter[0], 'Unavailable complex (clear to choose another)']]);
});

test('explicit owner or protected full access retains all organization leagues, even with no membership grants', async () => {
  const s = setup({ games: [game(1, 'member'), game(2, 'member', { league_id: 'another-league' }), game(3, 'member', { organization_id: 'foreign' })],
    state: { fullLeagueAccess: true, accessibleLeagueIds: [], locationFilter: [] }, access: [] });
  assert.deepEqual(resultIds(await s.run()), ['game-00001', 'game-00002']);
  assert.equal(s.state.allowedLeagueIds, null);
  assert(!s.calls.some(call => call.name === 'organization_member_league_access'));
  assert(!s.gameReads().some(call => operation(call, 'in', 'league_id')));
});

test('an unknown workspace without explicit full access fails closed before any game or directory reads', async () => {
  const s = setup({ games: [game(1, 'member')], state: { organizationId: undefined, accessibleLeagueIds: undefined, fullLeagueAccess: false } });
  assert.equal(await s.run(), undefined);
  assert.deepEqual(s.state.allowedLeagueIds, []);
  assert.deepEqual(s.state.games, []);
  assert.equal(s.gameReads().length, 0);
  assert(!s.calls.some(call => call.name === 'get_organization_field_complexes'));
});

test('assignments recheck per-league location grants before pagination and discard old candidate caches', async () => {
  const s = setup({ games: [game(1, 'north'), game(2, 'south'), game(3, null), game(4, 'south', { league_id: 'all-location-league' })], access: [
    { organization_id: 'selected-org', user_id: 'current-user', league_id: 'allowed-league', all_locations: false, location_ids: ['north'] },
    { organization_id: 'selected-org', user_id: 'current-user', league_id: 'all-location-league', all_locations: true, location_ids: [] },
  ], state: { allowedGameAccess: [{ league_id: 'allowed-league', all_locations: true, location_ids: [] }], candidateCache: { current: { key: 'old-full-league' } } } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001', 'game-00004']);
  assert.equal(s.state.candidateCache.current, null);
  assert.deepEqual(s.state.officials, []);
  for (const call of s.gameReads()) {
    assert(operation(call, 'or'));
    assert(operation(call, 'in', 'id')[2].length <= 50);
  }
});

test('every explicit filter keeps a bounded 50-game page and preserves past-game inclusion', async () => {
  const games = Array.from({ length: 180 }, (_, index) => game(index, 'member', { starts_at: '2000-01-01T00:00:00Z' }));
  for (const filter of [ { leagueFilter: 'allowed-league' }, { levelFilter: 'u16' }, { officialFilter: 'ref' }, { range: 'custom', customDate: '2000-01-01' }, { dayFilter: ['2000-01-01'] }, { timeFilter: ['18:00'] }, { unpublishedOnly: true }, { selfAssignOnly: true }, { replacementOnly: true }, { completenessFilter: ['partial'] } ]) {
    const s = setup({ games, state: filter });
    const first = await s.run();
    assert.equal(first.data.length, 50, JSON.stringify(filter));
    assert.equal(s.state.gamePageHasMore, true);
    assert.deepEqual(resultIds(first), games.slice(0, 50).map(row => row.id));
    assert.equal(s.gameReads().length, 1, 'one bounded query, never readAllPages');
    assert.equal(operation(s.gameReads()[0], 'in', 'id')[2].length, 50);
    assert.equal(operation(s.gameReads()[0], 'gte', 'starts_at'), undefined, 'no new blanket future-only rule');
  }
});

test('production query traverses bounded pages without dropping or duplicating games and resets on filter or scope changes', async () => {
  const games = Array.from({ length: 123 }, (_, index) => game(index, 'member'));
  const s = setup({ games, state: { leagueFilter: 'allowed-league' } });
  const all = [];
  let result;
  do {
    const before = s.gameReads().length;
    result = await s.run();
    all.push(...resultIds(result));
    assert(result.data.length <= 50);
    assert.equal(s.gameReads().length - before, 1);
    s.state.gamePaging.current.page++;
  } while (s.state.gamePageHasMore);
  assert.deepEqual(all, games.map(row => row.id));
  assert.equal(new Set(all).size, 123);
  s.state.levelFilter = 'u16';
  assert.deepEqual(resultIds(await s.run()), games.slice(0, 50).map(row => row.id));
  assert.equal(s.state.gamePaging.current.page, 1);
});

test('multi-chunk production venue queries merge globally before the 50-game bound', async () => {
  const complexes = Array.from({ length: 205 }, (_, index) => ({ location_id: id(index), field_complex: 'North' }));
  const games = Array.from({ length: 180 }, (_, index) => game(index, index % 2 ? id(204) : id(0)));
  const s = setup({ games, complexes, state: { locationFilter: [token('North')] } });
  const first = await s.run();
  assert.deepEqual(resultIds(first), games.slice(0, 50).map(row => row.id));
  s.state.gamePaging.current.page = 2;
  const second = await s.run();
  assert.deepEqual(resultIds(second), games.slice(50, 100).map(row => row.id));
  assert(s.gameReads().every(call => operation(call, 'in', 'id')[2].length <= 50));
});

test('production page navigation clears off-page selections and repeated clicks are locked during load', async () => {
  const code = functionSource('changeGamePage');
  const state = { gamePaging: { current: { page: 1 } }, totalPages: 3, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
  for (const name of ['bulkWorking', 'linking', 'saving', 'publishing', 'confirming', 'bulkCrewWorking', 'crewTemplateWorking', 'replacementPublishing', 'calendarReviewSaving', 'fieldMoveSaving']) state[name] = false;
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = value => { state[name.slice(3)] = value; };
  let loads = 0;
  state.load = () => { loads++; state.gamePageLoadingRef.current = true; };
  vm.runInNewContext(compile(code), state);
  state.changeGamePage(2);
  assert.equal(state.gamePaging.current.page, 2);
  assert.deepEqual(copy(state.LinkSelected), []);
  assert.deepEqual(copy(state.SelfAssignSelected), []);
  assert.deepEqual(copy(state.Games), []);
  assert.equal(state.Selected, '');
  assert.equal(state.GamePageNumber, 2);
  assert.equal(state.QuickEdit, null);
  assert.equal(state.PendingGameStatus, null);
  assert.equal(state.ShowBroadcastReview, false);
  state.changeGamePage(1);
  assert.equal(loads, 1);
  state.gamePageLoadingRef.current = false;
  state.changeGamePage(1);
  assert.equal(state.gamePaging.current.page, 1);
  assert.equal(loads, 2);
});

test('linked membership metadata is fetched by full page-discovered group IDs, while whole-group RPC enforcement remains', () => {
  const body = functionSource('loadPage');
  assert.match(body, /const completeMembers = await readAllForChunks[\s\S]*?\.in\("group_id", ids\)/);
  assert.match(body, /setLinkMembers\(completeMembers\.data \|\| \[\]\)/);
  assert.match(source, /shown of \{linkMembers\.filter/);
  assert.match(source, /Linked-game assignments still apply to the whole authorized group/);
  const migration = fs.readFileSync('supabase/migrations/20261022195617_scope_administrators_to_selected_leagues.sql', 'utf8');
  assert.match(migration, /perform private\.require_linked_game_scope\(p_game_id\)/);
});

test('unlinking one visible member does not delete an off-page three-member group', async () => {
  const code = functionSource('unlinkOneGame');
  const deletes = [];
  const state = { canManage: true, linking: false, linkMembers: [
    { group_id: 'group', game_id: 'visible' }, { group_id: 'group', game_id: 'off-page-1' }, { group_id: 'group', game_id: 'off-page-2' },
  ], load: async () => {}, supabase: { from(table) { const call = { table, filters: [] }; deletes.push(call); const query = { delete() { return query; }, eq(...values) { call.filters.push(values); return query; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); } }; return query; } } };
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = () => {};
  vm.runInNewContext(compile(code), state);
  await state.unlinkOneGame('group', 'visible');
  assert.deepEqual(deletes.map(call => call.table), ['game_link_members']);
  assert.deepEqual(deletes[0].filters, [['group_id', 'group'], ['game_id', 'visible']]);
});

test('loading wrapper clears pending state after failure without letting stale requests unlock a newer page', async () => {
  const code = functionSource('load');
  const finishes = [];
  const state = { matchingTotalsRequest: { current: null }, loadVersion: { current: 0 }, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = value => { state[name.slice(3)] = value; };
  state.loadPage = () => { state.loadVersion.current++; return new Promise((resolve, reject) => finishes.push({ resolve, reject })); };
  vm.runInNewContext(compile(code), state);
  const first = state.load(); const second = state.load();
  finishes[0].resolve(); await first;
  assert.equal(state.gamePageLoadingRef.current, true);
  finishes[1].reject(new Error('offline')); await second;
  assert.equal(state.gamePageLoadingRef.current, false);
  assert.equal(state.GamePageLoading, false);
  assert.equal(state.GamePageHasMore, false);
});

test('split-group move controls use complete membership rather than page-local row index', () => {
  const code = functionSource('linkedGameNeighbor');
  const state = { linkMembers: [
    { group_id: 'group', game_id: 'first', sort_order: 0 },
    { group_id: 'group', game_id: 'middle-off-page', sort_order: 1 },
    { group_id: 'group', game_id: 'last', sort_order: 2 },
  ] };
  vm.runInNewContext(compile(code), state);
  assert.equal(state.linkedGameNeighbor('group', 'first', -1), null);
  assert.equal(state.linkedGameNeighbor('group', 'first', 1), 'middle-off-page');
  assert.equal(state.linkedGameNeighbor('group', 'last', -1), 'middle-off-page');
  assert.equal(state.linkedGameNeighbor('group', 'last', 1), null);
  assert(source.includes('disabled={linking || !linkedGameNeighbor(unit.groupId!, listedGame.id, -1)}'));
  assert(source.includes('linking || !linkedGameNeighbor(unit.groupId!, listedGame.id, 1)'));
});

test('server matching IDs fill a page even when matching officials occur late in the schedule', async () => {
  const games = Array.from({ length: 151 }, (_, index) => game(index, 'member'));
  const s = setup({ games, matchingOfficialIds: games.slice(75).map(row => row.id), state: { officialFilter: 'ref-only-on-later-page' } });
  const first = await s.run(); assert.equal(first.data.length, 50); assert.equal(s.state.matchingTotals.total, 76);
  assert.equal(first.data[0].id, games[75].id); assert.equal(s.state.gamePageHasMore, true);
  s.state.gamePaging.current.page = 2; const second = await s.run(); assert.equal(second.data.length, 26);
  assert.equal(s.state.gamePageHasMore, false);
});

test('matching page hydrates without waiting for slower totals and later totals complete navigation', async () => {
  let resolveTotals;
  const totals = new Promise(resolve => { resolveTotals = resolve; });
  const games = Array.from({ length: 80 }, (_, i) => game(i, 'member'));
  const s = setup({ games, state: { leagueFilter: 'allowed-league' }, rpcOverride(call) {
    if (call.name.endsWith('_totals')) return totals;
  } });
  const result = await s.run();
  assert.equal(result.data.length, 50); assert.equal(s.state.matchingTotals, null);
  resolveTotals({ data: { total: 80, ranges: {}, completeness: {}, queue: {}, unpublished: 0, selfAssign: 0, replacement: 0, allStatuses: 80 }, error: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.state.matchingTotals.total, 80); assert.equal(s.state.gamePageHasMore, true);
});

test('stale totals response cannot replace current filter totals or next-page state', async () => {
  const pending = [];
  const s = setup({ games: [game(1, 'member')], state: { leagueFilter: 'allowed-league' }, rpcOverride(call) {
    if (call.name.endsWith('_totals')) return new Promise(resolve => pending.push(resolve));
  } });
  await s.run(); s.state.levelFilter = 'u16'; await s.run();
  const response = total => ({ data: { total, ranges: {}, completeness: {}, queue: {}, unpublished: 0, selfAssign: 0, replacement: 0, allStatuses: total }, error: null });
  pending[1](response(1)); await new Promise(resolve => setImmediate(resolve));
  pending[0](response(1000)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.state.matchingTotals.total, 1); assert.equal(s.state.gamePageHasMore, false);
});

test('failed totals preserve a successful page and expose retry state instead of false zero', async () => {
  const s = setup({ games: [game(1, 'member')], fail: call => call.name.endsWith('_totals') ? { message: 'Counts offline' } : null });
  assert.equal((await s.run()).data.length, 1);
  assert.equal(s.state.matchingTotals, null); assert.equal(s.state.totalsError, 'Counts offline');
});

test('page RPC failure or oversized response never triggers unrestricted hydration', async () => {
  for (const oversized of [false, true]) {
    const s = setup({ games: Array.from({ length: 80 }, (_, i) => game(i, 'member')), rpcOverride(call) {
      if (call.name.endsWith('_page')) return Promise.resolve(oversized
        ? { data: Array.from({ length: 51 }, (_, i) => ({ game_id: `game-${i}` })), error: null }
        : { data: null, error: { message: 'Page offline' } });
    } });
    const result = await s.run(); assert(result.error); assert.equal(s.gameReads().length, 0);
  }
});

test('reversed From/To dates fail before totals and matching-page RPCs', async () => {
  const s = setup({ state: { range: 'dateRange', fromDate: '2026-10-24', toDate: '2026-10-23' } });
  assert.equal(await s.run(), undefined);
  assert.equal(s.state.error, 'From date must be on or before To date.');
  assert.equal(s.pageReads().length, 0); assert.equal(s.gameReads().length, 0);
});

test('open date endpoints are forwarded without coercion and saved views round-trip both dates', async () => {
  for (const dates of [{ fromDate: '2026-10-23', toDate: '' }, { fromDate: '', toDate: '2026-10-24' }]) {
    const s = setup({ state: { range: 'dateRange', ...dates } }); await s.run();
    assert.equal(s.pageReads()[0].parameters.p_filters.fromDate, dates.fromDate);
    assert.equal(s.pageReads()[0].parameters.p_filters.toDate, dates.toDate);
  }
  const s = handlerSetup(); s.range = 'dateRange'; s.fromDate = '2026-10-23'; s.toDate = '2026-10-24';
  await s.saveCurrentView(); s.clearGameFilters(); s.applySavedView({ ...s.saved[0].row.filters, id: 'dates', name: 'Dates' });
  assert.equal(s.fromDate, '2026-10-23'); assert.equal(s.toDate, '2026-10-24'); assert.equal(s.range, 'dateRange');
});

test('numeric navigation validates pages and preserves action lockout before changing state', () => {
  const code = functionSource('changeGamePage');
  const state = { gamePaging: { current: { page: 2 } }, totalPages: 8, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = value => { state[name.slice(3)] = value; };
  let loads = 0; state.load = () => { loads++; };
  vm.runInNewContext(compile(code), state);
  for (const page of [0, -1, 9, NaN, 1.5, 2]) state.changeGamePage(page);
  assert.equal(loads, 0); assert.equal(state.gamePaging.current.page, 2);
  state.gamePageActionBusy = true; state.changeGamePage(8); assert.equal(loads, 0);
  state.gamePageActionBusy = false; state.changeGamePage(8); assert.equal(state.gamePaging.current.page, 8);
  state.changeGamePage(1); assert.equal(state.gamePaging.current.page, 1); assert.equal(loads, 2);
});

test('assignment refresh reloads matching IDs and totals, including an empty current page', async () => {
  const code = functionSource('refreshAssignmentState'); const calls = [];
  const state = { games: [], loadCandidateScheduleConflicts: async () => null, load: async reuse => calls.push(reuse) };
  for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = () => {};
  vm.runInNewContext(compile(code), state);
  assert.equal(await state.refreshAssignmentState(), true); assert.deepEqual(calls, [true]);
});

test('every successful status update refreshes matching IDs while failed status leaves source rows unchanged', async () => {
  const code = functionSource('changeGameStatus');
  for (const status of ['active', 'suspended', 'canceled', 'rained_out']) {
    for (const ok of [true, false]) {
      let refreshes = 0;
      const state = { canManage: true, organizationId: 'org', games: [{ id: 'game', status: 'active' }], gameStatusOptions: [],
        fetch: async () => ({ ok, json: async () => ok ? {} : { error: 'Blocked by conflict' } }),
        showGameConflictPopup: () => {}, refreshAssignmentState: async () => refreshes++ };
      for (const name of new Set(code.match(/\bset[A-Z]\w+/g))) state[name] = value => {
        const key = name.slice(3); state[key] = typeof value === 'function' ? value(state.games) : value;
      };
      vm.runInNewContext(compile(code), state); await state.changeGameStatus('game', status);
      assert.equal(refreshes, ok ? 1 : 0, `${status}: success=${ok}`);
      if (ok) assert.equal(state.Games[0].status, status); else assert.equal(state.games[0].status, 'active');
      assert.equal(state.GameStatusSaving, '');
    }
  }
});


test('page-only navigation reuses completed totals and updates last-page navigation', async () => {
 const s=setup({games:Array.from({length:120},(_,i)=>game(i,'member'))});
 await s.run();
 const original=s.state.matchingTotals;
 for(const page of [2,3,1]) {s.state.gamePaging.current.page=page;await s.run();assert.deepEqual(s.state.matchingTotals,original);assert.equal(s.state.gamePageHasMore,page<3);}
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,1);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_page')).length,4);
 assert(functionSource('changeGamePage').includes('load(true, true)'));
});

test('pending counts survive page generations without duplicate RPC and use current page', async () => {
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const s=setup({games:Array.from({length:120},(_,i)=>game(i,'member')),rpcOverride(call){if(call.name.endsWith('_totals'))return pending;}});
 await s.run();s.state.gamePaging.current.page=3;await s.run();
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,1);
 finish({data:{total:120,ranges:{},completeness:{},queue:{},unpublished:0,selfAssign:0,replacement:0,allStatuses:120},error:null});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.state.matchingTotals.total,120);assert.equal(s.state.gamePageHasMore,false);
});

test('non-page load invalidates counts immediately for mutations filters Undo and Retry', async () => {
 const code=functionSource('load');const state={matchingTotalsRequest:{current:{key:'old',totals:{total:120}}},loadVersion:{current:0},gamePageLoadingRef:{current:false}};
 for(const name of new Set(code.match(/\bset[A-Z]\w+/g)))state[name]=value=>{state[name.slice(3)]=value;};
 state.loadPage=async()=>{state.loadVersion.current++;};vm.runInNewContext(compile(code),state);
 const old=state.matchingTotalsRequest.current;await state.load(true,true);assert.equal(state.matchingTotalsRequest.current,old);
 await state.load(true);assert.equal(state.matchingTotalsRequest.current,null);assert.equal(state.MatchingTotals,null);
 state.matchingTotalsRequest.current=old;await state.load();assert.equal(state.matchingTotalsRequest.current,null);
 assert.equal((source.match(/load\(true, true\)/g)||[]).length,1,'only page navigation opts into reuse');
});

test('scope revocation cancels pending counts before their late response', async()=>{
 let finish;const access=[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]}];
 const s=setup({access,games:[game(1,'member')],rpcOverride(call){if(call.name.endsWith('_totals'))return new Promise(resolve=>{finish=resolve;});}});
 await s.run();access.splice(0);await s.run();
 assert.equal(s.state.matchingTotalsRequest.current,null);
 finish({data:{total:999,ranges:{},completeness:{},queue:{},unpublished:0,selfAssign:0,replacement:0,allStatuses:999},error:null});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.state.matchingTotals.total,0);
 assert(functionSource('loadPage').includes('matchingTotalsRequest.current = null; setMatchingTotals(null)'));
});


test('explicit retry invalidates failed count request while a page retry never hides successful counts', async()=>{
 let fail=true;const s=setup({games:[game(1,'member')],fail:call=>fail&&call.name.endsWith('_totals')?{message:'offline'}:null});
 await s.run();assert.equal(s.state.totalsError,'offline');
 const code=functionSource('load');s.state.gamePageLoadingRef={current:false};
 for(const name of ['GamePageLoading'])s.state[`set${name}`]=value=>{s.state[name]=value;};
 s.state.loadPage=s.run;vm.runInNewContext(compile(code),s.state);
 fail=false;await s.state.load(true);
 assert.equal(s.state.matchingTotals.total,1);assert.equal(s.state.totalsError,'');
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,2);
 await s.state.load(true,true);assert.equal(s.state.matchingTotals.total,1);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,2);
});


test('lost login or auth error on navigation cancels pending counts even for owner-wide access', async()=>{
 for(const authError of [null,{message:'Auth unavailable'}]) {
  let finish;const s=setup({state:{fullLeagueAccess:true},games:[game(1,'member')],rpcOverride(call){if(call.name.endsWith('_totals'))return new Promise(resolve=>{finish=resolve;});}});
  await s.run();s.state.supabase.auth.getUser=async()=>({data:{user:null},error:authError});await s.run();
  assert.equal(s.state.matchingTotalsRequest.current,null);assert.equal(s.state.matchingTotals,null);assert.deepEqual(s.state.games,[]);
  finish({data:{total:999,ranges:{},completeness:{},queue:{},unpublished:0,selfAssign:0,replacement:0,allStatuses:999},error:null});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(s.state.matchingTotals,null);
 }
});


test('page loading settles and unlocks before deferred totals start, without awaiting totals',async()=>{
 const events=[];let finish;
 const state={matchingTotalsRequest:{current:{start:()=>events.push('counts started')}},loadVersion:{current:0},gamePageLoadingRef:{current:false}};
 for(const name of new Set(functionSource('load').match(/\bset[A-Z]\w+/g)))state[name]=value=>{if(name==='setGamePageLoading'&&!value)events.push('page unlocked');};
 state.loadPage=()=>{state.loadVersion.current++;events.push('hydration started');return new Promise(resolve=>{finish=resolve;});};
 vm.runInNewContext(compile(functionSource('load')),state);
 const loading=state.load(true,true);assert.deepEqual(events,['hydration started']);
 events.push('hydration finished');finish();await loading;
 assert.deepEqual(events,['hydration started','hydration finished','page unlocked','counts started']);
});

test('totals are not issued during page hydration and empty pages still start them afterward',async()=>{
 for(const games of [[],[game(1,'member')]]){
  const s=setup({games});await s.state.runLoadQuery();
  assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,0);
  assert.equal(typeof s.state.matchingTotalsRequest.current.start,'function');
  s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,1);
  assert.equal(s.state.matchingTotals.total,games.length);
 }
});

test('stale deferred count starter never issues an RPC after filter identity changes',async()=>{
 const s=setup({games:[game(1,'member')]});await s.state.runLoadQuery();
 const oldStart=s.state.matchingTotalsRequest.current.start;
 s.state.levelFilter='u16';await s.state.runLoadQuery();oldStart();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,0);
 s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,1);
});


test('same-key page load reuses a not-yet-started count callback exactly once',async()=>{
 const s=setup({games:Array.from({length:80},(_,i)=>game(i,'member'))});await s.state.runLoadQuery();
 const start=s.state.matchingTotalsRequest.current.start;
 s.state.gamePaging.current.page=2;await s.state.runLoadQuery();assert.equal(s.state.matchingTotalsRequest.current.start,start);
 start();start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,1);assert.equal(s.state.gamePageHasMore,false);
});

test('scope invalidation between scheduled start and RPC suppresses even the request',async()=>{
 const s=setup({games:[game(1,'member')]});await s.state.runLoadQuery();
 s.state.matchingTotalsRequest.current.start();s.state.matchingTotalsRequest.current=null;
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.filter(c=>c.name.endsWith('_totals')).length,0);
});

test('hydration rejection preserves page error and unlocks before starting current counts',async()=>{
 const events=[];const state={matchingTotalsRequest:{current:{start:()=>events.push('counts')}},loadVersion:{current:0},gamePageLoadingRef:{current:false}};
 for(const name of new Set(functionSource('load').match(/\bset[A-Z]\w+/g)))state[name]=value=>{state[name.slice(3)]=value;};
 state.loadPage=async()=>{state.loadVersion.current++;throw new Error('hydrate failed');};
 vm.runInNewContext(compile(functionSource('load')),state);await state.load(true,true);
 assert.equal(state.Error,'Unable to load games.');assert.equal(state.gamePageLoadingRef.current,false);assert.deepEqual(events,['counts']);
});
