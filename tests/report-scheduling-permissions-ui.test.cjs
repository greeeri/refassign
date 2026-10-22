const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const root = path.resolve(__dirname, '..');
function setup(file, props = {}, { inheritedAccess = false } = {}) {
  const cells = [], effects = [], calls = [], modules = {};
  let cursor = 0, tree;
  const react = {
    useState(initial) { const id = cursor++; if (!(id in cells)) cells[id] = initial; return [cells[id], value => { cells[id] = typeof value === 'function' ? value(cells[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in cells)) cells[id] = { current: initial }; return cells[id]; },
    useMemo(fn) { cursor++; return fn(); },
    createContext(value) { return { value, Provider: 'ContextProvider' }; },
    useContext(context) { cursor++; return inheritedAccess || context.value; },
    useEffect(fn, deps) { const id = cursor++, prev = cells[id]; if (!prev || deps.some((v, i) => v !== prev.deps[i])) { cells[id] = { deps, cleanup: prev?.cleanup }; effects.push(() => { cells[id].cleanup?.(); cells[id].cleanup = fn(); }); } },
  };
  function compiled(relative, requireFn) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module, exports: module.exports, require: requireFn, fetch: fetchMock, window: { location: { search: '' }, confirm: () => true }, AbortController, URLSearchParams, Map, Set, Date, Promise });
    return module.exports;
  }
  const helper = compiled('lib/customReportBuilder.ts', require);
  const personal = { id: 'personal-template', name: 'Personal report', organization_id: 'org', definition: helper.defaultCustomReport, frequency: 'weekly', send_day: 1, schedule_enabled: true, recipient_email: 'me@example.com' };
  const view = { id: 'personal-view', name: 'Personal view', filters: {}, is_favorite: false, frequency: 'weekly', send_day: 1, schedule_enabled: true, recipient_email: 'me@example.com' };
  async function fetchMock(url, options = {}) {
    calls.push({ url, options });
    const body = options.body ? JSON.parse(options.body) : null;
    return { ok: true, json: async () => options.method === 'POST'
      ? url.includes('saved-views') ? { view: { ...view, ...body } } : url.includes('/custom') ? { template: { ...personal, ...body } } : { schedule: { organization_id: 'org' } }
      : url.includes('saved-views') ? { reportingAccess: 'premium', views: [view] }
      : url.includes('/custom') ? { reportingAccess: 'premium', games: [], assignments: [], organizations: [{ id: 'org', name: 'Org' }], templates: [personal] }
      : url.includes('/executive/schedule') ? { organizations: [{ id: 'org', name: 'Org' }], schedules: [] }
      : { reportingAccess: 'premium', games: [], assignments: [], declines: [], officials: [], registrations: [], modules: [], progress: [], communications: [] } };
  }
  function mockRequire(name) {
    if (name === 'react') return react;
    if (name.endsWith('/customReportBuilder')) return helper;
    if (name.endsWith('/pdfCopyright')) return { addReportCopyright() {} };
    if (name === './ReportSavedViews') return { ReportSchedulingAccessContext: react.createContext(false) };
    if (name.startsWith('.')) return modules[name] ||= { default: function Child() {} };
    return require(name);
  }
  const component = compiled(file, mockRequire).default;
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children)]; }
  function render(next) { if (next) props = next; cursor = 0; tree = component(props); while (effects.length) effects.shift()(); return tree; }
  render();
  return { calls, render, nodes: () => nodes(tree), text: () => JSON.stringify(tree), posts: () => calls.filter(c => c.options.method === 'POST') };
}
test('scoped executive dashboard loads five datasets without requesting owner schedule', async () => {
  const t = setup('components/ExecutiveReportingDashboard.tsx', { organizationId: 'org', onOpenReport() {} }); await tick(); t.render();
  assert.equal(t.calls.length, 5); assert(!t.calls.some(c => c.url.includes('/executive/schedule')));
  assert(t.text().includes('30-day coverage')); assert(!t.text().includes('Save executive settings'));
});
test('owner executive schedule is available and stale owner handler cannot POST after revocation', async () => {
  const props = { organizationId: 'org', onOpenReport() {}, fullOrganizationAccess: true };
  const t = setup('components/ExecutiveReportingDashboard.tsx', props); await tick(); t.render();
  assert(t.calls.some(c => c.url.includes('/executive/schedule')));
  const button = t.nodes().find(n => n.type === 'button' && n.props.children === 'Save executive settings'); assert(button);
  t.render({ ...props, fullOrganizationAccess: false }); button.props.onClick(); await tick(); t.render();
  assert.equal(t.posts().length, 0); assert(!t.text().includes('Save executive settings'));
});
test('scoped custom report saves personal template unscheduled and hides delivery toggle', async () => {
  const t = setup('components/CustomReportBuilder.tsx', { organizationId: 'org' }); await tick(); t.render();
  assert(!t.text().includes('Schedule email delivery'));
  const open = t.nodes().find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0]?.props?.children === 'Personal report');
  open.props.onClick(); t.render(); assert(t.text().includes('turn off its scheduled delivery'));
  t.nodes().find(n => n.type === 'button' && n.props.children === 'Update report template').props.onClick(); await tick();
  const body = JSON.parse(t.posts()[0].options.body); assert.equal(body.id, 'personal-template'); assert.equal(body.scheduleEnabled, false);
});
test('custom stale save cannot POST to previous organization after a scope change', async () => {
  const t = setup('components/CustomReportBuilder.tsx', { organizationId: 'org', fullOrganizationAccess: true }); await tick(); t.render();
  const save = t.nodes().find(n => n.type === 'button' && n.props.children === 'Save report template');
  t.render({ organizationId: 'other', fullOrganizationAccess: false }); save.props.onClick(); await tick(); assert.equal(t.posts().length, 0);
});
test('saved-view scoped defaults hide delivery and force false only for loaded personal ID', async () => {
  const t = setup('components/ReportSavedViews.tsx', { organizationId: 'org', reportKey: 'audit', filters: {}, onApply() {} }); await tick(); t.render();
  assert(!t.text().includes('Scheduled delivery'));
  t.nodes().find(n => n.type === 'select').props.onChange({ target: { value: 'personal-view' } }); t.render();
  assert(t.text().includes('turn off its scheduled delivery'));
  t.nodes().find(n => n.type === 'button' && n.props.children === 'Update view').props.onClick(); await tick();
  const body = JSON.parse(t.posts()[0].options.body); assert.equal(body.id, 'personal-view'); assert.equal(body.scheduleEnabled, false);
});
test('owner context enables nested scheduling but explicit false overrides it', async () => {
  const props = { organizationId: 'org', reportKey: 'audit', filters: {}, onApply() {} };
  const t = setup('components/ReportSavedViews.tsx', props, { inheritedAccess: true }); await tick(); t.render(); assert(t.text().includes('Scheduled delivery'));
  t.render({ ...props, fullOrganizationAccess: false }); await tick(); t.render(); assert(!t.text().includes('Scheduled delivery'));
});
test('saved-view stale handler cannot save old organization after scope change', async () => {
  const t = setup('components/ReportSavedViews.tsx', { organizationId: 'org', reportKey: 'audit', filters: {}, onApply() {} }); await tick(); t.render();
  const save = t.nodes().find(n => n.type === 'button' && n.props.children === 'Save current filters');
  t.render({ organizationId: 'other', reportKey: 'audit', filters: {}, onApply() {} }); save.props.onClick(); await tick(); assert.equal(t.posts().length, 0);
});
test('ManagerReports passes owner flag explicitly and defaults its nested context false', () => {
  const t = setup('components/ManagerReports.tsx', { organizationId: 'org' }); assert.equal(t.nodes()[0].props.value, false);
  t.render({ organizationId: 'org', fullOrganizationAccess: true }); assert.equal(t.nodes()[0].props.value, true);
  const source = fs.readFileSync(path.join(root, 'components/ManagerReports.tsx'), 'utf8');
  assert(source.includes('<ExecutiveReportingDashboard fullOrganizationAccess={fullOrganizationAccess}'));
  assert(source.includes('<CustomReportBuilder fullOrganizationAccess={fullOrganizationAccess}'));
});
