const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const localRequire = require;
const tick = () => new Promise(resolve => setImmediate(resolve));
const official = { id: 'official', first_name: 'Test', last_name: 'Official', email: 'ref@example.test', sports: ['Soccer'], organization_active: true, is_minor: false };
const grants = [
  { league_id: 'allowed', all_locations: true, location_ids: [] },
  { league_id: 'restricted', all_locations: false, location_ids: ['venue'] },
];
const scoped = { organizationId: 'org', leagueGameAccess: grants };
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function setup(props = scoped, component = 'OfficialsDirectory') {
  const cells = [], effects = [], calls = [];
  let cursor = 0, tree;
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++, prev = cells[i]; if (!prev || deps.some((value, index) => value !== prev[index])) { cells[i] = deps; effects.push(fn); } },
  };
  function result(call) {
    if (call.methods.some(([method]) => ['update', 'insert', 'delete'].includes(method))) return { data: null, error: null };
    let data = [];
    if (call.rpc === 'get_organization_official_directory') data = [official];
    else if (call.table === 'organization_league_coverage') data = grants.map(g => ({ league_id: g.league_id }));
    else if (call.table === 'organization_levels') data = [{ level_id: 'level' }];
    else if (call.table === 'leagues') data = grants.map(g => ({ id: g.league_id, name: g.league_id }));
    else if (call.table === 'levels') data = [{ id: 'level', name: 'Level' }];
    else if (call.table === 'official_league_eligibility') data = grants.map(g => ({ official_id: 'official', league_id: g.league_id }));
    else if (call.table === 'profiles') data = { role: 'admin' };
    else if (call.table === 'my_assignment_rankings') data = [{ official_id: 'official', rank: 5, ref_rank: 5, ar1_rank: 5, ar2_rank: 5, fourth_rank: 5, mentor_certified: true }];
    else if (call.table === 'official_cc_contacts') data = { date_of_birth: '', name: 'Contact', email: 'contact@example.test', phone: '' };
    return { data, error: null };
  }
  function query(call) {
    calls.push(call);
    const q = { then: (resolve, reject) => Promise.resolve(result(call)).then(resolve, reject) };
    for (const method of ['select', 'eq', 'in', 'order', 'range', 'limit', 'maybeSingle', 'single', 'update', 'insert', 'delete']) {
      q[method] = (...args) => { call.methods.push([method, ...args]); return q; };
    }
    return q;
  }
  const client = {
    from: table => query({ table, methods: [] }),
    rpc: (rpc, args) => query({ rpc, args, methods: [] }),
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react
    : name === 'react/jsx-runtime' ? localRequire(name)
    : name === 'react-dom' ? { createPortal: content => content }
    : name.endsWith('/supabase/client') ? { createClient: () => client }
    : name.endsWith('/assignments/personalRoster') ? { readPersonalRosterScope: async () => ({state: null, ids: null, error: null}) }
    : name.startsWith('.') ? { default: function Child() {}, __esModule: true }
    : localRequire(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`components/${component}.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: mockRequire, window: { setTimeout: () => {} }, document: { getElementById: () => null }, console, Map, Set, Promise });
  const render = next => { if (next) props = next; cursor = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { render, calls, nodes: () => nodes(tree), text: () => text(tree), button: label => nodes(tree).find(n => n.type === 'button' && text(n) === label), label: label => nodes(tree).find(n => n.type === 'label' && text(n).trim() === label) };
}
async function openEditor(t, owner = false) {
  await tick(); t.render();
  await t.button(owner ? 'Edit' : 'Rankings & Eligibility').props.onClick();
  await tick(); t.render();
}
const mutationCalls = t => t.calls.filter(c => c.rpc?.startsWith('set_') || c.methods.some(([m]) => ['insert', 'update', 'delete'].includes(m)));

test('scoped admins cannot add, import, invite, or change shared organization status', async () => {
  const t = setup(); await tick(); t.render();
  for (const label of ['+ Add Official', 'Roster Import / Export', 'Send invitation', 'Deactivate', 'Bulk add officials']) assert.equal(t.button(label), undefined, label);
  assert(t.text().includes('Only organization owners can edit shared official records.'));
  assert.equal(t.calls.filter(c => c.table === 'organization_official_invitations').length, 0);
});

test('shared profile, mentor certification, global levels and CC contact are read-only for scoped admins', async () => {
  const t = setup(); await openEditor(t);
  for (const legend of ['Shared official profile', 'Eligible Levels by Position']) {
    const fieldset = t.nodes().find(n => n.type === 'fieldset' && nodes(n).some(child => child.type === 'legend' && text(child) === legend));
    assert.equal(fieldset.props.disabled, true, legend);
  }
  assert.equal(nodes(t.label('Mentor certified')).find(n => n.type === 'input').props.disabled, true);
  assert.equal(nodes(t.label('My General Rank')).find(n => n.type === 'input').props.disabled, false);
  assert(t.nodes().some(n => n.props?.officialId === 'official' && n.props.readOnly === true));
  assert(t.button('Save My Rankings'));
});

test('scoped save sends only personal ranks and editable league eligibility without shared record writes', async () => {
  const t = setup(); await openEditor(t);
  const restricted = nodes(t.label('restricted')).find(n => n.type === 'input');
  assert.equal(restricted.props.disabled, true);
  restricted.props.onChange(); // Programmatic stale/disabled handlers must also fail closed.
  t.render();
  assert.equal(nodes(t.label('restricted')).find(n => n.type === 'input').props.checked, true);
  await t.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  const writes = mutationCalls(t);
  assert.deepEqual(writes.map(c => c.rpc), ['set_my_official_assessment', 'set_organization_official_position_eligibility']);
  assert.equal(writes[0].args.p_mentor_certified, null);
  assert.equal(writes[1].args.p_center_level_ids, null);
  assert.equal(writes[1].args.p_ar_level_ids, null);
  assert.equal(JSON.stringify(writes[1].args.p_league_ids), JSON.stringify(['allowed']));
});

test('Clear All Leagues changes only editable grants and preserves restricted league selections', async () => {
  const t = setup(); await openEditor(t);
  nodes(t.label('Clear All Leagues')).find(n => n.type === 'input').props.onChange();
  t.render();
  assert.equal(nodes(t.label('allowed')).find(n => n.type === 'input').props.checked, false);
  assert.equal(nodes(t.label('restricted')).find(n => n.type === 'input').props.checked, true);
  await t.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  const eligibility = mutationCalls(t).find(c => c.rpc === 'set_organization_official_position_eligibility');
  assert.equal(JSON.stringify(eligibility.args.p_league_ids), '[]');
});

test('location-restricted admins and missing grants save personal rankings only', async () => {
  for (const leagueGameAccess of [[grants[1]], []]) {
    const t = setup({ ...scoped, leagueGameAccess }); await openEditor(t);
    await t.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    const writes = mutationCalls(t);
    assert.deepEqual(writes.map(c => c.rpc), ['set_my_official_assessment']);
    assert.equal(writes[0].args.p_mentor_certified, null);
  }
});

test('owners retain shared edits, mentor certification, organization status and import controls', async () => {
  const t = setup({ ...scoped, fullOrganizationAccess: true }); await openEditor(t, true);
  assert(t.button('Roster Import / Export'));
  assert(t.button('Deactivate'));
  assert.equal(nodes(t.label('Mentor certified')).find(n => n.type === 'input').props.disabled, false);
  await t.nodes().find(n => n.type === 'form' && n.props.id === 'focused-official-form').props.onSubmit({ preventDefault() {} });
  const writes = mutationCalls(t);
  assert.equal(writes[0].table, 'officials');
  assert.equal(writes[1].args.p_mentor_certified, true);
  assert.equal(JSON.stringify(writes[2].args.p_league_ids), JSON.stringify(['allowed', 'restricted']));
  assert.equal(JSON.stringify(writes[2].args.p_center_level_ids), '[]');
});

test('old shared mutation handlers cannot run after owner access is removed', async () => {
  const t = setup({ ...scoped, fullOrganizationAccess: true }); await tick(); t.render();
  const deactivate = t.button('Deactivate').props.onClick;
  t.render(scoped);
  await deactivate();
  assert.equal(mutationCalls(t).length, 0);
});

test('CC contact keeps self-service enabled but rejects a stale save after read-only access', async () => {
  const t = setup({ officialId: 'official' }, 'OfficialCcContact'); await tick(); t.render();
  const save = t.button('Save CC Contact').props.onClick;
  await save();
  assert.equal(t.calls.filter(c => c.rpc === 'save_official_cc_contact').length, 1);
  t.render({ officialId: 'official', readOnly: true });
  assert.equal(t.button('Save CC Contact'), undefined);
  assert.equal(t.nodes().find(n => n.type === 'fieldset').props.disabled, true);
  await save();
  assert.equal(t.calls.filter(c => c.rpc === 'save_official_cc_contact').length, 1);
});
