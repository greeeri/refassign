const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const leagueA = '11111111-1111-4111-8111-111111111111';
const leagueB = '22222222-2222-4222-8222-222222222222';
const siteA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const siteB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const leagues = [{ id: leagueA, name: 'League A' }, { id: leagueB, name: 'League B' }];
const locations = [{ id: siteA, name: 'North Park' }, { id: siteB, name: 'South Park' }];
const member = { id: 'member', user_id: 'member', email: 'member@example.com', roles: ['assignor'], viewer_permissions: [], league_ids: [leagueA, leagueB], league_access: [{ league_id: leagueA, all_locations: true, location_ids: [] }, { league_id: leagueB, all_locations: false, location_ids: [siteB] }], status: 'active' };
function setup({ members = [member], invitations = [], locationError = null } = {}) {
  let active;
  const calls = [];
  const react = {
    useState(initial) { const runner = active, id = runner.cursor++; if (!(id in runner.cells)) runner.cells[id] = initial; return [runner.cells[id], value => { runner.cells[id] = typeof value === 'function' ? value(runner.cells[id]) : value; }]; },
    useRef(initial) { const id = active.cursor++; if (!(id in active.cells)) active.cells[id] = { current: initial }; return active.cells[id]; },
    useMemo(fn) { active.cursor++; return fn(); },
    useEffect(fn, deps) { const runner = active, id = runner.cursor++, prev = runner.cells[id]; if (!prev || deps.some((v, i) => v !== prev.deps[i])) { runner.cells[id] = { deps, cleanup: prev?.cleanup }; runner.effects.push(() => { runner.cells[id].cleanup?.(); runner.cells[id].cleanup = fn(); }); } },
  };
  const client = {
    rpc: async (rpc, args) => {
      calls.push({ rpc, args });
      return { error: rpc === 'get_organization_locations' ? locationError : null, data:
        rpc === 'get_organization_team' ? { members, invitations }
          : rpc === 'get_organization_setup_directory' ? { leagues }
          : rpc === 'get_organization_locations' ? locations : null };
    },
    functions: { invoke: async (name, args) => { calls.push({ invoke: name, args }); return { data: { invitationId: 'invitation', actionLink: 'https://example.com/login' }, error: null }; } },
    auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react
    : name.endsWith('/supabase/client') ? { createClient: () => client }
    : name.endsWith('.module.css') ? { default: {} }
    : require(name);
  const source = fs.readFileSync(path.join(__dirname, '../components/OrganizationTeamManager.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText + '\nexports.LeaguePicker = LeaguePicker; exports.MemberCard = MemberCard; exports.accessForLeague = accessForLeague; exports.selectedLeagueAccess = selectedLeagueAccess;', {
    module, exports: module.exports, require: mockRequire, setTimeout, clearTimeout, window: { setTimeout, clearTimeout }, Set, Promise,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({}) }; },
  });
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children)]; }
  function renderer(Component, props) {
    const runner = { cursor: 0, cells: [], effects: [] };
    let tree;
    const render = next => { if (next) props = next; active = runner; runner.cursor = 0; tree = Component(props); while (runner.effects.length) runner.effects.shift()(); return tree; };
    render();
    return { render, nodes: () => nodes(tree), text: () => JSON.stringify(tree) };
  }
  return { exports: module.exports, calls, nodes, renderer, root: () => renderer(module.exports.default, { organizationId: 'org', organization: 'Org', canManage: true, leagues }) };
}
test('missing grant metadata fails closed and serialization retains explicit no-access choice', () => {
  const t = setup();
  assert.deepEqual(plain(t.exports.accessForLeague(leagueA, [])), { league_id: leagueA, all_locations: false, location_ids: [] });
  assert.deepEqual(plain(t.exports.selectedLeagueAccess([leagueA], [], locations)), [{ league_id: leagueA, all_locations: false, location_ids: [] }]);
});
test('All locations is an explicit per-league checkbox with location choices beneath', () => {
  const t = setup();
  let access = [];
  const props = () => ({ leagues, selected: [leagueA, leagueB], locations, access, onChange() {}, onAccessChange: value => access = value });
  const r = t.renderer(t.exports.LeaguePicker, props());
  const checkbox = label => r.nodes().find(n => n.type === 'input' && n.props['aria-label'] === label);
  assert.equal(checkbox('All locations for League A').props.checked, false);
  assert(r.text().includes('No locations selected. This person will have no game access'));
  checkbox('All locations for League A').props.onChange({ target: { checked: true } }); r.render(props());
  assert.equal(checkbox('All locations for League A').props.checked, true);
  assert.equal(checkbox('North Park in League A').props.disabled, true);
  assert.equal(checkbox('North Park in League A').props.checked, true);
  assert.equal(checkbox('All locations for League B').props.checked, false);
  checkbox('All locations for League A').props.onChange({ target: { checked: false } }); r.render(props());
  checkbox('North Park in League A').props.onChange({ target: { checked: true } }); r.render(props());
  assert.equal(checkbox('North Park in League A').props.checked, true);
  assert.equal(checkbox('North Park in League B').props.checked, false);
  assert.deepEqual(plain(access), [{ league_id: leagueA, all_locations: false, location_ids: [siteA] }]);
});
test('existing All locations and selected-location grants round-trip independently', async () => {
  const t = setup(); const root = t.root(); await tick(); root.render();
  assert.deepEqual(t.calls.slice(0, 3).map(c => c.rpc), ['get_organization_team', 'get_organization_setup_directory', 'get_organization_locations']);
  const card = root.nodes().find(n => n.type?.name === 'MemberCard');
  const r = t.renderer(t.exports.MemberCard, card.props); r.render();
  const picker = r.nodes().find(n => n.type?.name === 'LeaguePicker');
  assert.deepEqual(plain(picker.props.access), member.league_access);
  await card.props.onSave(member, ['assignor'], [], [leagueA, leagueB], picker.props.access);
  const save = t.calls.find(c => c.rpc === 'set_organization_user_roles');
  assert.deepEqual(plain(save.args.p_league_access), member.league_access);
});
test('editing pending invitations sends paired location scopes atomically with roles', async () => {
  const pending = { ...member, id: 'pending', status: 'pending' };
  const t = setup({ members: [], invitations: [pending] }); const root = t.root(); await tick(); root.render();
  const card = root.nodes().find(n => n.type?.name === 'MemberCard');
  const access = [{ league_id: leagueA, all_locations: false, location_ids: [] }, { league_id: leagueB, all_locations: false, location_ids: [siteA] }];
  await card.props.onSave(pending, ['assignor'], [], [leagueA, leagueB], access);
  const save = t.calls.find(c => c.rpc === 'set_organization_invitation_roles');
  assert.deepEqual(plain(save.args.p_league_access), access);
});
test('new invitation forwards identical selected location scope to endpoint and role RPC', async () => {
  const t = setup(); const root = t.root(); await tick(); root.render();
  root.nodes().find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: 'new@example.com' } });
  const picker = root.nodes().find(n => n.type?.name === 'LeaguePicker');
  assert.deepEqual(plain(picker.props.selected), []);
  picker.props.onChange([leagueA]);
  picker.props.onAccessChange([{ league_id: leagueA, all_locations: false, location_ids: [siteB] }]);
  root.render(); root.nodes().find(n => n.type === 'button' && n.props.children === 'Send invitation').props.onClick();
  await tick(); await tick();
  const invoke = t.calls.find(c => c.invoke); const update = t.calls.find(c => c.rpc === 'set_organization_invitation_roles');
  assert.deepEqual(plain(invoke.args.body.leagueAccess), [{ league_id: leagueA, all_locations: false, location_ids: [siteB] }]);
  assert.deepEqual(plain(update.args.p_league_access), plain(invoke.args.body.leagueAccess));
});
test('owner remains exempt and failed location catalog prevents editing', async () => {
  const t = setup(); const owner = { ...member, owner: true };
  const r = t.renderer(t.exports.MemberCard, { item: owner, leagues, locations, disabled: false, saving: false, onSave: async () => {} });
  assert(!r.nodes().some(n => n.type?.name === 'LeaguePicker'));
  const failed = setup({ locationError: { message: 'Location access denied' } }); const root = failed.root(); await tick(); root.render();
  assert(root.text().includes('Location access denied')); assert(!root.nodes().some(n => n.type === 'button'));
});
