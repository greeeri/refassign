const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const css = fs.readFileSync('app/assignment-center-upgrades.css', 'utf8');
const ast = ts.createSourceFile('AssignmentsManagerV2.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionSource(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, `Missing production function ${name}`);
  return found;
}
function setup() {
  const state = {
    expandedGameIds: new Set(), selected: 'game-a', selectedVisibleGameIds: [],
    unpublishedCount: 0, game: { game_number: 'A' }, overrideOfficial: 'keep', confirms: 0,
    linkSelected: ['bulk-only'], assignments: [], positions: [], officials: [], mentorSlots: [], gameStatusOptions: [],
    officialDropGame: '', draggingOfficial: '', canManage: false, linking: false, bulkWorking: false,
    pickedOfficial: '', Set, require, exports: {},
    boundCalendarReview: () => null,
    assignmentCompleteness: () => ({ detail: 'Open', color: '#000', label: 'Open' }),
    staffingCounts: () => ({ filled: 0, total: 3, open: 3 }),
    normalizeGameStatus: value => value,
    selfAssignOpenCount: () => 0, gameHoldReason: () => '',
    gamePower: () => 1, deadlineState: () => ({ label: 'On time', color: '#000' }),
    formatEventDate: () => 'Oct 22', formatEventTime: () => '3:30 PM',
  };
  state.setExpandedGameIds = update => { state.expandedGameIds = update(state.expandedGameIds); };
  state.setSelected = value => { state.selected = value; };
  state.setOverrideOfficial = value => { state.overrideOfficial = value; };
  state.window = { confirm: () => { state.confirms++; return state.allowSwitch !== false; } };
  const names = ['toggleGameExpanded', 'closeGameDetails', 'toggleSelectedDetails', 'requestSelectedGame', 'assignmentPositionsForGame', 'renderGameRow'];
  vm.runInNewContext(ts.transpileModule(names.map(functionSource).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, state);
  return state;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
const game = id => ({ id, game_number: id, status: 'active', home: { name: 'Home' }, away: { name: 'Away' }, levels: { name: 'U16' } });

test('two games can expand independently and repeated collapse leaves the other open', () => {
  const s = setup();
  s.toggleGameExpanded('game-a');
  const first = s.expandedGameIds;
  s.toggleGameExpanded('game-b');
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
  assert.deepEqual([...first], ['game-a'], 'updates do not mutate previous state');
  s.toggleGameExpanded('game-a');
  assert.deepEqual([...s.expandedGameIds], ['game-b']);
  s.toggleGameExpanded('game-a');
  assert.deepEqual([...s.expandedGameIds], ['game-b', 'game-a']);
  assert.equal(s.selected, 'game-a', 'visibility does not change active editing context');
  assert.deepEqual(s.linkSelected, ['bulk-only'], 'visibility does not change bulk selection');
  assert.equal(s.confirms, 0);
});

test('bulk open and close only affect selected visible games', () => {
  const s = setup();
  s.expandedGameIds = new Set(['other-open', 'game-a']);
  s.selectedVisibleGameIds = ['game-a', 'game-b'];
  s.toggleSelectedDetails();
  assert.deepEqual([...s.expandedGameIds], ['other-open', 'game-a', 'game-b']);
  s.toggleSelectedDetails();
  assert.deepEqual([...s.expandedGameIds], ['other-open']);
  s.selectedVisibleGameIds = [];
  s.toggleSelectedDetails();
  assert.deepEqual([...s.expandedGameIds], ['other-open']);
});

test('opening full details keeps other games open and honors the unpublished-assignment guard', () => {
  const s = setup();
  s.expandedGameIds = new Set(['game-a']);
  s.unpublishedCount = 2;
  s.allowSwitch = false;
  s.requestSelectedGame('game-b');
  assert.equal(s.selected, 'game-a');
  assert.deepEqual([...s.expandedGameIds], ['game-a']);
  s.allowSwitch = true;
  s.requestSelectedGame('game-b');
  assert.equal(s.selected, 'game-b');
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
  assert.equal(s.confirms, 2);
  s.closeGameDetails('game-b');
  assert.equal(s.selected, '');
  assert.deepEqual([...s.expandedGameIds], ['game-a']);
  assert.deepEqual(s.linkSelected, ['bulk-only']);
});

test('reopening a collapsed active game restores details without changing another card', () => {
  const s = setup();
  s.expandedGameIds = new Set(['game-b']);
  s.unpublishedCount = 1;
  s.requestSelectedGame('game-a');
  assert.deepEqual([...s.expandedGameIds], ['game-b', 'game-a']);
  assert.equal(s.confirms, 0, 'same active game does not require a switch confirmation');
});

test('production row renders a native accessible toggle with exactly three chevrons', () => {
  const s = setup();
  const render = () => nodes(s.renderGameRow(game('game-a'), false, false));
  const toggle = () => render().find(node => node.props?.className === 'assignmentGameCollapse');
  let button = toggle();
  assert.equal(button.type, 'button');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-expanded'], false);
  assert.equal(button.props['aria-controls'], 'assignment-game-details-game-a');
  assert.equal(button.props['aria-label'], 'Expand game game-a');
  const svg = nodes(button).find(node => node.type === 'svg');
  assert.equal(svg.props['aria-hidden'], 'true');
  const path = nodes(svg).find(node => node.type === 'path');
  assert.equal((path.props.d.match(/m/gi) || []).length, 3);
  let stopped = false;
  button.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  button = toggle();
  assert.equal(button.props['aria-expanded'], true);
  assert.equal(button.props['aria-label'], 'Collapse game game-a');
  assert.equal(s.selected, 'game-a');
  assert.deepEqual(s.linkSelected, ['bulk-only']);
});

test('both responsive layouts share stable game-ID visibility and keep full editors gated', () => {
  assert.match(source, /id=\{`assignment-game-details-\$\{listedGame\.id\}`\}/);
  assert.match(source, /hidden=\{!expandedGameIds\.has\(listedGame\.id\)\}/);
  assert.match(source, /expandedGameIds\.has\(listedGame\.id\) && selected === listedGame\.id/);
  assert.match(source, /expandedGameIds\.has\(game\.id\) &&\s+inlineAssignmentHost &&/);
  assert.match(source, /setExpandedGameIds\(new Set\(\)\)/, 'organization changes reset card visibility');
  assert.match(css, /\.assignmentGameRow > \.assignmentGameCollapse\s*\{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  assert.match(css, /\.assignmentGameCollapse\[aria-expanded="true"\] \.assignmentGameChevrons \{ transform: rotate\(180deg\); \}/);
  assert.match(css, /\.assignmentGameCollapse:focus-visible/);
});


test('expanded crew includes extra mentor slots without duplicating regular positions', () => {
  const s = setup();
  s.positions = [
    { id: 'ref', sport_id: 'soccer', sort_order: 1 },
    { id: 'ar', sport_id: 'soccer', sort_order: 2 },
    { id: 'mentor', sport_id: 'soccer', sort_order: 3 },
  ];
  s.mentorSlots = [{ game_id: 'game-a', position_id: 'mentor' }, { game_id: 'game-b', position_id: 'ar' }];
  assert.deepEqual(Array.from(s.assignmentPositionsForGame({ id: 'game-a', sport_id: 'soccer', officials_needed: 2 }), p => p.id), ['ref', 'ar', 'mentor']);
  assert.deepEqual(Array.from(s.assignmentPositionsForGame({ id: 'game-b', sport_id: 'soccer', officials_needed: 2 }), p => p.id), ['ref', 'ar']);
  assert.match(source, /assignment && positionPayDetails\(listedGame.id, position.id, assignment\)/, 'unloaded unassigned fees are not reported as missing');
  assert(!css.includes('.assignmentGameRow>button:hover~.assignmentStatusCell'));
});
