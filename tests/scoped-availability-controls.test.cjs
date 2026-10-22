const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const localRequire = require;
const tick = () => new Promise(resolve => setImmediate(resolve));
const official = { id: 'official', auth_user_id: 'user', first_name: 'Test', last_name: 'Official' };
const block = { id: 'self-block', official_id: 'official', block_type: 'date', start_date: '2099-01-01', end_date: '2099-01-01', notes: 'Visible availability', source_assignment_id: null, created_by: 'user' };
const requests = [
  { id: 'pending', block_id: 'other-block', official_id: 'official', status: 'pending', requested_at: '2026-10-01', block_type: 'date', block_start_date: '2099-01-01', block_end_date: '2099-01-01', request_note: 'Please review' },
  { id: 'history', block_id: 'old-block', official_id: 'official', status: 'approved', requested_at: '2026-09-01', reviewed_at: '2026-10-01', block_type: 'date', block_start_date: '2099-01-01', block_end_date: '2099-01-01' },
];
const scoped = { organizationId: 'org', managerView: true };
function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children)]; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(''); if (node == null || typeof node === 'boolean') return ''; return typeof node === 'object' ? text(node.props?.children) : String(node); }
function setup(component, props) {
  const cells = [], effects = [], calls = [], dialogs = [];
  let cursor = 0, tree;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++, prev = cells[i]; if (!prev || deps.some((value, index) => value !== prev[index])) { cells[i] = deps; effects.push(fn); } },
  };
  function result(call) {
    if (call.methods.some(([method]) => ['update', 'insert', 'delete'].includes(method))) return { data: [{ id: 'changed' }], error: null };
    const data = call.table === 'organization_memberships' ? [{ role: 'admin' }]
      : call.table === 'organization_officials' ? [{ official_id: 'official' }]
      : call.table === 'organization_locations' ? [{ location_id: 'location' }]
      : call.table === 'organization_levels' ? [{ level_id: 'level' }]
      : call.table === 'officials' ? [official]
      : call.table === 'locations' ? [{ id: 'location', name: 'Field' }]
      : call.table === 'teams' ? [{ id: 'team', name: 'Team', level_id: 'level', levels: { name: 'Level' } }]
      : call.table === 'official_availability_blocks' ? [block, { ...block, id: 'other-block', created_by: 'someone-else' }, { ...block, id: 'decline-block', source_assignment_id: 'assignment' }]
      : call.table === 'block_removal_requests' ? requests : [];
    return { data, error: null };
  }
  const client = {
    from(table) {
      const call = { table, methods: [] }; calls.push(call);
      const q = { then: (resolve, reject) => Promise.resolve(result(call)).then(resolve, reject) };
      for (const method of ['select', 'eq', 'in', 'order', 'range', 'update', 'insert', 'delete']) q[method] = (...args) => { call.methods.push([method, ...args]); return q; };
      return q;
    },
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react : name === 'react/jsx-runtime' ? localRequire(name)
    : name.endsWith('/supabase/client') ? { createClient: () => client }
    : name.endsWith('/supabase/readAll') ? { readAllPages: fn => fn(0, 999), readAllForChunks: (ids, fn) => fn(ids, 0, 999) }
    : localRequire(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`components/${component}.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: mockRequire, window: { confirm: message => { dialogs.push(message); return true; }, prompt: message => { dialogs.push(message); return ''; } }, console, Date });
  const render = next => { if (next) props = next; cursor = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { render, calls, dialogs, nodes: () => nodes(tree), text: () => text(tree), button: label => nodes(tree).find(n => n.type === 'button' && text(n) === label) };
}
const mutations = t => t.calls.filter(call => call.methods.some(([method]) => ['insert', 'update', 'delete'].includes(method)));
async function ready(t) { await tick(); t.render(); }
function fillDates(t) { for (const input of t.nodes().filter(n => n.type === 'input' && n.props.type === 'date')) input.props.onChange({ target: { value: '2099-01-01' } }); t.render(); }

test('scoped manager retains availability reads and official picker without shared mutation actions', async () => {
  const t = setup('AvailabilityCalendar', scoped); await ready(t);
  assert(t.text().includes('Visible availability'));
  assert(t.nodes().some(n => n.type === 'option' && n.props.value === 'official')); // Official picker remains available.
  assert(t.text().includes('Only organization owners can change shared availability blocks.'));
  for (const label of ['Add Block', 'Remove', 'Request Remove']) assert.equal(t.button(label), undefined, label);
  assert.equal(t.nodes().filter(n => n.type === 'form').length, 0);
  const reads = t.calls.filter(call => call.table === 'official_availability_blocks');
  assert(reads.every(call => call.methods.some(([method, column]) => method === 'in' && column === 'official_id')));
});

test('owner can add and remove shared availability blocks', async () => {
  const t = setup('AvailabilityCalendar', { ...scoped, fullOrganizationAccess: true }); await ready(t);
  assert(t.button('Add Block')); assert(t.button('Remove'));
  fillDates(t);
  await t.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick(); t.render();
  await t.button('Remove').props.onClick();
  assert.equal(mutations(t).filter(call => call.methods.some(([method]) => method === 'insert')).length, 1);
  assert.equal(mutations(t).filter(call => call.methods.some(([method]) => method === 'delete')).length, 1);
});

test('stale owner availability handlers cannot prompt or write after permission revocation', async () => {
  const t = setup('AvailabilityCalendar', { ...scoped, fullOrganizationAccess: true }); await ready(t);
  fillDates(t);
  const save = t.nodes().find(n => n.type === 'form').props.onSubmit, remove = t.button('Remove').props.onClick;
  t.render(scoped);
  await save({ preventDefault() {} }); await remove();
  assert.equal(mutations(t).length, 0); assert.equal(t.dialogs.length, 0);
});

test('official self-service remains available without organization-owner privileges', async () => {
  const t = setup('AvailabilityCalendar', { organizationId: 'org' }); await ready(t);
  assert(t.button('Add Block')); assert(t.button('Remove')); assert(t.button('Request Remove'));
  assert.equal(t.nodes().filter(n => n.type === 'button' && text(n) === 'Remove').length, 1);
  fillDates(t);
  await t.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await tick(); t.render();
  await t.button('Remove').props.onClick(); await tick(); t.render();
  await t.button('Request Remove').props.onClick();
  assert.equal(mutations(t).filter(call => call.table === 'official_availability_blocks').length, 2);
  assert.equal(mutations(t).filter(call => call.table === 'block_removal_requests').length, 1);
});

test('scoped request review retains pending/history reads but hides approvals and selection', async () => {
  const t = setup('BlockRemovalRequests', { organizationId: 'org' }); await ready(t);
  assert(t.text().includes('Please review')); assert(t.text().includes('Removal Request History'));
  assert(t.text().includes('Only organization owners can approve or decline shared availability changes.'));
  for (const label of ['Approve', 'Decline', 'Approve selected', 'Decline selected']) assert.equal(t.button(label), undefined, label);
  assert.equal(t.nodes().filter(n => n.type === 'input' && n.props.type === 'checkbox').length, 0);
});

test('owners retain single-request and bulk-review controls', async () => {
  const t = setup('BlockRemovalRequests', { organizationId: 'org', fullOrganizationAccess: true }); await ready(t);
  assert(t.button('Approve selected')); assert(t.button('Decline selected'));
  t.button('Approve').props.onClick(); await tick(); t.render();
  const select = t.nodes().find(n => n.type === 'input' && n.props['aria-label'] === 'Select all pending removal requests');
  select.props.onChange({ target: { checked: true } }); t.render();
  t.button('Decline selected').props.onClick(); await tick();
  assert.equal(mutations(t).length, 2);
  assert.equal(mutations(t)[0].methods.find(([method]) => method === 'update')[1].status, 'approved');
  assert.equal(mutations(t)[1].methods.find(([method]) => method === 'update')[1].status, 'denied');
});

test('stale single and bulk approval handlers cannot prompt or write after owner revocation', async () => {
  const t = setup('BlockRemovalRequests', { organizationId: 'org', fullOrganizationAccess: true }); await ready(t);
  t.nodes().find(n => n.type === 'input' && n.props['aria-label'] === 'Select all pending removal requests').props.onChange({ target: { checked: true } }); t.render();
  const approve = t.button('Approve').props.onClick, bulk = t.button('Approve selected').props.onClick;
  t.render({ organizationId: 'org' });
  approve(); bulk(); await tick();
  assert.equal(mutations(t).length, 0); assert.equal(t.dialogs.length, 0);
});
