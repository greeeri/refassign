const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const grants = [
  { league_id: 'a', all_locations: true, location_ids: [] },
  { league_id: 'b', all_locations: false, location_ids: ['venue'] },
  { league_id: 'empty-grant', all_locations: false, location_ids: [] },
];
const scoped = { organizationId: 'org', leagueGameAccess: grants };
const fixtures = [
  { id: 'alice', first_name: 'Alice', last_name: 'Able', email: 'alice@example.test', phone: '555-0101', sports: ['Soccer'], organization_active: true },
  { id: 'bob', first_name: 'Bob', last_name: 'Baker', email: 'bob@example.test', phone: '555-0102', sports: ['Soccer'], organization_active: false },
  { id: 'carl', first_name: 'Carl', last_name: 'Cane', email: 'carl@example.test', mobile_phone: '555-0103', sports: ['Basketball'], organization_active: true },
  { id: 'none', first_name: 'No', last_name: 'Membership', email: 'none@example.test', sports: ['Soccer'], organization_active: true },
];
const memberships = [
  { official_id: 'alice', league_id: 'a' },
  { official_id: 'bob', league_id: 'b' },
  { official_id: 'carl', league_id: 'a' },
  { official_id: 'carl', league_id: 'b' },
];
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
function setup({ props = scoped, officials = fixtures, eligibility = memberships, failMembership = false, delayLeague, personalIds = null, personalError = null } = {}) {
  const cells = [], effects = [], calls = [], deferred = [];
  const fakeWindow = { location: { href: '' }, setTimeout() {} };
  let cursor = 0, tree;
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) { const i = cursor++, prev = cells[i]; if (!prev || deps.some((value, index) => value !== prev[index])) { cells[i] = deps; effects.push(fn); } },
  };
  const allLeagues = ['a', 'b', 'empty-grant', 'other', 'empty'].map(id => ({ id, name: `League ${id}`, active: true }));
  function result(call) {
    assert(!call.methods.some(([m]) => ['insert', 'update', 'delete'].includes(m)), 'QA must never mutate records');
    let data = [];
    if (call.rpc === 'get_organization_official_directory' || call.table === 'officials') data = officials;
    else if (call.table === 'organization_league_coverage') data = allLeagues.map(l => ({ league_id: l.id, organization_id: 'org', active: true }));
    else if (call.table === 'leagues') data = allLeagues;
    else if (call.table === 'official_league_eligibility') {
      if (failMembership && call.methods.some(([m, key]) => m === 'eq' && key === 'league_id')) return { data: null, error: { message: 'Membership unavailable' } };
      data = eligibility;
    } else if (call.table === 'profiles') return { data: { role: 'admin' }, error: null };
    data = [...data];
    for (const [method, key, value] of call.methods) {
      if (method === 'eq') data = data.filter(row => row[key] === value);
      if (method === 'in') data = data.filter(row => value.includes(row[key]));
      if (method === 'range') data = data.slice(key, value + 1);
    }
    return { data, error: null };
  }
  function query(call) {
    calls.push(call);
    const q = { then: (resolve, reject) => {
      const delayed = call.table === 'official_league_eligibility' && call.methods.some(([m, key, value]) => m === 'eq' && key === 'league_id' && value === delayLeague);
      if (delayed) return new Promise(done => deferred.push(() => done(result(call)))).then(resolve, reject);
      return Promise.resolve(result(call)).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'in', 'order', 'range', 'maybeSingle', 'single', 'insert', 'update', 'delete']) q[method] = (...args) => { call.methods.push([method, ...args]); return q; };
    return q;
  }
  const client = { from: table => query({ table, methods: [] }), rpc: (rpc, args) => query({ rpc, args, methods: [] }), auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react
    : name === 'react/jsx-runtime' ? require(name)
    : name === 'react-dom' ? { createPortal: content => content }
    : name.endsWith('/supabase/client') ? { createClient: () => client }
    : name.endsWith('/assignments/personalRoster') ? { readPersonalRosterScope: async () => ({state: {prepared: true, enabled: personalIds !== null, owner_wide: Boolean(props.fullOrganizationAccess), can_manage: true}, ids: personalIds, error: personalError}) }
    : name.startsWith('.') ? { default: function Child() {}, __esModule: true }
    : require(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/OfficialsDirectory.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: mockRequire, window: fakeWindow, document: { getElementById: () => null }, fetch: () => { throw Error('QA must never send communications'); }, console, Map, Set, Promise });
  const render = next => { if (next) props = next; cursor = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  const allNodes = () => nodes(tree);
  const control = label => allNodes().find(n => n.props?.['aria-label'] === label);
  const button = label => allNodes().find(n => n.type === 'button' && text(n).startsWith(label));
  const settle = async () => { await tick(); render(); await tick(); render(); };
  const change = async (label, value) => { control(label).props.onChange({ target: { value } }); render(); await settle(); };
  render();
  return { render, settle, change, calls, deferred, window: fakeWindow, control, button, nodes: allNodes, text: () => text(tree), names: () => allNodes().filter(n => n.type === 'input' && n.props['aria-label']?.startsWith('Select ') && n.props['aria-label'] !== 'Select visible officials').map(n => n.props['aria-label']) };
}

