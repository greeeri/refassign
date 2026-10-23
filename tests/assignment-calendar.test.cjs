const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

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
const attr = (node, name) => node.openingElement.attributes.properties.find(attribute => attribute.name?.text === name)?.initializer?.text;
const calendar = elements.find(node => attr(node, 'className')?.includes('assignmentCalendarButton'));
const picker = elements.find(node => attr(node, 'className') === 'assignmentCustomDateRow');
const dateRange = elements.find(node => attr(node, 'aria-label') === 'Date range');
const calendarGroup = elements.find(node => attr(node, 'className') === 'assignmentCalendarGroup');
function setup() {
  assert(calendar, 'The production Calendar button is present');
  assert(picker, 'The existing Specific Date picker is present');
  const state = {
    require, exports: {}, showCalendar: false, range: 'all', customDate: '', fromDate: '', toDate: '', matchingTotals: null,
    selected: 'game-a', linkSelected: ['game-a'], overrideOfficial: 'official-a',
    expandedGameIds: new Set(['game-a', 'game-b']),
    locationFilter: ['field-a'], dayFilter: [], timeFilter: ['15:00'],
    leagueFilter: 'league-a', officialFilter: 'official-a',
    filteredGames: [], games: [], filters: [['all', 'All Games'], ['today', "Today's Games"]],
  };
  for (const name of ['showCalendar', 'range', 'customDate', 'fromDate', 'toDate', 'selected', 'linkSelected', 'overrideOfficial']) {
    state[`set${name[0].toUpperCase()}${name.slice(1)}`] = value => {
      state[name] = typeof value === 'function' ? value(state[name]) : value;
    };
  }
  const code = [
    functions.get('chooseDate').getText(ast),
    functions.get('chooseRange').getText(ast),
    `function renderCalendar() { return (${calendar.getText(ast)}); }`,
    `function renderPicker() { return showCalendar && (${picker.getText(ast)}); }`,
    `function renderDateRange() { return (${dateRange.getText(ast)}); }`,
    `function renderCalendarGroup() { return (${calendarGroup.getText(ast)}); }`,
  ].join('\n');
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, state);
  return state;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}

test('Calendar is a direct, accessible toolbar button next to Date, not a hidden manager action or new route', () => {
  const s = setup();
  assert.equal(calendar.parent, dateRange.parent.parent);
  assert.equal(attr(calendar.parent, 'className'), 'assignmentCalendarControls');
  assert.equal(attr(calendar.parent.parent, 'className'), 'assignmentCalendarGroup');
  assert(calendar.pos > dateRange.end);
  assert(calendar.end < picker.pos, 'the inline picker stays in the same calendar group');
  const button = s.renderCalendar();
  assert.equal(button.type, 'button');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props.children.trim(), 'Calendar');
  assert.equal(button.props['aria-expanded'], false);
  assert.equal(button.props['aria-controls'], attr(picker, 'id'));
  assert.equal(button.props.disabled, undefined, 'available even with no loaded games');
  assert.equal(button.props.href, undefined, 'reuses the inline picker, without navigation');
});

test('opening, closing, and repeated clicks toggle only the existing date picker', () => {
  const s = setup();
  assert.equal(s.renderPicker(), false);
  s.renderCalendar().props.onClick();
  assert.equal(s.renderCalendar().props['aria-expanded'], true);
  assert.equal(s.renderPicker().props.id, 'assignment-calendar-date-picker');
  assert.equal(s.range, 'all', 'opening does not switch to an empty date filter');
  assert.equal(s.selected, 'game-a');
  assert.deepEqual(s.linkSelected, ['game-a']);
  s.renderCalendar().props.onClick();
  assert.equal(s.renderPicker(), false);
  s.renderCalendar().props.onClick();
  assert.equal(s.showCalendar, true);
  nodes(s.renderPicker()).find(node => node.type === 'button' && node.props.children === 'Done').props.onClick();
  assert.equal(s.showCalendar, false);
  assert.equal(s.range, 'all');
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
});

