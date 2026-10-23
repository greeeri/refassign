const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), { module, exports: module.exports, Set, Map, require: name => dependencies[name] || require(name) });
  return module.exports;
}
const paging = load('lib/supabase/readAll.ts');
const personalRoster = load('lib/assignments/personalRoster.ts', { '../supabase/readAll': paging });
const { assignmentCandidateLeagueScope, isLeagueCandidate, loadAssignmentOfficialRoster } = load('lib/assignments/candidateRoster.ts', { '../supabase/readAll': paging, './personalRoster': personalRoster });
const copy = value => JSON.parse(JSON.stringify(value));
const official = (id, leagues = [], changes = {}) => ({ id, first_name: id, last_name: 'Official', active: true, leagues, ...changes });
function setup({ officials = [], links = officials.map(row => ({ organization_id: 'org', official_id: row.id, active: true })), fail, personalIds = null, rosterError = null } = {}) {
  const calls = [];
  const client = { rpc(name) {
    if (name === 'get_personal_roster_state') return Promise.resolve({ data: { enabled: personalIds !== null, owner_wide: false, prepared: true, can_manage: true }, error: rosterError });
    const q = { order() { return q; }, range(from, to) { return Promise.resolve({ data: (personalIds || []).slice(from, to + 1).map(official_id => ({official_id})), error: null }); } }; return q;
  }, from(table) {
    const call = { table, operations: [] }; calls.push(call);
    const query = { then(resolve, reject) {
      const error = fail?.(call);
      if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
      let rows = table === 'organization_officials'
        ? links.map(link => ({ ...link, officials: officials.find(row => row.id === link.official_id) }))
        : officials.slice();
      const selected = call.operations.find(([method]) => method === 'select')[1];
      for (const [method, column, value] of call.operations) {
        const field = row => column === 'officials.active' ? row.officials?.active : row[column];
        if (method === 'eq') rows = rows.filter(row => field(row) === value);
        if (method === 'in' && column.endsWith('official_league_eligibility.league_id')) {
          assert(selected.includes('official_league_eligibility!inner(league_id)'), 'eligibility is an inner join, not a client-side-only filter');
          if (table === 'organization_officials') assert(selected.includes('officials!inner('));
          rows = rows.filter(row => (row.officials || row).leagues.some(league => value.includes(league)));
        } else if (method === 'in') rows = rows.filter(row => value.includes(field(row)));
      }
      const orders = call.operations.filter(([method]) => method === 'order');
      rows.sort((left, right) => {
        for (const [, column] of orders) {
          const diff = String(left[column]).localeCompare(String(right[column])); if (diff) return diff;
        }
        return 0;
      });
      const range = call.operations.find(([method]) => method === 'range');
      assert(range, 'every candidate/profile request is ranged');
      return Promise.resolve({ data: rows.slice(range[1], range[2] + 1), error: null }).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'in', 'order', 'range']) query[method] = (...args) => { call.operations.push(copy([method, ...args])); return query; };
    return query;
  } };
  return { client, calls };
}
const candidateIds = result => Array.from(result.candidateIds).sort();
const ids = result => Array.from(result.data || [], row => row.id).sort();
const op = (call, method, field) => call.operations.find(([m, f]) => m === method && f === field);

test('no selected league scopes queries to the loaded game leagues, deduplicated and sorted', () => {
  assert.deepEqual(copy(assignmentCandidateLeagueScope([{ league_id: 'b' }, { league_id: 'a' }, { league_id: 'b' }])), ['a', 'b']);
  assert.deepEqual(copy(assignmentCandidateLeagueScope([])), []);
  assert.equal(assignmentCandidateLeagueScope([{ league_id: null }]), null);
  assert.equal(assignmentCandidateLeagueScope([{ league_id: 'a' }, { league_id: null }]), null);
});

