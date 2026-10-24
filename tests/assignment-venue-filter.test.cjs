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
  vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), { module, exports: module.exports, require: name => name === '../supabase/readAll' ? loadModule('lib/supabase/readAll.ts') : name === './venueFilter' ? loadModule('lib/assignments/venueFilter.ts') : require(name) });
  return module.exports;
}
const summaryResult=(total,openGames=total)=>({data:{total,openGames},error:null});
const copy = value => JSON.parse(JSON.stringify(value));
const venue = loadModule('lib/assignments/venueFilter.ts');
const paging = { ...loadModule('lib/supabase/readAll.ts'), ...loadModule('lib/assignments/boundedGamePage.ts') };
const scope = loadModule('components/leagueGameScope.ts');
const directory = loadModule('lib/assignments/venueDirectory.ts');
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
const firstPaintEnd = loadStatements.findIndex(statement => statement.getText(ast).includes('logLoadMilestone("first page ready")'));
assert(firstPaintEnd > gamePromiseIndex, 'First page must publish before related reads');
const loadQuerySource = `async function runLoadQuery() {\n${loadStatements.slice(0, firstPaintEnd + 1).map(statement => statement.getText(ast)).join('\n')}\nglobalThis.completeVenueDirectory = loadVenueDirectory; return g;\n}`;

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
    ...paging, ...venue, ...scope, ...loadModule('lib/assignments/matchingGames.ts'), ...directory,
    organizationId: 'selected-org', accessibleLeagueIds: ['allowed-league'], fullLeagueAccess: false,
    range: 'all', customDate: '', fromDate: '', toDate: '', locationFilter: [], dayFilter: [], timeFilter: [], officialFilter: '', leagueFilter: '', levelFilter: '',
    totalsLoading: false, venueDirectory: {organizationId:'selected-org',fields:[],complexes:{}}, unpublishedOnly: false, selfAssignOnly: false, replacementOnly: false, completenessFilter: [], focusGameId: undefined,
    venueDirectoryCache: { current: null }, matchingTotalsRequest: { current: null }, gamePaging: { current: { key: '', page: 1, asOf: '2026-10-23T00:00:00Z' } }, loadVersion: { current: 0 }, candidateCache: { current: null }, allowedGameAccess: [], canManage: true, allowedLeagueIds: null, error: '', games: ['old-game'], initialGamesReady: false,
    performance: { now: () => 0 }, document: { documentElement: { clientWidth: 1440 } }, console: { info() {} },
    ...(options.explicitDateScope ? {range:'custom',customDate:'2099-10-22'} : {}),
    ...options.state,
  };
  state.leagueScopeKey = state.fullLeagueAccess ? 'full' : scope.leagueGameAccessKey(options.access || [{ league_id:'allowed-league',all_locations:true,location_ids:[] }]);
  Object.defineProperty(state, 'venueDirectoryScopeKey', { get: () => JSON.stringify([state.organizationId, state.leagueFilter, state.leagueScopeKey]) });
  for (const name of ['LocationFilter', 'Selected', 'PageDetailsReady', 'CandidatePositionId', 'UnassignedSlotKeys', 'CheckedInAssignmentIds', 'TotalsLoading', 'MatchingTotals', 'TotalsError', 'GamePageNumber', 'GamePageHasMore', 'LinkSelected', 'SelfAssignSelected', 'ExpandedGameIds', 'Error', 'CanManage', 'AllowedLeagueIds', 'AllowedGameAccess', 'VenueDirectory', 'Games', 'InitialGamesReady', 'Officials', 'CandidateOfficialIds', 'Assignments', 'Blocks', 'Ranks', 'PositionRanks', 'Powers', 'TeamSuggestions', 'LeagueElig', 'LevelElig', 'CandidateScheduleConflicts', 'LinkGroups', 'LinkMembers', 'AssignmentTemplates', 'SelfAssignSlots', 'MentorSlots']) {
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
        let rows = name === 'get_assignment_venue_directory_v2' ? (() => {
          const games = tables.games.filter(row => row.organization_id === parameters.p_organization_id && row.archived_at === null && row.location_id &&
            (!parameters.p_league_id || row.league_id === parameters.p_league_id) &&
            (state.fullLeagueAccess || tables.organization_member_league_access.some(a => a.organization_id === state.organizationId && a.user_id === 'current-user' && a.league_id === row.league_id && (a.all_locations || a.location_ids.includes(row.location_id)))));
          return [...new Set(games.map(g => g.location_id))].map(location_id => ({ location_id,
            name: tables.locations.find(f => f.id === location_id)?.name || games.find(g => g.location_id === location_id).location.name,
            field_complex: tables.get_organization_field_complexes.find(c => c.location_id === location_id)?.field_complex || null,
            ...(options.parentVenues?.[location_id] || {}) }));
        })() : (tables[name] || []).slice();
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
        const override = options.queryOverride?.(call, state, { data: rows, error: null });
        return Promise.resolve(override || { data: rows, error: null }).then(resolve, reject);
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
      if (name === 'get_assignment_matching_game_page' || name === 'get_assignment_game_summary') {
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
        if (f.range === 'all' && f.focusGameId) rows = rows.filter(row => row.id === f.focusGameId);
        else if (f.range === 'all' && f.days.length) rows = rows.filter(row => f.days.includes(row.starts_at.slice(0,10)));
        else if (f.range === 'all' && f.todayForward && !f.replacementOnly && !f.completeness.includes('attention')) rows = rows.filter(row => row.starts_at.slice(0,10) >= f.asOf.slice(0,10));
        else if (!explicit) rows = rows.filter(row => row.starts_at >= f.asOf);
        rows.sort((a,b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
        const error = options.fail?.(call); if (error) return Promise.resolve({ data: null, error });
        if (options.rpcOverride) { const result = options.rpcOverride(call, state); if (result) return result; }
        if (name.endsWith('_summary')) return Promise.resolve(summaryResult(rows.length,rows.filter(row=>!options.filledGameIds?.includes(row.id)).length));
        const start = (parameters.p_page - 1) * parameters.p_page_size;
        return Promise.resolve({ data: rows.slice(start, start + parameters.p_page_size).map(row => ({ game_id: row.id })), error: null });
      }
      return query('rpc', name, parameters);
    },
  };
  vm.runInNewContext(compile(loadQuerySource), state);
  return { state, reads, calls, runDirectory: async (finishCriticalLoad = false) => { const result = await state.runLoadQuery(); if (result) await state.completeVenueDirectory(); if(finishCriticalLoad) state.matchingTotalsRequest.current?.start?.(); await new Promise(resolve => setImmediate(resolve)); return result; }, run: async (finishCriticalLoad = false) => { const result = await state.runLoadQuery(); if(finishCriticalLoad) state.matchingTotalsRequest.current?.start?.(); await new Promise(resolve => setImmediate(resolve)); return result; }, gameReads: () => reads.filter(call => call.name === 'games'), pageReads: () => reads.filter(call => call.name === 'get_assignment_matching_game_page') };
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
test('scoped directory pages past 1,000 rows with names and discovers fields beyond the initial 50 games', async () => {
 const games=Array.from({length:1005},(_,i)=>game(i,id(i)));
 const complexes=games.map(g=>({location_id:g.location_id,field_complex:g.id===game(1004,id(1004)).id?'Late Complex':'Other'}));
 const s=setup({games,complexes,state:{locationFilter:[token('Late Complex')]}});
 assert.deepEqual(resultIds(await s.run()),[game(1004,id(1004)).id]);
 assert.equal(s.state.venueDirectory.fields.length,1005);
 const reads=s.reads.filter(c=>c.name==='get_assignment_venue_directory_v2');
 assert.deepEqual(reads.map(c=>operation(c,'range').slice(1)),[[0,999],[1000,1999]]);
 assert(reads.every(c=>c.parameters.p_organization_id==='selected-org'&&c.parameters.p_league_id===null));
 assert(!s.calls.some(c=>c.name==='locations'||c.name==='get_organization_field_complexes'||c.name==='get_organization_locations'));
});

test('ordinary assignors fetch only schedule-used grouped and ungrouped field names', async () => {
 const s=setup({roles:['assignor'],fields:[{id:'member',name:'North Field'},{id:'ungrouped',name:'Solo Field'},{id:'foreign',name:'Foreign Secret Field'}],
 complexes:[{location_id:'member',field_complex:'North'},{location_id:'ungrouped',field_complex:null},{location_id:'unused',field_complex:'Unused'}],
 games:[game(1,'member'),game(2,'ungrouped')],state:{locationFilter:[token('North')]}});
 assert.deepEqual(resultIds(await s.run()),['game-00001']);
 assert.deepEqual(s.state.venueDirectory.fields,[{id:'member',name:'North Field'},{id:'ungrouped',name:'Solo Field'}]);
 assert.deepEqual(s.state.venueDirectory.complexes,{member:'North'});
 assert.equal(s.reads.filter(c=>c.name==='get_assignment_venue_directory_v2').length,1);
 assert(!s.calls.some(c=>c.name==='locations'||c.name==='get_organization_field_complexes'));
});

test('an empty membership catalog never falls back to an unrestricted location-directory read', async () => {
  const s = setup({ fields: [{ id: 'foreign', name: 'Foreign Secret Field' }], complexes: [] });
  await s.run();
  assert.deepEqual(s.state.venueDirectory.fields, []);
  assert(!s.calls.some(call => call.name === 'locations' || call.name === 'get_organization_locations'));
});

test('initial view stays capped at 50 and complex filter retains today-forward window', async () => {
  const games = Array.from({ length: 85 }, (_, index) => game(index, index < 60 ? 'other' : 'member'));
  games.push(game(100, 'member', { starts_at: '2000-01-01T00:00:00.000Z' }));
  const shared = { games, complexes: [{ location_id: 'member', field_complex: 'North' }] };
  const initial = setup(shared);
  assert.equal((await initial.run()).data.length, 50);
  assert.equal(operation(initial.gameReads()[0], 'in', 'id')[2].length, 50);
  assert.equal(initial.pageReads()[0].parameters.p_filters.range, 'all');
  const filtered = setup({ ...shared, state: { locationFilter: [token('North')] } });
  const result = await filtered.run();
  assert.equal(result.data.length, 25);
  assert(!resultIds(result).includes('game-00100'));
  assert(result.data.every(row => row.location_id === 'member'));
  assert.equal(operation(filtered.gameReads()[0], 'gte', 'starts_at'), undefined);
  assert.equal(operation(filtered.gameReads()[0], 'in', 'id')[2].length, 25);
});

test('production complex filters select server IDs before bounded hydration and preserve scope', async () => {
  const games = Array.from({ length: 1005 }, (_, index) => game(index, 'member')).reverse();
  games.push(game(2000, 'member', { organization_id: 'foreign-org' }), game(2001, 'member', { league_id: 'blocked-league' }), game(2002, 'member', { archived_at: '2026-01-01' }), game(2003, 'same-venue-not-member'));
  const s = setup({explicitDateScope:true, games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')] } });
  const result = await s.run(true); assert.equal(result.data.length, 50); assert.equal(new Set(resultIds(result)).size, 50);
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
  const s = setup({explicitDateScope:true, complexes, games, state: { locationFilter: [token('North'), id(0), token('South'), id(204), token('North')] } });
  const result = await s.run(true); assert.equal(result.data.length, 50); assert.equal(s.state.matchingTotals.total, 205);
  const requestedIds = s.pageReads()[0].parameters.p_filters.locationIds;
  assert.equal(requestedIds.length, 205); assert.equal(new Set(requestedIds).size, 205);
  assert.equal(s.gameReads().length, 1); assert.equal(operation(s.gameReads()[0], 'in', 'id')[2].length, 50);
});

test('a raw saved field ID searches games even when absent from the active location catalog', async () => {
  const s = setup({ games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.deepEqual(s.pageReads()[0].parameters.p_filters.locationIds, ['historic']);
});

test('invalid or unavailable choices are cleared before a replacement filter snapshot loads', async () => {
 for(const value of [token('Missing'),venue.complexVenueFilterValue('foreign-org','North'),'complex:','complex:selected-org:%ZZ','foreign-field']) {
 const s=setup({games:[game(1,'member')],complexes:[{location_id:'member',field_complex:'North'}],state:{locationFilter:[value]}});
 assert.equal(await s.run(),undefined);assert.deepEqual(s.state.locationFilter,[]);
 assert.equal(s.gameReads().length,0);assert.equal(s.pageReads().length,0);
 assert.deepEqual(resultIds(await s.run()),['game-00001']);
 }
});

test('explicit league and level filters intersect complex membership and existing allowed leagues', async () => {
  const games = [game(1, 'member'), game(2, 'member', { level_id: 'u18' }), game(3, 'member', { league_id: 'blocked-league' })];
  const s = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')], leagueFilter: 'allowed-league', levelFilter: 'u16' } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert.equal(s.pageReads()[0].parameters.p_filters.leagueId, 'allowed-league');
  assert.equal(s.pageReads()[0].parameters.p_filters.levelId, 'u16');
  const denied = setup({ games, complexes: [{ location_id: 'member', field_complex: 'North' }], state: { locationFilter: [token('North')], leagueFilter: 'blocked-league' } });
  assert.equal(await denied.run(), undefined); assert.deepEqual(denied.state.locationFilter, []);
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
  const s = setup({ complexes, games: complexes.map((c,i)=>game(i,c.location_id)), state: { locationFilter: [token('North')] }, fail: call => call.name === 'get_assignment_venue_directory_v2' && operation(call, 'range')?.[1] === 1000 && { message: 'Later membership page failed' } });
  assert.equal(await s.run(), undefined);
  assert.equal(s.state.error, 'Later membership page failed');
  assert.deepEqual(s.state.games, []);
  assert.equal(s.state.initialGamesReady, true);
  assert.equal(s.gameReads().length, 0);
});

test('a missing or failed scoped directory fails closed rather than fetching the old broad catalog', async () => {
 const s=setup({games:[game(1,'historic')],state:{locationFilter:['historic']},fail:c=>c.name==='get_assignment_venue_directory_v2'?{message:'Missing scoped directory'}:null});
 assert.equal(await s.run(),undefined);assert.equal(s.state.error,'Missing scoped directory');assert.equal(s.pageReads().length,0);
 assert(!s.calls.some(c=>c.name==='get_organization_field_complexes'||c.name==='locations'));
 assert.equal(s.state.venueDirectoryCache.current,null);
});

test('read-only schedule users use the same scoped directory without management RPCs', async () => {
  const s = setup({ roles: ['official'], games: [game(1, 'historic'), game(2, 'other')], state: { locationFilter: ['historic'] } });
  assert.deepEqual(resultIds(await s.run()), ['game-00001']);
  assert(!s.reads.some(call => call.name === 'get_organization_field_complexes'));
  assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id), ['historic','other']);
  assert(s.reads.some(call => call.name === 'get_assignment_venue_directory_v2'));
});

test('stale directory loads do not replace a newer organization catalog or launch game reads', async () => {
  let changed = false;
  const s = setup({ state: { locationFilter: [token('North')] }, onRead(call, state) {
    if (!changed && call.name === 'get_assignment_venue_directory_v2') { changed = true; state.loadVersion.current++; }
  } });
  assert.equal(await s.run(), undefined);
  assert.deepEqual(s.state.venueDirectory, { fields: [], complexes: {} });
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
  const declarations = ['venueDirectoryScopeKey', 'currentVenueDirectory', 'locationComplexes', 'venueLocationIds', 'venueFilterOptions'].map(name => findNode(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name));
  const state = {
    ...venue, organizationId: 'new-org', leagueFilter: '', leagueScopeKey:'full', locationFilter: [venue.complexVenueFilterValue('old-org', 'North')], games: [],
    venueDirectory: { organizationId: 'old-org', fields: [{ id: 'old-field', name: 'Old' }], complexes: { 'old-field': 'North' } },
  };
  vm.runInNewContext(compile(declarations.map(node => `globalThis.${node.name.getText(ast)} = ${node.initializer.getText(ast)};`).join('\n')), state);
  assert.deepEqual(copy(state.locationComplexes), {});
  assert.deepEqual(copy(state.venueLocationIds), []);
  assert.deepEqual(copy(state.venueFilterOptions), []);
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

test('explicit historical dates replacement or attention bypass today-forward while other filters retain the window', async () => {
  const games = Array.from({ length: 180 }, (_, index) => game(index, 'member', { starts_at: '2000-01-01T00:00:00Z' }));
  for (const filter of [ { leagueFilter: 'allowed-league' }, { levelFilter: 'u16' }, { officialFilter: 'ref' }, { range: 'custom', customDate: '2000-01-01' }, { dayFilter: ['2000-01-01'] }, { timeFilter: ['18:00'] }, { unpublishedOnly: true }, { selfAssignOnly: true }, { replacementOnly: true }, { completenessFilter: ['partial'] } ]) {
    const s = setup({ games, state: filter });
    const first = await s.run();
    const historical = filter.range === 'custom' || Boolean(filter.dayFilter?.length) || filter.replacementOnly || filter.completenessFilter?.includes('attention');
    if (!historical) { assert.equal(first.data.length,0,JSON.stringify(filter)); assert.equal(s.gameReads().length,0); continue; }
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
  const state = { gamePaging: { current: { page: 1 } }, totalPages: 3, venueDirectoryCache: { current: null }, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
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
  assert.match(functionSource('assignLinkedOfficial'), /window\.confirm\(`Assign to all[\s\S]*including[\s\S]*not shown on this page/);
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
  const state = { matchingTotalsRequest: { current: null }, loadVersion: { current: 0 }, venueDirectoryCache: { current: null }, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
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
  const s = setup({explicitDateScope:true, games, matchingOfficialIds: games.slice(75).map(row => row.id), state: { officialFilter: 'ref-only-on-later-page' } });
  const first = await s.run(true); assert.equal(first.data.length, 50); assert.equal(s.state.matchingTotals.total, 76);
  assert.equal(first.data[0].id, games[75].id); assert.equal(s.state.gamePageHasMore, true);
  s.state.gamePaging.current.page = 2; const second = await s.run(true); assert.equal(second.data.length, 26);
  assert.equal(s.state.gamePageHasMore, false);
});

test('matching page hydrates without waiting for slower totals and later totals complete navigation', async () => {
  let resolveTotals;
  const totals = new Promise(resolve => { resolveTotals = resolve; });
  const games = Array.from({ length: 80 }, (_, i) => game(i, 'member'));
  const s = setup({explicitDateScope:true, games, state: { leagueFilter: 'allowed-league' }, rpcOverride(call) {
    if (call.name.endsWith('_summary')) return totals;
  } });
  const result = await s.run(true);
  assert.equal(result.data.length, 50); assert.equal(s.state.matchingTotals, null);
  resolveTotals(summaryResult(80));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.state.matchingTotals.total, 80); assert.equal(s.state.gamePageHasMore, true);
});

test('stale totals response cannot replace current filter totals or next-page state', async () => {
  const pending = [];
  const s = setup({explicitDateScope:true, games: [game(1, 'member')], state: { leagueFilter: 'allowed-league' }, rpcOverride(call) {
    if (call.name.endsWith('_summary')) return new Promise(resolve => pending.push(resolve));
  } });
  await s.run(true); s.state.levelFilter = 'u16'; await s.run(true);
  const response = total => summaryResult(total);
  pending[1](response(1)); await new Promise(resolve => setImmediate(resolve));
  pending[0](response(1000)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.state.matchingTotals.total, 1); assert.equal(s.state.gamePageHasMore, false);
});

test('failed totals preserve a successful page and expose retry state instead of false zero', async () => {
  const s = setup({explicitDateScope:true, games: [game(1, 'member')], fail: call => call.name.endsWith('_summary') ? { message: 'Counts offline' } : null });
  assert.equal((await s.run(true)).data.length, 1);
  assert.equal(s.state.matchingTotals, null); assert.equal(s.state.totalsError, 'Counts offline');
});

test('page RPC failure or oversized response never triggers unrestricted hydration', async () => {
  for (const oversized of [false, true]) {
    const s = setup({ games: Array.from({ length: 80 }, (_, i) => game(i, 'member')), rpcOverride(call) {
      if (call.name.endsWith('_page')) return Promise.resolve(oversized
        ? { data: Array.from({ length: 51 }, (_, i) => ({ game_id: `game-${i}` })), error: null }
        : { data: null, error: { message: 'Page offline' } });
    } });
    await s.run(); assert(s.state.error); assert.equal(s.gameReads().length, 0);
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
  const state = { gamePaging: { current: { page: 2 } }, totalPages: 8, venueDirectoryCache: { current: null }, gamePageLoadingRef: { current: false }, gamePageActionBusy: false };
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
 const s=setup({explicitDateScope:true,games:Array.from({length:120},(_,i)=>game(i,'member'))});
 await s.run(true);
 const original=s.state.matchingTotals;
 for(const page of [2,3,1]) {s.state.gamePaging.current.page=page;await s.run(true);assert.deepEqual(s.state.matchingTotals,original);assert.equal(s.state.gamePageHasMore,page<3);}
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_page')).length,4);
 assert(functionSource('changeGamePage').includes('load(true, true)'));
});

test('pending counts survive page generations without duplicate RPC and use current page', async () => {
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const s=setup({explicitDateScope:true,games:Array.from({length:120},(_,i)=>game(i,'member')),rpcOverride(call){if(call.name.endsWith('_summary'))return pending;}});
 await s.run(true);s.state.gamePaging.current.page=3;await s.run(true);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);
 finish(summaryResult(120));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.state.matchingTotals.total,120);assert.equal(s.state.gamePageHasMore,false);
});

test('non-page load invalidates counts immediately for mutations filters Undo and Retry', async () => {
 const code=functionSource('load');const state={matchingTotalsRequest:{current:{key:'old',totals:{total:120}}},loadVersion:{current:0},venueDirectoryCache:{current:null},gamePageLoadingRef:{current:false}};
 for(const name of new Set(code.match(/\bset[A-Z]\w+/g)))state[name]=value=>{state[name.slice(3)]=value;};
 state.loadPage=async()=>{state.loadVersion.current++;};vm.runInNewContext(compile(code),state);
 const old=state.matchingTotalsRequest.current;await state.load(true,true);assert.equal(state.matchingTotalsRequest.current,old);
 await state.load(true);assert.equal(state.matchingTotalsRequest.current,null);assert.equal(state.MatchingTotals,null);
 state.matchingTotalsRequest.current=old;await state.load();assert.equal(state.matchingTotalsRequest.current,null);
 assert.equal((source.match(/load\(true, true\)/g)||[]).length,1,'only page navigation opts into reuse');
});

test('scope revocation cancels pending counts before their late response', async()=>{
 let finish;const access=[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]}];
 const s=setup({explicitDateScope:true,access,games:[game(1,'member')],rpcOverride(call){if(call.name.endsWith('_summary'))return new Promise(resolve=>{finish=resolve;});}});
 await s.run(true);access.splice(0);await s.run(true);
 assert.equal(s.state.matchingTotalsRequest.current,null);
 finish(summaryResult(999));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.state.matchingTotals.total,0);
 assert(functionSource('loadPage').includes('matchingTotalsRequest.current = null; setMatchingTotals(null)'));
});


test('explicit retry invalidates failed count request while a page retry never hides successful counts', async()=>{
 let fail=true;const s=setup({explicitDateScope:true,games:[game(1,'member')],fail:call=>fail&&call.name.endsWith('_summary')?{message:'offline'}:null});
 await s.run(true);assert.equal(s.state.totalsError,'offline');
 const code=functionSource('load');s.state.gamePageLoadingRef={current:false};
 for(const name of ['GamePageLoading'])s.state[`set${name}`]=value=>{s.state[name]=value;};
 s.state.loadPage=s.run;vm.runInNewContext(compile(code),s.state);
 fail=false;await s.state.load(true);s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.state.matchingTotals.total,1);assert.equal(s.state.totalsError,'');
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,2);
 await s.state.load(true,true);assert.equal(s.state.matchingTotals.total,1);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,2);
});


test('lost login or auth error on navigation cancels pending counts even for owner-wide access', async()=>{
 for(const authError of [null,{message:'Auth unavailable'}]) {
  let finish;const s=setup({explicitDateScope:true,state:{fullLeagueAccess:true},games:[game(1,'member')],rpcOverride(call){if(call.name.endsWith('_summary'))return new Promise(resolve=>{finish=resolve;});}});
  await s.run(true);s.state.supabase.auth.getUser=async()=>({data:{user:null},error:authError});await s.run(true);
  assert.equal(s.state.matchingTotalsRequest.current,null);assert.equal(s.state.matchingTotals,null);assert.deepEqual(s.state.games,[]);
  finish(summaryResult(999));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(s.state.matchingTotals,null);
 }
});


test('page loading unlocks before automatic nonblocking two-field summary',async()=>{
 const events=[];let finish;
 const state={matchingTotalsRequest:{current:{start:()=>events.push('counts started')}},loadVersion:{current:0},venueDirectoryCache:{current:null},gamePageLoadingRef:{current:false}};
 for(const name of new Set(functionSource('load').match(/\bset[A-Z]\w+/g)))state[name]=value=>{if(name==='setGamePageLoading'&&!value)events.push('page unlocked');};
 state.loadPage=()=>{state.loadVersion.current++;events.push('hydration started');return new Promise(resolve=>{finish=resolve;});};
 vm.runInNewContext(compile(functionSource('load')),state);
 const loading=state.load(true,true);assert.deepEqual(events,['hydration started']);
 events.push('hydration finished');finish();await loading;
 assert.deepEqual(events,['hydration started','hydration finished','page unlocked','counts started']);
});

test('totals are not issued during page hydration and empty pages still start them afterward',async()=>{
 for(const games of [[],[game(1,'member')]]){
  const s=setup({explicitDateScope:true,games});await s.state.runLoadQuery();
  assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,0);
  assert.equal(typeof s.state.matchingTotalsRequest.current.start,'function');
  s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);
  assert.equal(s.state.matchingTotals.total,games.length);
 }
});

test('stale deferred count starter never issues an RPC after filter identity changes',async()=>{
 const s=setup({explicitDateScope:true,games:[game(1,'member')]});await s.state.runLoadQuery();
 const oldStart=s.state.matchingTotalsRequest.current.start;
 s.state.levelFilter='u16';await s.state.runLoadQuery();oldStart();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,0);
 s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);
});


test('same-key page load reuses a not-yet-started count callback exactly once',async()=>{
 const s=setup({explicitDateScope:true,games:Array.from({length:80},(_,i)=>game(i,'member'))});await s.state.runLoadQuery();
 const start=s.state.matchingTotalsRequest.current.start;
 s.state.gamePaging.current.page=2;await s.state.runLoadQuery();assert.equal(s.state.matchingTotalsRequest.current.start,start);
 start();start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);assert.equal(s.state.gamePageHasMore,false);
});

test('scope invalidation between scheduled start and RPC suppresses even the request',async()=>{
 const s=setup({explicitDateScope:true,games:[game(1,'member')]});await s.state.runLoadQuery();
 s.state.matchingTotalsRequest.current.start();s.state.matchingTotalsRequest.current=null;
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,0);
});

test('hydration rejection preserves page error and unlocks before starting current counts',async()=>{
 const events=[];const state={matchingTotalsRequest:{current:{start:()=>events.push('counts')}},loadVersion:{current:0},venueDirectoryCache:{current:null},gamePageLoadingRef:{current:false}};
 for(const name of new Set(functionSource('load').match(/\bset[A-Z]\w+/g)))state[name]=value=>{state[name.slice(3)]=value;};
 state.loadPage=async()=>{state.loadVersion.current++;throw new Error('hydrate failed');};
 vm.runInNewContext(compile(functionSource('load')),state);await state.load(true,true);
 assert.equal(state.Error,'Unable to load games.');assert.equal(state.gamePageLoadingRef.current,false);assert.deepEqual(events,['counts']);
});


test('default page publishes at most 50 today-and-future games without totals or directory requests',async()=>{
 const today=new Date().toISOString().slice(0,10);
 const games=[game(999,'member',{starts_at:'2000-01-01T00:00:00Z'}),game(1,'member',{starts_at:`${today}T00:00:00Z`}),...Array.from({length:70},(_,i)=>game(i+2,'member'))];
 const s=setup({games,state:{leagueFilter:'allowed-league'}});const before=Date.now();const first=await s.run();
 assert.equal(first.data.length,50);assert.equal(first.data[0].id,'game-00001');assert(!resultIds(first).includes('game-00999'));
 assert.deepEqual(s.state.games.map(g=>g.id),resultIds(first));assert.equal(s.state.initialGamesReady,true);assert.equal(s.state.canManage,false);
 assert.equal(s.state.gamePageHasMore,true);assert.equal(s.state.matchingTotals,null);
 assert(!s.calls.some(c=>c.name.endsWith('_summary')||c.name==='get_organization_field_complexes'||c.name==='get_assignment_venue_directory_v2'||c.name==='audit_history'||c.name==='assignments'));
 const f=s.pageReads()[0].parameters.p_filters;assert.equal(f.todayForward,true);assert(Date.parse(f.asOf)>=before&&Date.parse(f.asOf)<=Date.now(),'asOf stays actual now, not day boundary');
 s.state.gamePaging.current.page=2;const second=await s.run();assert.equal(second.data.length,21);assert.equal(s.state.gamePageHasMore,false);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,0);
});

test('historical concrete-day and exact-focus intent survives todayForward and league filters',async()=>{
 const old=game(1,'member',{starts_at:'2000-01-01T15:00:00Z'}),other=game(2,'member');
 for(const filter of [{dayFilter:['2000-01-01']},{focusGameId:old.id}]){
  const s=setup({games:[old,other],state:{leagueFilter:'allowed-league',...filter}});const result=await s.run();
  assert.deepEqual(resultIds(result),[old.id]);assert.equal(s.pageReads()[0].parameters.p_filters.todayForward,true);
 }
});

test('unknown automatic summary never invents total pages and remains bottom-only',()=>{
 const pager=functionSource('renderGamePagination');assert(!pager.includes('Load totals'));assert(pager.includes('totalPages !== null'));
 assert.equal((source.match(/\{renderGamePagination\(\)\}/g)||[]).length,1);
 assert(pager.includes('!totalPages'),'Last requires known totals');
 assert(functionSource('load').includes('current?.start?.()'),'load starts automatic summary after critical readiness');
});

test('early visible game cannot assign while management or hydration readiness is false',async()=>{
 const code=functionSource('assignToGame');
 for(const canManage of [false,true]){
  const state={canManage,gamePageLoadingRef:{current:true}};
  vm.runInNewContext(compile(code),state);
  await state.assignToGame(game(1,'member'),'position','official');
 }
 const state={canManage:false,gamePageLoadingRef:{current:false}};
 vm.runInNewContext(compile(code),state);await state.assignToGame(game(1,'member'),'position','official');
});

function fullLoadSetup(options={}) {
 const s=setup(options);const st=s.state;
 Object.assign(st,{gamePageLoadingRef:{current:false},setTimeout,leagueScopeKey:'allowed-league',sortMode:'date',linkSelected:[],selfAssignSelected:[],selected:'',
  gamePower:()=>1,assignmentCandidateLeagueScope:()=>['allowed-league'],
  loadAssignmentOfficialRoster:options.roster || (async()=>({data:[],candidateIds:[],error:null})),loadCandidateScheduleConflicts:async()=>null});
 for(const name of new Set((functionSource('loadPage')+functionSource('load')).match(/\bset[A-Z]\w+/g))){
  if(name==='setTimeout')continue;const key=name[3].toLowerCase()+name.slice(4);
  st[name]=value=>{st[key]=typeof value==='function'?value(st[key]??[]):value;};
 }
 vm.runInNewContext(compile(functionSource('loadPage')+'\n'+functionSource('load')),st);
 return {...s,full:(...args)=>st.load(...args)};
}

test('full loader exposes bounded page before slow roster and never enables mutation until readiness',async()=>{
 let release,started;const atRoster=new Promise(resolve=>{started=resolve;});
 const s=fullLoadSetup({games:[game(1,'member')],roster:()=>{started();return new Promise(resolve=>{release=resolve;});}});
 const pending=s.full();await atRoster;
 assert.equal(s.state.games.length,1);assert.equal(s.state.initialGamesReady,true);assert.equal(s.state.canManage,false);
 assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,0);
 release({data:[],candidateIds:[],error:null});await pending;assert.equal(s.state.canManage,true);
});

test('stale delayed roster success or error cannot mutate a replacement page or enable actions',async()=>{
 for(const error of [null,{message:'old roster failed'}]){
  let release,started;const atRoster=new Promise(resolve=>{started=resolve;});
  const s=fullLoadSetup({games:[game(1,'member')],roster:()=>{started();return new Promise(resolve=>{release=resolve;});}});
  const pending=s.full();await atRoster;s.state.loadVersion.current++;s.state.games=[game(9,'new-scope')];s.state.error='new page';
  release({data:[],candidateIds:[],error});await pending;
  assert.equal(s.state.games[0].id,'game-00009');assert.equal(s.state.error,'new page');assert.equal(s.state.canManage,false);
 }
});

test('automatic summary uses the same today-forward snapshot and retries after invalidation',async()=>{
 let fail=true;const s=setup({games:[game(999,'member',{starts_at:'2000-01-01T00:00:00Z'}),...Array.from({length:51},(_,i)=>game(i,'member'))],fail:call=>fail&&call.name.endsWith('_summary')?{message:'counts offline'}:null});
 await s.run();assert.equal(s.state.matchingTotals,null);assert.equal(s.state.gamePageHasMore,true);
 const pageFilter=s.pageReads()[0].parameters.p_filters;s.state.matchingTotalsRequest.current.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.state.totalsError,'counts offline');assert.equal(s.state.games.length,50);assert.equal(s.state.totalsLoading,false);
 fail=false;s.state.matchingTotalsRequest.current=null;await s.run(true);
 assert.equal(s.state.matchingTotals.total,51);assert.equal(s.state.totalsLoading,false);assert.equal(s.pageReads().length,2);
 assert.deepEqual(s.calls.find(c=>c.name.endsWith('_summary')).parameters.p_filters,pageFilter);
 s.state.gamePaging.current.page=2;await s.run();assert.equal(s.state.games.length,1);assert.equal(s.state.gamePageHasMore,false);
});

test('missing assignment details show loading or unavailable rather than false unassigned',()=>{
 const state={pageDetailsReady:false,gamePageLoading:true};vm.runInNewContext(compile(functionSource('assignmentCompleteness')),state);
 assert.equal(state.assignmentCompleteness(game(1,'member')).key,'loading');assert.match(state.assignmentCompleteness(game(1,'member')).label,/Loading/);
 state.gamePageLoading=false;assert.match(state.assignmentCompleteness(game(1,'member')).label,/unavailable/i);
 const row=functionSource('renderGameRow');assert(row.includes('pageDetailsReady && positions.filter'));assert(row.includes('pageDetailsReady && <><span className="assignmentStaffingCount"'));
});

test('supporting-read errors retain the first page but leave details and mutation disabled',async()=>{
 for(const failed of ['assignments','audit_history','sport_positions']){
  const s=fullLoadSetup({games:[game(1,'member')],fail:call=>call.name===failed?{message:`${failed} unavailable`}:null});await s.full();
  assert.equal(s.state.games.length,1);assert.equal(s.state.initialGamesReady,true);assert.equal(s.state.pageDetailsReady,false);assert.equal(s.state.canManage,false);assert.match(s.state.error,/unavailable/);
  assert.equal(s.calls.filter(c=>c.name.endsWith('_summary')).length,1);
 }
});

const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('one automatic two-field summary stays pending while assignments are actionable and pagination reuses it',async()=>{
 let finish;const s=fullLoadSetup({games:Array.from({length:151},(_,i)=>game(i,'member')),rpcOverride(call){if(call.name==='get_assignment_game_summary')return new Promise(resolve=>{finish=resolve;});}});
 await s.full();assert.equal(s.state.canManage,true);assert.equal(s.state.pageDetailsReady,true);assert.equal(s.state.gamePageLoading,false);assert.equal(s.state.totalsLoading,true);assert.equal(s.state.matchingTotals,null);
 const initial=s.calls.find(c=>c.name==='get_assignment_game_summary');assert(initial);assert.deepEqual(Object.keys(initial.parameters).sort(),['p_filters','p_organization_id']);
 s.state.gamePaging.current.page=2;await s.full(true,true);
 assert.equal(s.calls.filter(c=>c.name==='get_assignment_game_summary').length,1);assert.equal(s.state.canManage,true);
 finish(summaryResult(151,37));await flush();assert.deepEqual(copy(s.state.matchingTotals),{total:151,openGames:37});assert.equal(s.state.totalsLoading,false);assert.equal(s.state.gamePageHasMore,true);
 s.state.gamePaging.current.page=4;await s.full(true,true);assert.equal(s.state.games.length,1);assert.equal(s.state.gamePageHasMore,false);
 assert.equal(s.calls.filter(c=>c.name==='get_assignment_game_summary').length,1);
 assert(!s.calls.some(c=>c.name==='get_assignment_matching_game_totals'||c.name==='get_assignment_matching_game_totals_batch'));
});

test('summary identity invalidates on filter mutation auth grant and unmount changes',async()=>{
 for(const reason of ['filter','mutation','auth','grants','unmount']){
  const access=[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]}];const pending=[];
  const s=fullLoadSetup({access,games:[game(1,'member')],rpcOverride(call){if(call.name==='get_assignment_game_summary')return new Promise(resolve=>pending.push(resolve));}});
  await s.full();assert.equal(pending.length,1);
  if(reason==='filter'){s.state.levelFilter='changed';await s.full();}
  if(reason==='mutation')await s.full(true);
  if(reason==='auth'){s.state.supabase.auth.getUser=async()=>({data:{user:null},error:null});await s.full(true,true);}
  if(reason==='grants'){access.splice(0);await s.full(true,true);}
  if(reason==='unmount'){
   const cleanup=findNode(node=>ts.isArrowFunction(node)&&node.body.getText(ast).startsWith('{ loadVersion.current++; candidateCache.current = null;'));
   vm.runInNewContext(compile(`(${cleanup.getText(ast)})();`),s.state);
  }
  pending[0](summaryResult(999,998));await flush();assert.notEqual(s.state.matchingTotals?.total,999,reason);
  if(reason==='filter'||reason==='mutation'){pending[1](summaryResult(2,1));await flush();assert.deepEqual(copy(s.state.matchingTotals),{total:2,openGames:1});}
 }
});

test('failed or invalid summary leaves the page actionable without false zero or page-triggered refetch',async()=>{
 for(const result of [{data:null,error:{message:'timeout'}},summaryResult(10,11),{data:{total:10},error:null}]){
  const s=fullLoadSetup({games:Array.from({length:101},(_,i)=>game(i,'member')),rpcOverride(call){if(call.name==='get_assignment_game_summary')return Promise.resolve(result);}});
  await s.full();await flush();assert.equal(s.state.matchingTotals,null);assert.equal(s.state.totalsLoading,false);assert.equal(s.state.canManage,true);assert.equal(s.state.pageDetailsReady,true);assert.equal(s.state.games.length,50);assert(s.state.totalsError);
  s.state.gamePaging.current.page=2;await s.full(true,true);assert.equal(s.calls.filter(c=>c.name==='get_assignment_game_summary').length,1);assert.equal(s.state.canManage,true);
 }
});

test('only total games and games with open positions are rendered as aggregate counters',()=>{
 const pager=functionSource('renderGamePagination');assert(pager.includes('matchingTotals.total'));assert(pager.includes('matchingTotals.openGames'));assert(!pager.includes('Load totals'));
 for(const field of ['ranges','completeness','queue','unpublished','selfAssign','replacement','allStatuses'])assert(!new RegExp(`matchingTotals\\??\\.${field}`).test(source),field);
 for(const label of ['Replacement needed','Unassigned games','Awaiting response','Not published','Open for Self Assign','All Assignment Statuses'])assert(source.includes(label),label);
 assert(!source.includes('get_assignment_matching_game_totals_batch'));assert(!source.includes('get_assignment_matching_game_totals"'));
});

test('default summary excludes history while explicitly selected Replacement or Attention retains historical intent',async()=>{
 const old=game(1,'member',{starts_at:'2000-01-01T12:00:00Z'}),future=game(2,'member');
 for(const filters of [{},{leagueFilter:'allowed-league'},{replacementOnly:true},{completenessFilter:['attention']}]){
  const s=fullLoadSetup({games:[old,future],state:filters});await s.full();await flush();
  const expected=filters.replacementOnly||filters.completenessFilter?.includes('attention')?2:1;
  assert.equal(s.state.matchingTotals.total,expected);assert.equal(s.state.games.length,expected);
  const page=s.pageReads()[0].parameters.p_filters,summary=s.calls.find(c=>c.name==='get_assignment_game_summary').parameters.p_filters;
  assert.deepEqual(summary,page);assert.equal(page.todayForward,true);
 }
});

test('league switching prunes old fields and complexes before table requests while retaining shared choices', async () => {
 const games=[game(1,'a'),game(2,'shared'),game(3,'b',{league_id:'league-b'}),game(4,'shared',{league_id:'league-b'}),game(5,'hidden',{league_id:'hidden'})];
 const complexes=[{location_id:'a',field_complex:'Only A'},{location_id:'shared',field_complex:'Shared'},{location_id:'b',field_complex:'Only B'}];
 const s=setup({games,complexes,state:{fullLeagueAccess:true,leagueFilter:'allowed-league',locationFilter:['a',token('Only A'),'shared',token('Shared')]}});
 await s.runDirectory();assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a','shared']);
 const before=s.pageReads().length;
 s.state.leagueFilter='league-b';assert.equal(await s.runDirectory(),undefined);
 assert.equal(s.pageReads().length,before,'no obsolete table snapshot was sent');
 assert.deepEqual(s.state.locationFilter,['shared',token('Shared')]);
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['b','shared']);
 assert.deepEqual(resultIds(await s.runDirectory()),['game-00004']);
 assert.deepEqual(s.pageReads().at(-1).parameters.p_filters.locationIds,['shared']);
 s.state.leagueFilter='';s.state.locationFilter=[];await s.runDirectory();
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a','b','hidden','shared']);
});

test('all-leagues directory is an authorized pairwise union and same-named complexes never add other league children', async () => {
 const s=setup({games:[game(1,'a'),game(2,'b',{league_id:'league-b'}),game(3,'blocked-b',{league_id:'league-b'}),game(4,'hidden',{league_id:'hidden'})],
 complexes:['a','b','blocked-b','hidden'].map(location_id=>({location_id,field_complex:'Shared Name'})),
 access:[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]},{organization_id:'selected-org',user_id:'current-user',league_id:'league-b',all_locations:false,location_ids:['b']}],
 state:{locationFilter:[token('Shared Name')]}});
 assert.deepEqual(resultIds(await s.runDirectory()),['game-00001','game-00002']);
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a','b']);
 s.state.leagueFilter='league-b';await s.runDirectory();
 assert.deepEqual(s.state.venueDirectory.complexes,{b:'Shared Name'});
 assert.deepEqual(s.pageReads().at(-1).parameters.p_filters.locationIds,['b']);
});

test('page and unrelated filter changes reuse directory; auth/scope changes do not', async () => {
 const access=[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]}];
 const s=setup({games:[game(1,'a'),game(2,'b')],access});await s.runDirectory();
 s.state.gamePaging.current.page=2;await s.runDirectory();s.state.levelFilter='u16';await s.runDirectory();
 assert.equal(s.reads.filter(c=>c.name==='get_assignment_venue_directory_v2').length,1);
 access[0].all_locations=false;access[0].location_ids=['a'];await s.runDirectory();
 assert.equal(s.reads.filter(c=>c.name==='get_assignment_venue_directory_v2').length,2);
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a']);
 s.state.supabase.auth.getUser=async()=>({data:{user:null}});await s.runDirectory();
 assert.equal(s.state.venueDirectoryCache.current,null);assert.deepEqual(s.state.venueDirectory.fields,[]);
});

test('source directory includes historic and held games but skips archived and null fields', async()=>{
 const s=setup({games:[game(1,'past',{starts_at:'2000-01-01T00:00:00Z'}),game(2,'held',{venue_conflict_hold:true}),game(3,'archived',{archived_at:'2026-01-01'}),game(4,null)]});
 await s.runDirectory(true);assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['held','past']);
 assert.equal(s.state.matchingTotals.total,2,'upcoming table still includes null-field game');
});

test('scope-keyed directory presentation hides previous league options immediately, including old game rows',()=>{
 const declarations=['venueDirectoryScopeKey','currentVenueDirectory','locationComplexes','venueLocationIds','venueFilterOptions'].map(name=>findNode(node=>ts.isVariableDeclaration(node)&&node.name.getText(ast)===name));
 const state={...venue,organizationId:'selected-org',leagueFilter:'league-b',leagueScopeKey:'full',locationFilter:['old'],games:[{location:{id:'old',name:'Old'}}],venueDirectory:{scopeKey:JSON.stringify(['selected-org','league-a','full']),fields:[{id:'old',name:'Old'}],complexes:{old:'North'}}};
 vm.runInNewContext(compile(declarations.map(node=>`globalThis.${node.name.getText(ast)} = ${node.initializer.getText(ast)};`).join('\n')),state);
 assert.deepEqual(copy(state.venueFilterOptions),[]);assert.deepEqual(copy(state.locationComplexes),{});
});


test('late league A directory response cannot replace league B or start an obsolete table load', async()=>{
 let finishOld, oldRead;
 const reached=new Promise(resolve=>{oldRead=resolve;});
 const s=setup({state:{fullLeagueAccess:true,leagueFilter:'allowed-league',locationFilter:['a']},games:[game(1,'a'),game(2,'b',{league_id:'league-b'})],
 queryOverride(call,state,result){if(call.name==='get_assignment_venue_directory_v2'&&call.parameters.p_league_id==='allowed-league'){oldRead();return new Promise(resolve=>{finishOld=()=>resolve(result);});}}});
 const old=s.runDirectory();await reached;
 s.state.leagueFilter='league-b';s.state.locationFilter=['b'];await s.runDirectory();
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['b']);
 finishOld();assert.equal(await old,undefined);
 assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['b']);
 assert.equal(s.pageReads().length,1);assert.equal(s.pageReads()[0].parameters.p_filters.leagueId,'league-b');
});

test('directory cache is invalidated by ordinary schedule refresh and not by a page-only load', async()=>{
 const cached={key:'old'},state={venueDirectoryCache:{current:cached},matchingTotalsRequest:{current:null},loadVersion:{current:0},gamePageLoadingRef:{current:false}};
 for(const name of new Set(functionSource('load').match(/\bset[A-Z]\w+/g)))state[name]=()=>{};
 state.loadPage=async()=>{state.loadVersion.current++;};vm.runInNewContext(compile(functionSource('load')),state);
 await state.load(true,true);assert.equal(state.venueDirectoryCache.current,cached);
 await state.load();assert.equal(state.venueDirectoryCache.current,null);
 assert.match(source,/onSynced=\{\(\) => void load\(\)\}/);
 assert.match(source,/refreshAfterUndo = \(\) => \{ void load\(\)/);
 assert.match(functionSource('archiveCancelledGames'),/await load\(\)/);
});


test('freshly revoked location grants hide old directory while replacement is pending even when props lag', async()=>{
 let defer=false,finish,reached;
 const pending=new Promise(resolve=>{reached=resolve;});
 const access=[{organization_id:'selected-org',user_id:'current-user',league_id:'allowed-league',all_locations:true,location_ids:[]}];
 const s=setup({access,games:[game(1,'a'),game(2,'b')],queryOverride(call,state,result){if(defer&&call.name==='get_assignment_venue_directory_v2'){reached();return new Promise(resolve=>{finish=()=>resolve(result);});}}});
 await s.runDirectory();assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a','b']);
 const oldProps=s.state.leagueScopeKey;access[0].all_locations=false;access[0].location_ids=['a'];defer=true;
 const loading=s.runDirectory();await pending;
 assert.equal(s.state.leagueScopeKey,oldProps,'test props intentionally lag verified grants');
 assert.deepEqual(s.state.venueDirectory.fields,[],'unauthorized old fields disappear before replacement resolves');
 finish();await loading;assert.deepEqual(s.state.venueDirectory.fields.map(f=>f.id),['a']);
});

test('changed authenticated user hides prior directory during replacement even with full-access props',async()=>{
 let defer=false,finish,reached;const pending=new Promise(resolve=>{reached=resolve;});
 const s=setup({state:{fullLeagueAccess:true},games:[game(1,'a')],queryOverride(call,state,result){if(defer&&call.name==='get_assignment_venue_directory_v2'){reached();return new Promise(resolve=>{finish=()=>resolve(result);});}}});
 await s.runDirectory();s.state.supabase.auth.getUser=async()=>({data:{user:{id:'another-user'}}});defer=true;
 const loading=s.runDirectory();await pending;assert.deepEqual(s.state.venueDirectory.fields,[]);
 finish();await loading;assert.match(s.state.venueDirectoryCache.current.key,/another-user/);
});


test('thrown directory failure clears old presentation even when the same-key cache expires',async()=>{
 let reject=false;
 const s=setup({games:[game(1,'a')],queryOverride(call){if(reject&&call.name==='get_assignment_venue_directory_v2')return Promise.reject(new Error('offline'));}});
 await s.runDirectory();assert.equal(s.state.venueDirectory.fields.length,1);
 s.state.venueDirectoryCache.current.expiresAt=0;s.state.locationFilter=['a'];reject=true;
 assert.equal(await s.runDirectory(),undefined);assert.deepEqual(s.state.venueDirectory.fields,[]);
 assert.equal(s.state.venueDirectoryCache.current,null);assert(s.state.error);
});

test('production filter effect automatically reloads the pruned venue snapshot without duplicate obsolete table requests',async()=>{
 const s=setup({games:[game(1,'a')],state:{locationFilter:['old-field']}});
 const effect=findNode(node=>ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('if (initialFilterLoad.current)'));
 let lastDependencies,pending;
 s.state.initialFilterLoad={current:false};
 s.state.load=(...args)=>{assert.deepEqual(args,[true]);pending=s.runDirectory();};
 s.state.useEffect=(callback,dependencies)=>{if(!lastDependencies||dependencies.some((value,index)=>value!==lastDependencies[index])){lastDependencies=dependencies;callback();}};
 const renderEffect=()=>vm.runInNewContext(compile(effect.getText(ast)),s.state);
 renderEffect();await pending;
 assert.deepEqual(s.state.locationFilter,[]);assert.equal(s.pageReads().length,0);
 renderEffect();await pending;
 assert.equal(s.pageReads().length,1);assert.deepEqual(s.pageReads()[0].parameters.p_filters.locationIds,null);
 renderEffect();assert.equal(s.pageReads().length,1,'stable filters do not loop');
});

test('slow scoped directory never delays the first 50 rows, assignment readiness or automatic summary',async()=>{
 let finish;const s=fullLoadSetup({games:Array.from({length:55},(_,i)=>game(i,'member')),queryOverride(call,state,result){
  if(call.name==='get_assignment_venue_directory_v2')return new Promise(resolve=>{finish=()=>resolve(result);});
 }});
 await s.full();await flush();
 assert.equal(s.state.games.length,50);assert.equal(s.state.initialGamesReady,true);assert.equal(s.state.canManage,true);
 assert.equal(s.state.pageDetailsReady,true);assert.equal(s.calls.filter(c=>c.name==='get_assignment_game_summary').length,1);
 assert(s.calls.findIndex(c=>c.name==='get_assignment_matching_game_page')<s.calls.findIndex(c=>c.name==='get_assignment_venue_directory_v2'));
 assert.deepEqual(copy(s.state.venueDirectory.fields),[]);
 finish();await flush();assert.deepEqual(copy(s.state.venueDirectory.fields.map(f=>f.id)),['member']);
});

test('failed background directory preserves actionable page and summary without a broad fallback',async()=>{
 let finish;const s=fullLoadSetup({games:[game(1,'member')],queryOverride(call){
  if(call.name==='get_assignment_venue_directory_v2')return new Promise(resolve=>{finish=()=>resolve({data:null,error:{message:'directory unavailable'}});});
 }});
 await s.full();await flush();finish();await flush();
 assert.equal(s.state.games.length,1);assert.equal(s.state.canManage,true);assert.equal(s.state.pageDetailsReady,true);
 assert.equal(s.state.matchingTotals.total,1);assert.deepEqual(copy(s.state.venueDirectory.fields),[]);assert.equal(s.state.venueDirectoryCache.current,null);
 assert.equal(s.state.error,'directory unavailable');assert(!s.calls.some(c=>c.name==='get_organization_field_complexes'||c.name==='locations'));
});

test('late background catalog cannot replace the new league after both fast pages load',async()=>{
 let finishOld;const s=fullLoadSetup({state:{fullLeagueAccess:true,leagueFilter:'allowed-league'},games:[game(1,'a'),game(2,'b',{league_id:'league-b'})],queryOverride(call,state,result){
  if(call.name==='get_assignment_venue_directory_v2'&&call.parameters.p_league_id==='allowed-league')return new Promise(resolve=>{finishOld=()=>resolve(result);});
 }});
 await s.full();assert.equal(s.state.games[0].location_id,'a');
 s.state.leagueFilter='league-b';await s.full(true);await flush();
 assert.equal(s.state.games[0].location_id,'b');assert.deepEqual(copy(s.state.venueDirectory.fields.map(f=>f.id)),['b']);
 finishOld();await flush();assert.equal(s.state.games[0].location_id,'b');assert.deepEqual(copy(s.state.venueDirectory.fields.map(f=>f.id)),['b']);
 assert.equal(s.pageReads().length,2);assert.match(s.state.venueDirectoryCache.current.key,/league-b/);
});

test('same-scope page navigation coalesces pending background directory and keeps the newest generation',async()=>{
 let finish;const s=fullLoadSetup({games:Array.from({length:55},(_,i)=>game(i,'member')),queryOverride(call,state,result){
  if(call.name==='get_assignment_venue_directory_v2')return new Promise(resolve=>{finish=()=>resolve(result);});
 }});
 await s.full();s.state.gamePaging.current.page=2;await s.full(true,true);
 assert.equal(s.state.games.length,5);assert.equal(s.calls.filter(c=>c.name==='get_assignment_venue_directory_v2').length,1);
 finish();await flush();assert.deepEqual(copy(s.state.venueDirectory.fields.map(f=>f.id)),['member']);assert.equal(s.state.games.length,5);
});

test('explicit parents use IDs, keep same-named venues distinct, and never infer sibling membership', () => {
  const fields = [
    { id: 'a', name: 'Park - Field 1', venue_id: 'venue-a', venue_name: 'Park' },
    { id: 'b', name: 'Park - Field 2', venue_id: 'venue-b', venue_name: 'Park' },
    { id: 'c', name: 'Park - Field 3', venue_id: null, venue_name: null },
  ];
  const selected = [venue.venueFilterValue('venue-a')];
  assert.deepEqual(copy(venue.resolveVenueLocationIds(selected, 'org', {}, fields)), ['a']);
  const options = venue.assignmentVenueOptions('org', {}, fields, fields, selected);
  assert.equal(options.filter(([value]) => value === 'venue:venue-a').length, 1);
  assert.equal(options.filter(([value]) => value === 'venue:venue-b').length, 1);
  assert.equal(options.length, 5);
  fields[0].venue_name = 'Completely different name';
  assert.deepEqual(copy(venue.resolveVenueLocationIds(selected, 'org', {}, fields)), ['a']);
  assert(venue.assignmentVenueOptions('org', {}, fields, [], selected).some(([value, label]) => value === 'venue:venue-a' && label.includes('Completely different name')));
  assert.deepEqual(copy(venue.resolveVenueLocationIds(selected, 'org', {}, [])), []);
  assert.match(venue.assignmentVenueOptions('org', {}, [], [], selected)[0][1], /Unavailable venue/);
});

test('production loader expands a parent only to the authorized selected league fields', async () => {
  const s = setup({
    games: [game(1, 'a'), game(2, 'b'), game(3, 'foreign', { league_id: 'other' })],
    parentVenues: { a: { venue_id: 'v', venue_name: 'Park' }, b: { venue_id: 'other', venue_name: 'Park' }, foreign: { venue_id: 'v', venue_name: 'Park' } },
    state: { locationFilter: ['venue:v'], leagueFilter: 'allowed-league' },
  });
  await s.run();
  assert.deepEqual(s.state.games.map(g => g.location_id), ['a']);
  assert.deepEqual(s.state.locationFilter, ['venue:v']);
  assert(!s.state.venueDirectory.fields.some(f => f.id === 'foreign'));
});

test('saved parent absent from a new scope does not silently become unrestricted', async () => {
  const s = setup({ games: [game(1, 'a')], state: { locationFilter: ['venue:foreign'], leagueFilter: 'allowed-league' } });
  await s.run();
  assert.deepEqual(s.state.locationFilter, ['venue:foreign']);
  assert.deepEqual(s.state.games, []);
});

test('explicit venue selection on an empty league stays selected and returns no games', async () => {
  const s = setup({ games: [], state: { locationFilter: ['venue:v'], leagueFilter: 'allowed-league' } });
  await s.run();
  assert.deepEqual(s.state.venueDirectory.fields, []);
  assert.deepEqual(s.state.games, []);
  assert.deepEqual(s.state.locationFilter, ['venue:v']);
});
