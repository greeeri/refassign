const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const localRequire = require;
const ts = localRequire('typescript');
const root = require('node:path').resolve(__dirname, '..') + '/';
const tick = () => new Promise(resolve => setImmediate(resolve));
const league = id => ({ id, name: id, mileage_plan: 'round_trip', email_assignor_on_decline: false });
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function setup(props, { deferReads = false, failReads = false } = {}) {
  const cells = [], calls = [], effects = [];
  let cursor = 0, tree;
  const react = {
    useState(initial) { const id = cursor++; if (!(id in cells)) cells[id] = initial; return [cells[id], value => { cells[id] = typeof value === 'function' ? value(cells[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in cells)) cells[id] = { current: initial }; return cells[id]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const id = cursor++, prev = cells[id]; if (!prev || deps.some((v, i) => v !== prev.deps[i])) { cells[id] = { deps, cleanup: prev?.cleanup }; effects.push(() => { cells[id].cleanup?.(); cells[id].cleanup = fn(); }); } },
  };
  const result = call => ({ error: failReads ? { message: 'Access denied' } : null, data:
    call.rpc === 'get_organization_setup_directory' ? { leagues: [league('allowed'), league('other')], levels: [], teams: [] }
      : call.table === 'leagues' ? [league('allowed'), league('other')]
      : call.table === 'organization_league_coverage' ? [{ league_id: 'allowed', email_assignor_on_decline: true }, { league_id: 'other', email_assignor_on_decline: false }]
      : [] });
  const complete = call => deferReads ? call.deferred.promise : Promise.resolve(result(call));
  const client = {
    from(table) { const call = { table, filters: [], deferred: defer() }; calls.push(call); const q = { then: (resolve, reject) => complete(call).then(resolve, reject) }; for (const method of ['select', 'eq', 'in', 'order', 'update', 'insert', 'delete', 'maybeSingle']) q[method] = (...args) => { call.filters.push([method, ...args]); return q; }; return q; },
    rpc(rpc, args) { const call = { rpc, args, deferred: defer() }; calls.push(call); return complete(call); },
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }), getSession: async () => ({ data: { session: {} } }) },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react
    : name === 'react/jsx-runtime' ? localRequire(name)
    : name.endsWith('/supabase/client') ? { createClient: () => client }
    : name.endsWith('/field-complex-support') ? { fieldComplexRpcMissing: () => false }
    : name.endsWith('/leagueGameScope') ? { leagueGameAccessKey: (grants = []) => JSON.stringify(grants) }
    : name.startsWith('.') ? {} : localRequire(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(root + 'components/GameSetup.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: mockRequire, window: { setTimeout, clearTimeout }, navigator: { clipboard: { writeText: async () => {} } }, confirm: () => true, URLSearchParams, Promise, Map, Set });
  function render(nextProps) { if (nextProps) props = nextProps; cursor = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; }
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children)]; }
  render();
  return { render, calls, nodes: () => nodes(tree), text: () => JSON.stringify(tree) };
}
const scoped = { view: 'Leagues', organizationId: 'org', allowedLeagueIds: ['allowed'] };
test('scoped Leagues performs only selected league and organization coverage reads', async () => {
  const t = setup(scoped); await tick(); t.render();
  assert.deepEqual(t.calls.map(c => c.table), ['leagues', 'organization_league_coverage']);
  for (const call of t.calls) assert.equal(JSON.stringify(call.filters.find(f => f[0] === 'in')[2]), JSON.stringify(['allowed']));
  assert(t.calls[1].filters.some(f => f[0] === 'eq' && f[1] === 'organization_id' && f[2] === 'org'));
  assert(t.text().includes('allowed')); assert(!t.text().includes('other')); assert(!t.text().includes('Add League'));
  assert.equal(t.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, true);
});
test('missing/empty league scope and all non-owner non-Leagues views fail closed without reads', async () => {
  for (const props of [{ view: 'Leagues', organizationId: 'org' }, { ...scoped, allowedLeagueIds: [] }, ...['Levels', 'Teams', 'Locations'].map(view => ({ ...scoped, view }))]) {
    const t = setup(props); await tick(); t.render(); assert.equal(t.calls.length, 0); assert.equal(t.nodes().filter(n => n.type === 'form').length, 0);
  }
});
test('owner Leagues avoids duplicate base catalogs and unrelated RPCs', async () => {
  const t = setup({ ...scoped, fullOrganizationAccess: true, canManageLeagueDirectory: true }); await tick(); t.render();
  assert.deepEqual(t.calls.map(c => c.rpc), ['get_organization_setup_directory']); assert(t.text().includes('Add League')); assert(t.text().includes('other'));
});
test('owner Levels and Locations load only view-specific RPCs', async () => {
  for (const [view, expected] of [['Levels', ['get_organization_setup_directory', 'get_organization_league_levels']], ['Locations', ['get_organization_locations', 'get_organization_field_complexes']]]) {
    const t = setup({ ...scoped, view, fullOrganizationAccess: true, canManageLeagueDirectory: true }); await tick(); t.render();
    assert.deepEqual(t.calls.map(c => c.rpc).sort(), expected.sort());
  }
});
test('scope changes hide previous data immediately and reject a late previous load', async () => {
  const t = setup(scoped, { deferReads: true }); await tick();
  t.render({ ...scoped, organizationId: 'new-org', allowedLeagueIds: ['new'] }); await tick();
  t.calls[2].deferred.resolve({ data: [league('new')], error: null });
  t.calls[3].deferred.resolve({ data: [{ league_id: 'new', email_assignor_on_decline: false }], error: null });
  await tick(); t.render(); assert(t.text().includes('new'));
  t.calls[0].deferred.resolve({ data: [league('allowed')], error: null });
  t.calls[1].deferred.resolve({ data: [{ league_id: 'allowed', email_assignor_on_decline: false }], error: null });
  await tick(); t.render(); assert(!t.text().includes('allowed')); assert(t.text().includes('new'));
  t.render({ ...scoped, organizationId: 'new-org', allowedLeagueIds: [] }); assert(!t.text().includes('Mileage Plan'));
});
test('old owner event handlers cannot mutate after permission revocation', async () => {
  const t = setup({ ...scoped, fullOrganizationAccess: true, canManageLeagueDirectory: true }); await tick(); t.render();
  const submit = t.nodes().find(n => n.type === 'form').props.onSubmit;
  t.render({ ...scoped, allowedLeagueIds: [] });
  const count = t.calls.length; await submit({ preventDefault() {} }); assert.equal(t.calls.length, count);
});
test('failed owner read leaves directory controls unavailable', async () => {
  const t = setup({ ...scoped, fullOrganizationAccess: true, canManageLeagueDirectory: true }, { failReads: true }); await tick(); t.render();
  assert(t.text().includes('Access denied')); assert(!t.text().includes('Add League'));
});
test('Administrator is league-scoped while owner card remains exempt', () => {
  const source = fs.readFileSync(root + 'components/OrganizationTeamManager.tsx', 'utf8');
  assert(source.includes('["admin", "Administrator", "Administration in selected leagues"]'));
  assert.match(source, /const leagueRoles: RoleCode\[\] = \[\s*"admin"/);
  assert(source.includes('!item.owner && needsLeagues(roles) && !leagueIds.length'));
  assert(source.includes('!item.owner && needsLeagues(r) ? validIds : []'));
});

test('location-limited or missing grants can view leagues but cannot edit whole-league settings', async () => {
  for (const grants of [[], [{ league_id: 'allowed', all_locations: false, location_ids: ['site-a'] }]]) {
    const t = setup({ ...scoped, leagueGameAccess: grants }); await tick(); t.render();
    assert(t.text().includes('League-wide settings are read-only'));
    for (const node of t.nodes().filter(n => n.type === 'button' || n.type === 'select' || n.type === 'input')) assert.equal(node.props.disabled, true);
    assert(!t.nodes().some(n => n.type?.name === 'LeagueDocumentsManager'));
  }
});
test('explicit all-location league grant retains selected-league settings', async () => {
  const t = setup({ ...scoped, leagueGameAccess: [{ league_id: 'allowed', all_locations: true, location_ids: [] }] }); await tick(); t.render();
  assert(!t.text().includes('League-wide settings are read-only'));
  const linkButton = t.nodes().find(n => n.type === 'button' && n.props.children === 'Copy official link');
  assert.equal(linkButton.props.disabled, false);
});

const allLocationScoped = { ...scoped, leagueGameAccess: [{ league_id: 'allowed', all_locations: true, location_ids: [] }] };
const mileageSelect = (t, id = 'allowed') => t.nodes().find(n => n.type === 'select' && n.props['aria-label'] === `Mileage plan for ${id}`);
const mileageSave = (t, id = 'allowed') => {
  const controls = t.nodes().find(n => n.type === 'div' && Array.isArray(n.props.children) && n.props.children.some(child => child?.type === 'select' && child.props['aria-label'] === `Mileage plan for ${id}`));
  return controls.props.children.find(child => child?.type === 'button');
};

test('all-location scoped admin cannot mutate shared mileage even through disabled callbacks', async () => {
  const t = setup(allLocationScoped); await tick(); t.render();
  const select = mileageSelect(t);
  assert.equal(select.props.disabled, true);
  // Invoke callbacks directly to verify handler authorization, not only disabled HTML.
  select.props.onChange({ target: { value: 'none' } }); t.render();
  const save = mileageSave(t); assert.equal(save.props.disabled, true);
  save.props.onClick(); await tick();
  assert(!t.calls.some(call => call.rpc === 'update_organization_league_mileage_plan'));
  assert(!t.calls.some(call => call.table === 'leagues' && call.filters.some(filter => filter[0] === 'update')));
});

test('all-location scoped admin retains organization-specific decline-email setting', async () => {
  const t = setup(allLocationScoped); await tick(); t.render();
  const declineToggle = t.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox');
  assert.equal(declineToggle.props.disabled, false);
  declineToggle.props.onChange({ target: { checked: false } }); await tick();
  const update = t.calls.find(call => call.rpc === 'update_organization_league_decline_email_copy');
  assert(update);
  assert.deepEqual(JSON.parse(JSON.stringify(update.args)), { p_organization_id: 'org', p_league_id: 'allowed', p_enabled: false });
});

test('organization owner can update shared league mileage', async () => {
  const t = setup({ ...allLocationScoped, fullOrganizationAccess: true, canManageLeagueDirectory: true }); await tick(); t.render();
  assert.equal(mileageSelect(t).props.disabled, false);
  mileageSelect(t).props.onChange({ target: { value: 'none' } }); t.render();
  const save = mileageSave(t); assert.equal(save.props.disabled, false);
  save.props.onClick(); await tick(); t.render();
  const update = t.calls.find(call => call.rpc === 'update_organization_league_mileage_plan');
  assert(update);
  assert.deepEqual(JSON.parse(JSON.stringify(update.args)), { p_organization_id: 'org', p_league_id: 'allowed', p_mileage_plan: 'none' });
  assert.equal(mileageSelect(t).props.value, 'none');
});

test('stale owner mileage callback is rejected after demotion to scoped admin', async () => {
  const t = setup({ ...allLocationScoped, fullOrganizationAccess: true, canManageLeagueDirectory: true }); await tick(); t.render();
  mileageSelect(t).props.onChange({ target: { value: 'one_way' } }); t.render();
  const oldSave = mileageSave(t).props.onClick;
  t.render({ ...allLocationScoped, fullOrganizationAccess: false, canManageLeagueDirectory: false });
  oldSave(); await tick(); t.render();
  assert(!t.calls.some(call => call.rpc === 'update_organization_league_mileage_plan'));
  assert.equal(mileageSelect(t).props.disabled, true);
});