test('one league filters organization roster at query time and preserves organization/active scope', async () => {
  const t = setup({ officials: [official('eligible', ['a']), official('wrong-league', ['b']), official('no-eligibility'), official('inactive', ['a'], { active: false }), official('foreign', ['a']), official('inactive-link', ['a'])], links: [
    ...['eligible', 'wrong-league', 'no-eligibility', 'inactive'].map(id => ({ organization_id: 'org', official_id: id, active: true })),
    { organization_id: 'other', official_id: 'foreign', active: true }, { organization_id: 'org', official_id: 'inactive-link', active: false },
  ] });
  const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], []);
  assert.deepEqual(candidateIds(result), ['eligible']); assert.deepEqual(ids(result), ['eligible']);
  const query = t.calls[0];
  for (const [field, value] of [['organization_id', 'org'], ['active', true], ['officials.active', true]]) assert.equal(op(query, 'eq', field)[2], value);
  assert.deepEqual(op(query, 'in', 'officials.official_league_eligibility.league_id')[2], ['a']);
  assert.equal(t.calls.length, 1, 'wrong-league officials are not downloaded by another profile query');
});

test('multiple loaded leagues form a query union but active/linked game candidate lists require each target league', async () => {
  const t = setup({ officials: [official('a-only', ['a']), official('b-only', ['b']), official('both', ['a', 'b']), official('neither')] });
  const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a', 'b'], []);
  assert.deepEqual(candidateIds(result), ['a-only', 'b-only', 'both']);
  const eligibility = result.data.flatMap(row => row.leagues.map(league_id => ({ official_id: row.id, league_id })));
  const candidates = new Set(result.candidateIds);
  const select = targets => copy(result.data.filter(row => isLeagueCandidate(row.id, targets, candidates, eligibility)).map(row => row.id).sort());
  assert.deepEqual(select([{ league_id: 'a' }]), ['a-only', 'both']);
  assert.deepEqual(select([{ league_id: 'b' }]), ['b-only', 'both']);
  assert.deepEqual(select([{ league_id: 'a' }, { league_id: 'b' }]), ['both']);
  assert.deepEqual(select([]), []);
});

test('existing assigned but now ineligible/inactive officials remain display-only, never candidate fallback', async () => {
  const t = setup({ officials: [official('eligible', ['a']), official('previous', ['b'], { active: false }), official('unrelated', ['b'])] });
  const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], ['eligible', 'previous', 'previous']);
  assert.deepEqual(ids(result), ['eligible', 'previous']); assert.deepEqual(candidateIds(result), ['eligible']);
  assert.deepEqual(op(t.calls[1], 'in', 'id')[2], ['previous']);
  assert.equal(isLeagueCandidate('previous', [{ league_id: null }], new Set(result.candidateIds), []), false);
  assert.equal(result.data.find(row => row.id === 'previous').first_name, 'previous');
});

test('empty eligible league and empty game page do not fall back to the full roster', async () => {
  for (const leagueIds of [['missing'], []]) {
    const t = setup({ officials: [official('wrong', ['a']), official('assigned', ['a'])] });
    const result = await loadAssignmentOfficialRoster(t.client, 'org', leagueIds, ['assigned']);
    assert.deepEqual(candidateIds(result), []); assert.deepEqual(ids(result), ['assigned']);
    assert.equal(t.calls.filter(call => call.table === 'organization_officials').length, leagueIds.length ? 1 : 0);
    for (const call of t.calls.filter(call => call.table === 'officials')) assert.deepEqual(op(call, 'in', 'id')[2], ['assigned']);
  }
});

test('actual league-less games retain the unrestricted active roster, including officials with no league row', async () => {
  const t = setup({ officials: [official('none'), official('other', ['b']), official('inactive', [], { active: false })] });
  const result = await loadAssignmentOfficialRoster(t.client, 'org', null, []);
  assert.deepEqual(candidateIds(result), ['none', 'other']);
  assert.equal(t.calls[0].operations.some(([method]) => method === 'in'), false);
  assert.equal(isLeagueCandidate('none', [{ league_id: null }], new Set(result.candidateIds), []), true);
  assert.equal(isLeagueCandidate('none', [{ league_id: 'a' }], new Set(result.candidateIds), []), false);
});

test('legacy non-organization query still requires explicit league eligibility', async () => {
  const t = setup({ officials: [official('eligible', ['a']), official('none')] });
  const result = await loadAssignmentOfficialRoster(t.client, undefined, ['a'], []);
  assert.deepEqual(candidateIds(result), ['eligible']);
  assert.deepEqual(op(t.calls[0], 'in', 'official_league_eligibility.league_id')[2], ['a']);
});