test('league selector includes explicit zero-location grants without expanding game scope', async () => {
  const t = setup(); await t.settle();
  assert.deepEqual(nodes(t.control('Filter officials by league')).filter(n => n.type === 'option').map(n => n.props.value), ['', 'a', 'b', 'empty-grant']);
  const query = t.calls.find(c => c.table === 'leagues');
  assert.equal(JSON.stringify(query.methods.find(([m]) => m === 'in')), JSON.stringify(['in', 'id', ['a', 'b', 'empty-grant']]));
});

test('owners retain all covered league choices', async () => {
  const t = setup({ props: { ...scoped, fullOrganizationAccess: true } }); await t.settle();
  assert.equal(nodes(t.control('Filter officials by league')).filter(n => n.type === 'option').length, 6);
});

test('selected league filters rich directory queries before paging and preserves explicit membership only', async () => {
  const t = setup(); await t.settle(); t.calls.length = 0;
  await t.change('Filter officials by league', 'a');
  assert.deepEqual(t.names(), ['Select Alice Able', 'Select Carl Cane']);
  const reads = t.calls.filter(c => c.rpc === 'get_organization_official_directory');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].args.p_organization_id, 'org');
  const filterIndex = reads[0].methods.findIndex(([m]) => m === 'in');
  assert(filterIndex >= 0 && filterIndex < reads[0].methods.findIndex(([m]) => m === 'range'));
  assert.equal(JSON.stringify(reads[0].methods[filterIndex]), JSON.stringify(['in', 'id', ['alice', 'carl']]));
  assert(t.text().includes('2 officials in League a'));
});

test('empty league and failed eligibility fail closed without unfiltered roster fallback', async () => {
  for (const failMembership of [false, true]) {
    const t = setup({ props: { ...scoped, fullOrganizationAccess: true }, failMembership }); await t.settle(); t.calls.length = 0;
    await t.change('Filter officials by league', failMembership ? 'a' : 'empty');
    assert.deepEqual(t.names(), []);
    assert.equal(t.calls.filter(c => c.rpc === 'get_organization_official_directory').length, 0);
    assert.equal(t.button('Email Selected').props.disabled, true);
    if (failMembership) {
      assert(!t.text().includes('No officials match these filters.'));
      assert(t.text().includes('The officials directory could not be loaded.'));
    }
  }
});

test('search, sport and active/inactive status remain consistent with the selected league', async () => {
  const t = setup(); await t.settle();
  await t.change('Filter officials by league', 'b');
  assert.deepEqual(t.names(), ['Select Bob Baker', 'Select Carl Cane']);
  assert(t.text().includes('Inactive'));
  await t.change('Filter officials by sport', 'Basketball');
  assert.deepEqual(t.names(), ['Select Carl Cane']);
  await t.change('Search officials', 'no match');
  assert.deepEqual(t.names(), []);
  assert(t.text().includes('No officials match these filters.'));
});

test('filter changes clear bulk selections immediately, including stale email/text callbacks', async () => {
  const t = setup(); await t.settle();
  t.control('Select visible officials').props.onChange(); t.render();
  const oldEmail = t.button('Email Selected').props.onClick;
  const oldText = t.button('Text Selected').props.onClick;
  assert(t.button('Email Selected').props.children.join('').includes('4'));
  t.control('Filter officials by league').props.onChange({ target: { value: 'a' } });
  oldEmail(); oldText();
  assert.equal(t.window.location.href, '');
  t.render(); await t.settle();
  assert.equal(t.button('Email Selected').props.disabled, true);
  assert(!t.nodes().some(n => n.props?.role === 'dialog'));
  t.control('Select visible officials').props.onChange(); t.render();
  assert(t.button('Text Selected').props.children.join('').includes('2'));
  await t.change('Search officials', 'Alice');
  assert.equal(t.button('Text Selected').props.disabled, true);
  await t.change('Search officials', '');
  assert.equal(t.button('Text Selected').props.disabled, true);
});

