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

test('game cards respond to content width while desktop position rows remain a table', () => {
  const containers = [];
  ast.walkAtRules('container', rule => containers.push(rule.params));
  assert(containers.includes('assignment-results (max-width: 1100px)'));
  assert(containers.includes('assignment-results (max-width: 560px)'));
  assert(!containers.some(params => params.startsWith('assignment-positions')));
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


// Inspect each imported stylesheet, not just the new override: legacy mobile
// table rules remain active up to 760px. These are source checks, not a browser.
const importedCss = [...fs.readFileSync('app/layout.tsx', 'utf8').matchAll(/import "\.\/(.*\.css)";/g)].map(([, file]) => postcss.parse(fs.readFileSync(`app/${file}`, 'utf8')));
const mobileGate = rule => {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media') {
      const match = parent.params.match(/max-width:\s*(\d+)px/);
      if (match) return Number(match[1]);
    }
  }
  return null;
};

test('all imported position-cell stacking rules are limited to the existing mobile breakpoint', () => {
  const positionSelectors = ['.assignmentMain table', '.assignmentMain tbody', '.assignmentMain tr', '.assignmentMain td', '.assignmentMain td:first-child', '.assignmentMain .assignmentPositionsTable', '.assignmentPositionsTable tbody', '.assignmentPositionsTable tr', '.assignmentMain .assignmentPositionsTable td', '.assignmentMain .assignmentPositionsTable td:first-child'];
  const stacking = [];
  for (const sheet of importedCss) sheet.walkRules(rule => {
    if (rule.selectors.some(selector => positionSelectors.includes(selector)) && rule.nodes.some(node => node.prop === 'display' && ['block', 'grid'].includes(node.value))) stacking.push(rule);
  });
  assert(stacking.length > 1, 'include legacy mobile styles as well as the responsive override');
  for (const rule of stacking) {
    assert(mobileGate(rule) !== null && mobileGate(rule) <= 760, `stacking outside mobile media: ${rule.selector}`);
  }
  const gate = rules.find(rule => rule.selectors.includes('.assignmentMain .assignmentPositionsTable td') && rule.nodes.some(node => node.prop === 'display' && node.value === 'block')).parent;
  assert.equal(gate.name, 'media');
  assert.equal(gate.params, '(max-width: 760px)');
  const maximum = Number(gate.params.match(/max-width: (\d+)px/)[1]);
  for (const [viewport, pane, stacked] of [
    [320, 280, true], [390, 350, true], [700, 660, true], [701, 661, true], [760, 720, true],
    [761, 480, false], [768, 480, false], [1024, 640, false],
    [1280, 740, false], [1440, 779, false], [1920, 780, false],
  ]) assert.equal(viewport <= maximum, stacked, `${viewport}px viewport / ${pane}px pane`);
});

test('desktop positions keep their existing compact table rules and accessible scroll region', () => {
  // The later workspace stylesheet overrides the older 900px minimum. Preserve
  // that compact table, while the final responsive stylesheet permits scrolling.
  const workspace = postcss.parse(fs.readFileSync('app/workspace-table-layout.css', 'utf8'));
  const compact = [];
  workspace.walkRules('.assignmentMain .assignmentPositionsTable', rule => {
    if (rule.parent.params === '(min-width: 701px)') compact.push(rule);
  });
  assert.equal(compact.length, 1);
  assert(compact[0].nodes.some(node => node.prop === 'min-width' && node.value === '0' && node.important));
  assert(compact[0].nodes.some(node => node.prop === 'table-layout' && node.value === 'fixed'));
  assert.equal(declaration('.assignmentMain .assignmentPositionsScroll', 'overflow-x'), 'auto');
  const syntax = ts.createSourceFile('AssignmentsManagerV2.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scrollRegion;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => attribute.name?.text === 'className' && attribute.initializer?.text === 'tableWrap assignmentPositionsScroll')) scrollRegion = node;
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert(scrollRegion);
  const opening = scrollRegion.openingElement.getText(syntax);
  assert(opening.includes('role="region"'));
  assert(opening.includes('aria-label="Game assignment positions"'));
  assert(opening.includes('tabIndex={0}'));
});