test('more than one response page is complete and assigned display IDs are bounded in chunks', async () => {
  const rows = Array.from({ length: 1002 }, (_, index) => official(`eligible-${String(index).padStart(4, '0')}`, ['a']));
  const assigned = Array.from({ length: 205 }, (_, index) => official(`old-${index}`));
  const t = setup({ officials: [...rows, ...assigned] });
  const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], assigned.map(row => row.id));
  assert.equal(result.candidateIds.length, 1002); assert.equal(result.data.length, 1207);
  assert.deepEqual(t.calls.filter(call => call.table === 'officials').map(call => op(call, 'in', 'id')[2].length), [200, 5]);
});

test('roster or assigned-profile error fails closed without a fallback query', async () => {
  for (const failedTable of ['organization_officials', 'officials']) {
    const t = setup({ officials: [official('previous')], fail: call => call.table === failedTable ? { message: 'denied' } : null });
    const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], ['previous']);
    assert.equal(result.error.message, 'denied'); assert.equal(result.data, null); assert.deepEqual(candidateIds(result), []);
    assert.equal(t.calls.length, failedTable === 'organization_officials' ? 1 : 2);
  }
});

const component = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const ast = ts.createSourceFile('AssignmentsManagerV2.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) { let found; function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); } visit(ast); assert(found); return found; }
const fn = name => find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const variable = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).getText(ast);

test('candidate, sidebar, bulk and crew search use league-only gates; existing warning overrides remain', () => {
  assert(fn('candidates').includes('return leagueCandidates(linkedAssignmentGames())'));
  assert(variable('availableOfficialsBase').includes('leagueCandidates(linkedAssignmentGames())'));
  assert(variable('ineligibleOfficials').includes('leagueCandidates(linkedAssignmentGames())'));
  assert(variable('officialAssessments').includes('leagueCandidates(review.targets)'));
  assert(fn('crewCandidatesForSlot').includes('return leagueCandidates([target])'));
  const runtime = { officials: [official('level-warning', ['a']), official('wrong-league', ['b'])], game: { id: 'game', league_id: 'a', location: null }, assignments: [], canManage: true,
    candidateOfficialIds: new Set(['level-warning', 'wrong-league']), leagueElig: [{ official_id: 'level-warning', league_id: 'a' }, { official_id: 'wrong-league', league_id: 'b' }], isLeagueCandidate,
    eligible: () => false, linkedAssignmentGames: () => [{ league_id: 'a' }], isMentor: () => false, positionRanks: {}, miles: () => null, positionRankFor: () => 5,
    conflictingAssignedGamesForGame: () => [], ineligibleReasons: () => ['Not eligible as Center for level Varsity Boys', 'Availability block'], candidateScheduleConflicts: new Set(),
  };
  vm.runInNewContext(compile(`${fn('leagueCandidates')}\n${fn('candidates')}\nresult = candidates({id: 'center'});`), runtime);
  assert.deepEqual(copy(runtime.result.map(row => row.id)), ['level-warning']);
  assert.deepEqual(copy(runtime.result[0].reasons), ['Not eligible as Center for level Varsity Boys', 'Availability block']);
});

 test('personal roster intersects candidates at query time but retains assigned display identities', async () => {
  const t = setup({officials: [official('mine', ['a']), official('other', ['a']), official('old', ['a'])], personalIds: ['mine']});
  const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], ['old']);
  assert.deepEqual(candidateIds(result), ['mine']); assert.deepEqual(ids(result), ['mine', 'old']);
  assert.deepEqual(op(t.calls[0], 'in', 'official_id')[2], ['mine']);
});
test('empty personal roster never falls back and failed scope never downloads profiles', async () => {
  for (const options of [{personalIds: []}, {rosterError: {message: 'Cannot verify'}}]) {
    const t = setup({officials: [official('other', ['a'])], ...options});
    const result = await loadAssignmentOfficialRoster(t.client, 'org', ['a'], []);
    assert.deepEqual(candidateIds(result), []); assert.equal(t.calls.length, 0);
    assert.equal(Boolean(result.error), Boolean(options.rosterError));
  }
});