test('selecting a date uses existing filters and Done or reopen retains the chosen date', () => {
  const s = setup();
  s.renderCalendar().props.onClick();
  nodes(s.renderPicker()).find(node => node.type === 'input').props.onChange({ target: { value: '2026-11-05' } });
  assert.equal(s.customDate, '2026-11-05');
  assert.equal(s.range, 'custom');
  assert.equal(s.selected, '');
  assert.equal(s.linkSelected.length, 0);
  assert.equal(s.overrideOfficial, '');
  assert.deepEqual(s.locationFilter, ['field-a']);
  assert.deepEqual(s.timeFilter, ['15:00']);
  assert.equal(s.leagueFilter, 'league-a');
  assert.equal(s.officialFilter, 'official-a');
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
  nodes(s.renderPicker()).find(node => node.type === 'button').props.onClick();
  assert.equal(s.range, 'custom');
  s.renderCalendar().props.onClick();
  assert.equal(nodes(s.renderPicker()).find(node => node.type === 'input').props.value, '2026-11-05');
});

test('the Date dropdown remains an alternative and preset ranges close the calendar', () => {
  const s = setup();
  s.renderDateRange().props.onChange({ target: { value: 'custom' } });
  assert.equal(s.showCalendar, true);
  assert.equal(s.range, 'custom');
  s.renderDateRange().props.onChange({ target: { value: 'today' } });
  assert.equal(s.showCalendar, false);
  assert.equal(s.range, 'today');
  assert.deepEqual([...s.expandedGameIds], ['game-a', 'game-b']);
});

test('default and preset ranges do not render unsolicited date fields', () => {
  const s = setup();
  // Render the production group, including its actual visibility conditions.
  // Rendering extracted inputs alone would miss an unconditional From/To row.
  const dateInputs = () => nodes(s.renderCalendarGroup()).filter(node => node.type === 'input' && node.props.type === 'date');
  assert.equal(dateInputs().length, 0, 'All Games initially keeps the calendar controls closed');
  s.matchingTotals = { ranges: { all: 921, today: 0 } };
  assert.equal(dateInputs().length, 0, 'loading counts does not open date controls');
  for (const range of ['all', 'today', 'tomorrow', 'thisWeek', 'nextWeek']) {
    s.renderDateRange().props.onChange({ target: { value: range } });
    assert.equal(dateInputs().length, 0, `${range} keeps date controls closed`);
  }
  s.renderCalendar().props.onClick();
  assert.equal(dateInputs().length, 1, 'Calendar only opens the existing Specific Date input');
  nodes(s.renderCalendarGroup()).find(node => node.type === 'button' && node.props.children === 'Done').props.onClick();
  assert.equal(dateInputs().length, 0, 'Done hides date controls');
});

test('From/To fields appear only for the selected date-range mode and still update the range', () => {
  const s = setup();
  const input = label => nodes(s.renderCalendarGroup()).find(node => node.type === 'input' && node.props['aria-label'] === label);
  s.renderDateRange().props.onChange({ target: { value: 'dateRange' } });
  assert.equal(s.range, 'dateRange');
  assert.equal(s.showCalendar, false, 'choosing a range does not open the Specific Date picker');
  assert.equal(input('From date').props.value, '');
  assert.equal(input('To date').props.value, '');
  input('From date').props.onChange({ target: { value: '2026-10-24' } });
  input('To date').props.onChange({ target: { value: '2026-10-25' } });
  assert.equal(input('From date').props.value, '2026-10-24');
  assert.equal(input('To date').props.value, '2026-10-25');
  assert.equal(s.range, 'dateRange');
  assert.equal(s.selected, '');
  assert.equal(s.linkSelected.length, 0);
  assert.deepEqual(s.locationFilter, ['field-a']);
  assert.deepEqual(s.timeFilter, ['15:00']);
  assert.equal(s.leagueFilter, 'league-a');
  s.renderDateRange().props.onChange({ target: { value: 'today' } });
  assert.equal(input('From date'), undefined);
  assert.equal(input('To date'), undefined);
  assert.equal(s.fromDate, '');
  assert.equal(s.toDate, '');
  s.renderDateRange().props.onChange({ target: { value: 'custom' } });
  assert.equal(input('From date'), undefined, 'Choose a Date does not expose From/To');
  assert.equal(input('To date'), undefined);
});

test('workspace role routing and responsive toolbar styling stay unchanged', () => {
  const workspace = fs.readFileSync('app/workspace/page.tsx', 'utf8');
  assert.match(workspace, /const manager = viewRole === "admin" \|\| viewRole === "assignor"/);
  assert.match(workspace, /manager && section === "Assignments" && \(\s*<AssignmentsManager/);
  const css = fs.readFileSync('app/assignment-center-responsive.css', 'utf8');
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 180px\), 1fr\)\)/);
  const legacy = fs.readFileSync('app/assignment-center-upgrades.css', 'utf8');
  assert.match(legacy, /\.assignmentCustomDateRow\{[^}]*grid-column:1\/-1/);
});
