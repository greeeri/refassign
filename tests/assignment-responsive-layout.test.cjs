const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');
const ts = require('typescript');
const css = fs.readFileSync('app/assignment-center-responsive.css', 'utf8');
const ast = postcss.parse(css);
const source = fs.readFileSync('components/AssignmentsManagerV2.tsx', 'utf8');
const rules = [];
ast.walkRules(rule => rules.push(rule));
const declaration = (selector, property) => rules.filter(rule => rule.selectors.includes(selector)).flatMap(rule => rule.nodes.filter(node => node.prop === property)).at(-1)?.value;

test('responsive CSS is loaded after legacy widths and uses intrinsic toolbar columns', () => {
  const layout = fs.readFileSync('app/layout.tsx', 'utf8');
  assert(layout.indexOf('assignment-center-responsive.css') > layout.indexOf('workspace-table-layout.css'));
  assert.equal(declaration('.assignmentFilterPanel.assignmentCompactToolbar', 'grid-template-columns'), 'minmax(0, 1fr)');
  assert.equal(declaration('.assignmentCompactToolbar .assignmentDirectFilters', 'grid-template-columns'), 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))');
  assert.equal(declaration('.assignmentGameRows', 'min-width'), '0');
  assert.equal(declaration('.assignmentGameTable', 'overflow'), 'visible');
  assert(!/\b(?:body|html)\b\s*\{/.test(css), 'do not hide viewport overflow to mask offscreen controls');
});

test('filter and action options stay bounded and keyboard-scrollable in document flow', () => {
  for (const selector of ['.assignmentMultiFilterOptions', '.assignmentStatusFilterOptions', '.assignmentMoreActions > div']) {
    assert.equal(declaration(selector, 'position'), 'static');
    assert.equal(declaration(selector, 'min-width'), '0');
    assert.equal(declaration(selector, 'max-width'), '100%');
    assert.equal(declaration(selector, 'overflow'), 'auto');
    assert.match(declaration(selector, 'max-height'), /vh/);
  }
  assert.equal(declaration('.assignmentCompactOverflow > div', 'right'), '0');
  assert.equal(declaration('.assignmentCompactOverflow > div', 'transform'), 'none');
});

test('game cards and position cells respond to their content width, not only viewport width', () => {
  const containers = [];
  ast.walkAtRules('container', rule => containers.push(rule.params));
  assert(containers.includes('assignment-results (max-width: 1100px)'));
  assert(containers.includes('assignment-results (max-width: 560px)'));
  assert(containers.includes('assignment-positions (max-width: 780px)'));
  assert.equal(declaration('.assignmentGameTableHeader', 'display'), 'flex');
  assert.equal(declaration('.assignmentGameRow > .assignmentGameCollapse', 'right'), '12px');
  assert.equal(declaration('.assignmentMain .assignmentPositionsTable td::before', 'content'), 'attr(data-label)');
  for (const label of ['Self Assign', 'Position', 'Assigned Official', 'Status', 'Assign']) assert(source.includes(`<td data-label="${label}">`));
});

test('the results container encloses sorting and rows but no viewport-fixed dialog', () => {
  const syntax = ts.createSourceFile('AssignmentsManagerV2.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let container;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => attribute.name?.text === 'className' && attribute.initializer?.text === 'assignmentGameResults')) container = node;
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert(container);
  const renderedSource = container.getText(syntax);
  assert(renderedSource.includes('assignmentGameTableHeader'));
  assert(renderedSource.includes('assignmentGameRows'));
  assert(!renderedSource.includes('assignmentDialogBackdrop'));
  assert(!renderedSource.includes('role="dialog"'));
  assert(source.indexOf('assignmentPublishReview') < container.pos);
});
