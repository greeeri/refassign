const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const postcss = require('postcss');
const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const ast = ts.createSourceFile('AssignmentsManagerV2.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements = [];
const functions = new Map();
function visit(node) {
  if (ts.isJsxElement(node)) elements.push(node);
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(ast);
const attr = (node, name) => node.openingElement.attributes.properties.find(p => p.name?.text === name)?.initializer;
const toolbar = elements.find(node => attr(node, 'className')?.getText(ast).includes('`assignmentFilterPanel assignmentCompactToolbar'));
const chipsStart = source.indexOf('  const activeGameFilters:');
const chipsEnd = source.indexOf('  const attentionQueue =', chipsStart);
function setup(overrides = {}) {
  const state = {
    require, exports: {}, canManage: true, showMoreFilters: false, showCalendar: false,
    range: 'all', customDate: '', leagueFilter: '', levelFilter: '', officialFilter: '',
    locationFilter: [], dayFilter: [], timeFilter: [], completenessFilter: [],
    selfAssignOnly: false, unpublishedOnly: false, replacementOnly: false,
    selected: 'game-a', linkSelected: ['game-a'], overrideOfficial: 'official-a',
    expandedGameIds: new Set(['game-a', 'game-b']),
    leagueOptions: [{ id: 'league-a', name: 'High School – MISOA' }, { id: 'blocked', name: 'Not allowed' }],
    allowedLeagueIds: ['league-a'], venueFilterOptions: [['field-a', 'North Field'], ['field-b', 'South Field'], ['unavailable', 'Unavailable complex (clear to choose another)']],
    games: [{ id: 'game-a', starts_at: '2026-10-22T15:00:00Z', league_id: 'league-a', level_id: 'u16', levels: { name: 'U16' } }],
    officials: [{ id: 'official-a', first_name: 'Alex', last_name: 'Smith' }],
    assignments: [{ official_id: 'official-a', status: 'confirmed' }],
    selfAssignGameCount: 1, unpublishedFilteredCount: 1,
    savedViews: [{ id: 'view-a', name: 'Weekend', range: 'all', customDate: '', dayFilter: [], timeFilter: [], locationFilter: ['field-a'], leagueFilter: 'league-a', levelFilter: '', officialFilter: '', completenessFilter: [], selfAssignOnly: false, unpublishedOnly: false }],
    filters: [['all', 'All Games'], ['today', "Today's Games"], ['tomorrow', "Tomorrow's Games"], ['thisWeek', 'This Week'], ['nextWeek', 'Next Week']],
    eventTimeParts: (date) => ({ date: date.slice(0, 10), time: date.slice(11, 16) }),
    inRange: () => true, matchesOfficialFilter: () => true,
    saveCurrentView: () => {}, deleteSavedView: () => {}, setNotice: () => {},
    ...overrides,
  };
  for (const key of ['showMoreFilters', 'showCalendar', 'range', 'customDate', 'leagueFilter', 'levelFilter', 'officialFilter', 'locationFilter', 'dayFilter', 'timeFilter', 'completenessFilter', 'selfAssignOnly', 'unpublishedOnly', 'replacementOnly', 'selected', 'linkSelected', 'overrideOfficial']) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  Object.defineProperties(state, {
    hasDirectGameFilter: { get: () => Boolean(state.leagueFilter || state.levelFilter || state.officialFilter || state.locationFilter.length || state.dayFilter.length || state.timeFilter.length) },
    rangeGames: { get: () => state.games }, filteredGames: { get: () => state.games },
    activeGameFilters: { get: () => state.buildActiveGameFilters() },
  });
  const names = ['normalizeMultiFilter', 'MultiSelectGameFilter', 'chooseRange', 'chooseDate', 'toggleUnpublished', 'chooseCompleteness', 'toggleCompleteness', 'clearGameFilters', 'removeGameFilter', 'applySavedView'];
  const code = names.map(name => functions.get(name).getText(ast)).join('\n') +
    `\nfunction buildActiveGameFilters() { ${source.slice(chipsStart, chipsEnd)} return activeGameFilters; }` +
    `\nfunction renderToolbar() { return (${toolbar.getText(ast)}); }`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, state);
  return state;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  if (typeof node.type === 'function') return nodes(node.type(node.props));
  return [node, ...nodes(node.props?.children)];
}
const byClass = (s, name) => nodes(s.renderToolbar()).find(node => node.props.className?.split(' ').includes(name));
const byLabel = (s, name) => nodes(s.renderToolbar()).find(node => node.props['aria-label'] === name);
const snapshot = s => JSON.stringify(Object.fromEntries(['range', 'customDate', 'leagueFilter', 'levelFilter', 'officialFilter', 'locationFilter', 'dayFilter', 'timeFilter', 'completenessFilter', 'selfAssignOnly', 'unpublishedOnly', 'replacementOnly', 'selected', 'linkSelected'].map(key => [key, s[key]])));

test('primary groups are League, Venue, Calendar and the saved view controls stay paired', () => {
  const s = setup();
  const primary = nodes(byClass(s, 'assignmentPrimaryFilters'));
  const leagueIndex = primary.findIndex(node => node.props['aria-label'] === 'Show games in league');
  const venueIndex = primary.findIndex(node => node.props['aria-label'] === 'Filter by venue');
  const dateIndex = primary.findIndex(node => node.props['aria-label'] === 'Date range');
  assert(leagueIndex >= 0 && leagueIndex < venueIndex && venueIndex < dateIndex);
  assert(!primary.some(node => node.props['aria-label'] === 'Game view'));
  const saved = nodes(byClass(s, 'assignmentSavedViewControls'));
  assert(saved.some(node => node.props['aria-label'] === 'Open a saved view'));
  assert(saved.some(node => node.type === 'button' && node.props.onClick === s.saveCurrentView));
  assert(!nodes(byLabel(s, 'Show games in league')).some(node => node.props.value === 'blocked'));
});

test('More Filters changes disclosure only and the hidden advanced controls remain represented', () => {
  const s = setup({ levelFilter: 'u16', officialFilter: 'official-a', completenessFilter: ['awaiting'], unpublishedOnly: true });
  const before = snapshot(s);
  assert(nodes(s.renderToolbar()).find(node => node.props.id === 'assignment-advanced-filters').props.hidden);
  for (const label of ['Level: U16', 'Official: Smith, Alex', 'Status: Awaiting Confirmation', 'Not published']) assert(byLabel(s, `Remove ${label} filter`));
  const button = byClass(s, 'assignmentMoreFiltersButton');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-expanded'], false);
  button.props.onClick();
  assert.equal(byClass(s, 'assignmentMoreFiltersButton').props['aria-expanded'], true);
  assert.equal(nodes(s.renderToolbar()).find(node => node.props.id === 'assignment-advanced-filters').props.hidden, false);
  byClass(s, 'assignmentMoreFiltersButton').props.onClick();
  assert.equal(s.showMoreFilters, false);
  assert.equal(snapshot(s), before);
});

test('responsive disclosure triggers keep DOM keyboard order aligned with each visible layout', () => {
  const s = setup();
  const secondary = nodes(byClass(s, 'assignmentSecondaryFilters'));
  const mobile = secondary.findIndex(node => node.props.className?.includes('assignmentMoreFiltersMobile'));
  const fields = secondary.findIndex(node => node.props.id === 'assignment-secondary-fields');
  const desktop = secondary.findIndex(node => node.props.className?.includes('assignmentMoreFiltersDesktop'));
  const saved = secondary.findIndex(node => node.props.id === 'assignment-saved-view-controls');
  assert(mobile < fields && fields < desktop && desktop < saved);
  const css = postcss.parse(fs.readFileSync('app/assignment-center-responsive.css', 'utf8'));
  const displays = {};
  css.walkRules(rule => {
    if (!rule.selector.includes('assignmentMoreFiltersMobile') && !rule.selector.includes('assignmentMoreFiltersDesktop')) return;
    for (const decl of rule.nodes.filter(node => node.prop === 'display')) displays[`${rule.parent.type === 'atrule' ? rule.parent.params : 'default'}:${rule.selector}`] = decl.value;
  });
  assert.equal(displays['default:.assignmentSecondaryFilters > .assignmentMoreFiltersMobile'], 'none');
  assert.equal(displays['(max-width: 600px):.assignmentSecondaryFilters > .assignmentMoreFiltersDesktop'], 'none');
  assert.equal(displays['(max-width: 600px):.assignmentSecondaryFilters > .assignmentMoreFiltersMobile'], 'inline-flex');
  for (const buttonClass of ['assignmentMoreFiltersMobile', 'assignmentMoreFiltersDesktop']) {
    byClass(s, buttonClass).props.onClick();
    assert.equal(s.showMoreFilters, true);
    byClass(s, buttonClass).props.onClick();
    assert.equal(s.showMoreFilters, false);
  }
});

test('each chip removes only its own filter, clears stale selections, and preserves independent expansion', () => {
  const all = { leagueFilter: 'league-a', levelFilter: 'u16', officialFilter: 'official-a', locationFilter: ['field-a', 'field-b'], dayFilter: ['2026-10-22', '2026-10-23'], timeFilter: ['15:00', '16:00'], completenessFilter: ['partial', 'confirmed'], selfAssignOnly: true, unpublishedOnly: true, replacementOnly: true };
  const cases = [
    ['venue:field-a', 'locationFilter', ['field-b']], ['day:2026-10-22', 'dayFilter', ['2026-10-23']],
    ['time:15:00', 'timeFilter', ['16:00']], ['status:partial', 'completenessFilter', ['confirmed']],
    ['level', 'levelFilter', ''], ['official', 'officialFilter', ''], ['view', 'selfAssignOnly', false],
    ['unpublished', 'unpublishedOnly', false], ['replacement', 'replacementOnly', false],
  ];
  for (const [key, changed, expected] of cases) {
    const s = setup(all);
    const chip = s.activeGameFilters.find(filter => filter.key === key);
    byLabel(s, `Remove ${chip.label} filter`).props.onClick();
    assert.equal(JSON.stringify(s[changed]), JSON.stringify(expected), key);
    for (const other of Object.keys(all).filter(name => name !== changed)) assert.equal(JSON.stringify(s[other]), JSON.stringify(all[other]), `${key}: preserve ${other}`);
    assert.equal(s.selected, ''); assert.equal(s.linkSelected.length, 0); assert.equal(s.overrideOfficial, '');
    assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
  }
});

test('removing League also clears its dependent Level, matching the existing league selector', () => {
  const s = setup({ leagueFilter: 'league-a', levelFilter: 'u16', locationFilter: ['field-a'] });
  byLabel(s, 'Remove League: High School – MISOA filter').props.onClick();
  assert.equal(s.leagueFilter, ''); assert.equal(s.levelFilter, '');
  assert.deepEqual(s.locationFilter, ['field-a']);
});

test('only effective date ranges are active chips and direct-filter all-dates semantics are explained', () => {
  const s = setup({ range: 'custom', customDate: '2026-10-22' });
  assert(byLabel(s, 'Remove Date: 2026-10-22 filter'));
  s.leagueFilter = 'league-a';
  assert(!s.activeGameFilters.some(chip => chip.key === 'date'));
  assert(byClass(s, 'assignmentDateScopeNote').props.children.includes('all dates'));
  assert.equal(s.range, 'custom'); assert.equal(s.customDate, '2026-10-22');
  s.leagueFilter = '';
  byLabel(s, 'Remove Date: 2026-10-22 filter').props.onClick();
  assert.equal(s.range, 'all'); assert.equal(s.customDate, '');
});

test('Clear removes every active filter without resetting independent expanded game cards', () => {
  const s = setup({ range: 'custom', customDate: '2026-10-22', showCalendar: true, leagueFilter: 'league-a', levelFilter: 'u16', officialFilter: 'official-a', locationFilter: ['field-a'], dayFilter: ['2026-10-22'], timeFilter: ['15:00'], completenessFilter: ['partial'], unpublishedOnly: true, replacementOnly: true, selfAssignOnly: true });
  byClass(s, 'assignmentClearFilters').props.onClick();
  assert.equal(s.activeGameFilters.length, 0); assert.equal(s.range, 'all'); assert.equal(s.showCalendar, false);
  assert.equal(s.customDate, ''); assert.equal(s.selected, ''); assert.equal(s.linkSelected.length, 0);
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
  assert.equal(byClass(s, 'assignmentClearFilters'), undefined);
});

test('saved-view apply still works with disclosure closed and produces removable chips', () => {
  const s = setup();
  const event = { target: { value: 'view-a' } };
  byLabel(s, 'Open a saved view').props.onChange(event);
  assert.equal(event.target.value, '');
  assert.equal(s.showMoreFilters, false);
  assert(byLabel(s, 'Remove Venue: North Field filter'));
  assert(byLabel(s, 'Remove League: High School – MISOA filter'));
});

test('unavailable legacy venue values and malformed saved times are visible and removable without crashing', () => {
  const s = setup({ locationFilter: ['unavailable'], timeFilter: ['legacy-value'] });
  assert(byLabel(s, 'Remove Venue: Unavailable complex (clear to choose another) filter'));
  byLabel(s, 'Remove Time: legacy-value filter').props.onClick();
  assert.equal(s.timeFilter.length, 0);
});

test('non-managers retain their View, Venue, Day, Time and Calendar controls without hidden manager controls', () => {
  const s = setup({ canManage: false });
  for (const label of ['Game view', 'Filter by venue', 'Filter by day', 'Filter by time', 'Date range']) assert(byLabel(s, label));
  assert(!byClass(s, 'assignmentMoreFiltersButton'));
  assert(!s.renderToolbar().props.className.includes('hasAdvancedFilters'));
  assert(!byLabel(s, 'Show games in league'));
});

test('bounded-page guidance stays adjacent to results and explicitly limits counts and selection', () => {
  assert(!toolbar.getText(ast).includes('matching games from'));
  const notice = source.indexOf('<div className="assignmentResultsNotice" role="status">');
  const resultTable = source.indexOf('className="assignmentGameTable"', notice);
  assert(notice > toolbar.end && resultTable > notice);
  const guidance = source.slice(notice, resultTable);
  assert(guidance.includes('maximum 50'));
  assert(guidance.includes('Filters may leave fewer matches on a page'));
  assert(guidance.includes('Counts, sorting, selections and exports apply to this page only'));
  assert(guidance.includes('Previous 50 games') && guidance.includes('Next 50 games'));
  assert(source.includes('Select All on This Page'));
  assert(!source.includes('Select a filter to search beyond this list.'));
});

test('responsive groups use basic grids/flex, 44px controls, visible focus and phone disclosure without new fonts or palette', () => {
  const css = fs.readFileSync('app/assignment-center-responsive.css', 'utf8');
  const rules = postcss.parse(css);
  const phone = [];
  rules.walkAtRules('media', rule => { if (rule.params === '(max-width: 600px)') phone.push(rule.toString()); });
  assert(phone.join('').includes('.hasAdvancedFilters:not(.filtersExpanded) .assignmentSecondaryFields'));
  assert(phone.join('').includes('.hasAdvancedFilters:not(.filtersExpanded) .assignmentSavedViewControls'));
  assert(css.includes('.assignmentCompactToolbar summary { min-height: 44px; }'));
  assert(css.includes('button:focus-visible'));
  const toolbarStyles = css.slice(css.indexOf('/* Reuse'), css.indexOf('.assignmentCompactHead,'));
  assert(!toolbarStyles.includes('font-family'));
  const colors = [...toolbarStyles.matchAll(/#[\da-f]{3,8}/gi)].map(match => match[0]);
  const previousStyles = fs.readFileSync('app/assignment-center-upgrades.css', 'utf8');
  for (const color of colors) assert(previousStyles.includes(color), `reuse existing ${color}`);
});

module.exports = { setup, nodes };
