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
const paging = loadModule('lib/supabase/readAll.ts');
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
const loadStatements = functionNode('load').body.statements;
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
    ...paging, ...venue, ...scope, fieldComplexRpcMissing,
    organizationId: 'selected-org', accessibleLeagueIds: ['allowed-league'], fullLeagueAccess: false,
    range: 'all', locationFilter: [], dayFilter: [], timeFilter: [], officialFilter: '', leagueFilter: '', levelFilter: '',
    unpublishedOnly: false, selfAssignOnly: false, replacementOnly: false, completenessFilter: [], focusGameId: undefined,
    loadVersion: { current: 0 }, candidateCache: { current: null }, allowedGameAccess: [], canManage: true, allowedLeagueIds: null, error: '', games: ['old-game'], initialGamesReady: false,
    performance: { now: () => 0 }, document: { documentElement: { clientWidth: 1440 } }, console: { info() {} },
    ...options.state,
  };
  for (const name of ['Error', 'CanManage', 'AllowedLeagueIds', 'AllowedGameAccess', 'VenueDirectory', 'Games', 'InitialGamesReady', 'Officials', 'Assignments', 'Blocks', 'Ranks', 'PositionRanks', 'Powers', 'TeamSuggestions', 'LeagueElig', 'LevelElig', 'CandidateScheduleConflicts', 'LinkGroups', 'LinkMembers', 'AssignmentTemplates', 'SelfAssignSlots', 'MentorSlots']) {
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
      return query('rpc', name, parameters);
    },
  };
  vm.runInNewContext(compile(loadQuerySource), state);
  return { state, reads, calls, run: () => state.runLoadQuery(), gameReads: () => reads.filter(call => call.name === 'games') };
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
  assert.deepEqual(operation(initial.gameReads()[0], 'range'), ['range', 0, 49]);
  assert(operation(initial.gameReads()[0], 'gte', 'starts_at'));
  const filtered = setup({ ...shared, state: { locationFilter: [token('North')] } });
  const result = await filtered.run();
  assert.equal(result.data.length, 26);
  assert(resultIds(result).includes('game-00100'));
  assert(result.data.every(row => row.location_id === 'member'));
  assert.equal(operation(filtered.gameReads()[0], 'gte', 'starts_at'), undefined);
  assert.deepEqual(operation(filtered.gameReads()[0], 'range'), ['range', 0, 999]);
});

test('production complex filters apply before every game page and keep organization, league and archive scope', async () => {
  const games = Array.from({ length: 1005 }, (_, index) => game(index, 'member')).reverse();
  games.push(game(2000, 'member', { organization_id: 'foreign-org' }), game(2001, 'member', { league_id: 'blocked-league' }), game(2002, 'member', { archived_at: '2026-01-01' }), game(2003, 'same-venue-not-member'));
  const s = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')] } });
  const result = await s.run();
  assert.equal(result.data.length, 1005);
  assert.equal(new Set(resultIds(result)).size, 1005);
  assert.deepEqual(s.gameReads().map(call => operation(call, 'range').slice(1)), [[0, 999], [1000, 1999]]);
  for (const call of s.gameReads()) {
    assert.deepEqual(operation(call, 'in', 'location_id'), ['in', 'location_id', ['member']]);
    assert.deepEqual(operation(call, 'eq', 'organization_id'), ['eq', 'organization_id', 'selected-org']);
    assert.deepEqual(operation(call, 'in', 'league_id'), ['in', 'league_id', ['allowed-league']]);
    assert.deepEqual(operation(call, 'is', 'archived_at'), ['is', 'archived_at', null]);
    assert.deepEqual(call.operations.filter(([method]) => method === 'order'), [['order', 'starts_at'], ['order', 'id']]);
    const rangeIndex = call.operations.findIndex(([method]) => method === 'range');
    assert(call.operations.findIndex(([method, column]) => method === 'in' && column === 'location_id') < rangeIndex);
    assert(call.operations.findIndex(([method, column]) => method === 'eq' && column === 'organization_id') < rangeIndex);
    assert(call.operations.findIndex(([method, column]) => method === 'in' && column === 'league_id') < rangeIndex);
  }
});

test('large complexes chunk more than 200 field IDs and overlapping selections never duplicate games', async () => {
  const complexes = Array.from({ length: 205 }, (_, index) => ({ location_id: id(index), field_complex: index < 203 ? 'North' : 'South' }));
  const games = complexes.map((row, index) => game(index, row.location_id));
  const s = setup({ complexes, games, state: { locationFilter: [token('North'), id(0), token('South'), id(204), token('North')] } });
  const result = await s.run();
  assert.equal(result.data.length, 205);
  assert.equal(new Set(resultIds(result)).size, 205);
  const requestedIds = s.gameReads().flatMap(call => operation(call, 'in', 'location_id')[2]);
  assert.equal(requestedIds.length, 205);
  assert.equal(new Set(requestedIds).size, 205);
  assert(s.gameReads().length >= 2, 'large location filters must not make one oversized URL');
  assert(s.gameReads().every(call => operation(call, 'in', 'location_id')[2].length <= 200));
  assert(s.gameReads().every(call => operation(call, 'range')[1] === 0), 'each bounded ID chunk starts at page zero');
});

test('a raw saved field ID searches games even when absent from the active location catalog', async () => {
  const s = setup({ games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.deepEqual(operation(s.gameReads()[0], 'in', 'location_id'), ['in', 'location_id', ['historic']]);
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
  assert.deepEqual(operation(s.gameReads()[0], 'eq', 'league_id'), ['eq', 'league_id', 'allowed-league']);
  assert.deepEqual(operation(s.gameReads()[0], 'eq', 'level_id'), ['eq', 'level_id', 'u16']);
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
  assert(!s.reads.some(call => call.kind === 'rpc'));
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
    require, exports: {}, range: 'custom', customDate: '2026-10-22', showCalendar: true,
    dayFilter: ['2026-10-22'], timeFilter: ['15:00'], locationFilter: [token('North'), 'historic'],
    officialFilter: 'official', leagueFilter: 'allowed-league', levelFilter: 'u16', completenessFilter: ['partial'],
    unpublishedOnly: true, selfAssignOnly: true, replacementOnly: true,
    selected: 'selected-game', linkSelected: ['bulk-game'], error: '', notice: '',
    saved: [], loadCount: 0, window: { prompt: () => '  North venues  ' },
  };
  for (const name of ['Range', 'CustomDate', 'ShowCalendar', 'DayFilter', 'TimeFilter', 'LocationFilter', 'OfficialFilter', 'LeagueFilter', 'LevelFilter', 'CompletenessFilter', 'UnpublishedOnly', 'SelfAssignOnly', 'ReplacementOnly', 'Selected', 'LinkSelected', 'Error', 'Notice']) {
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
    assert(call.operations.findIndex(([method]) => method === 'or') < call.operations.findIndex(([method]) => method === 'range'));
  }
});