test('mobile-only recipients are selectable and narrowing closes an open text composer', async () => {
  const t = setup(); await t.settle();
  assert.equal(t.control('Select Carl Cane').props.disabled, false);
  t.control('Select Carl Cane').props.onChange(); t.render();
  t.button('Text Selected').props.onClick(); t.render();
  assert(t.nodes().some(n => n.props?.role === 'dialog'));
  await t.change('Filter officials by sport', 'Soccer');
  assert(!t.nodes().some(n => n.props?.role === 'dialog'));
  assert.equal(t.button('Text Selected').props.disabled, true);
});

test('revoked grants hide old choices and recipients without silently widening the selected league', async () => {
  const t = setup(); await t.settle(); await t.change('Filter officials by league', 'a');
  t.control('Select visible officials').props.onChange(); t.render();
  const oldEmail = t.button('Email Selected').props.onClick;
  t.render({ ...scoped, leagueGameAccess: [grants[1]] });
  assert(!nodes(t.control('Filter officials by league')).some(n => n.type === 'option' && text(n) === 'League a'));
  oldEmail(); assert.equal(t.window.location.href, '');
  await t.settle();
  assert.deepEqual(t.names(), []);
  assert(t.text().includes('This league is no longer available'));
});

test('out-of-order membership responses cannot overwrite a newer league selection', async () => {
  const t = setup({ delayLeague: 'a' }); await t.settle();
  await t.change('Filter officials by league', 'a');
  assert.equal(t.deferred.length, 1);
  await t.change('Filter officials by league', 'b');
  assert.deepEqual(t.names(), ['Select Bob Baker', 'Select Carl Cane']);
  t.deferred[0](); await t.settle();
  assert.deepEqual(t.names(), ['Select Bob Baker', 'Select Carl Cane']);
});

test('membership paging and bounded profile chunks include officials beyond the first 1000', async () => {
  const officials = Array.from({ length: 1001 }, (_, i) => ({ ...fixtures[0], id: `ref-${i}`, first_name: `Ref ${i}`, last_name: 'Test' }));
  const eligibility = officials.map(o => ({ official_id: o.id, league_id: 'a' }));
  const t = setup({ officials, eligibility }); await t.settle(); t.calls.length = 0;
  await t.change('Filter officials by league', 'a');
  assert.equal(t.names().length, 1001);
  const membershipReads = t.calls.filter(c => c.table === 'official_league_eligibility' && c.methods.some(([m]) => m === 'eq'));
  assert.equal(membershipReads.length, 2);
  const profileReads = t.calls.filter(c => c.rpc === 'get_organization_official_directory');
  assert.equal(profileReads.length, 6);
  for (const call of profileReads) assert(call.methods.find(([m]) => m === 'in')[2].length <= 200);
});


test('captured stale refresh cannot invalidate a newer directory load or set loading', async () => {
  const source = fs.readFileSync('components/OfficialsDirectory.tsx', 'utf8');
  const ast = ts.createSourceFile('directory.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let load;
  function find(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'load') load = node; ts.forEachChild(node, find); }
  find(ast); assert(load);
  const writes = [];
  const state = { directoryRequestKey: 'old-league', latestDirectoryKey: { current: 'new-league' }, loadGeneration: { current: 10 } };
  for (const name of new Set(load.getText(ast).match(/\bset[A-Z]\w+/g))) state[name] = value => writes.push([name, value]);
  vm.runInNewContext(ts.transpileModule(load.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, state);
  await state.load();
  assert.equal(state.loadGeneration.current, 10);
  assert.deepEqual(writes, []);
});

test('active personal roster filters rich profiles before downloading and fails closed', async () => {
  const t = setup({personalIds: ['alice']}); await t.settle();
  assert.deepEqual(t.names(), ['Select Alice Able']);
  const reads = t.calls.filter(c => c.rpc === 'get_organization_official_directory');
  assert(reads.every(c => c.methods.some(([method, column, ids]) => method === 'in' && column === 'id' && ids.length === 1 && ids[0] === 'alice')));
  for (const options of [{personalIds: []}, {personalError: {message: 'Roster unavailable'}}]) {
    const empty = setup(options); await empty.settle(); assert.deepEqual(empty.names(), []);
    assert.equal(empty.calls.filter(c => c.rpc === 'get_organization_official_directory').length, 0);
  }
});
