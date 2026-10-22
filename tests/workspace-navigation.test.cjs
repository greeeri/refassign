const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { createRoot } = require('react-dom/client');

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

const workspaceSource = compile(fs.readFileSync('app/workspace/page.tsx', 'utf8'));
const scopeSource = compile(fs.readFileSync('components/leagueGameScope.ts', 'utf8'));

function loadModule(source, dependencies, browser) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: dependencies,
    window: browser, localStorage: browser.localStorage,
    URLSearchParams, console,
  });
  return module.exports;
}

/** Real React reconciliation of the production shell, with data/leaf panes isolated. */
async function fixture({ role = 'owner', superAdmin = false } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://workspace.test/workspace' });
  const previousGlobals = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const lifecycle = [], warnings = [], dataReads = [];
  let finishDashboard;
  const dashboardRequest = new Promise(resolve => { finishDashboard = resolve; });
  const originalConsoleError = console.error;
  console.error = (...args) => { warnings.push(args.map(String).join(' ')); };
  const roles = role === 'admin+assignor' ? ['admin', 'assignor'] : [role];
  const workspace = {
    organization_id: 'organization', name: 'Organization', role: roles[0], roles,
    full_organization_access: role === 'owner', viewer_permissions: [],
    leagues: [{ league_id: 'league-a', name: 'League A', all_locations: false, location_ids: ['venue-a'] }],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user', email: 'owner@example.com', user_metadata: {} } } }) },
    from(table) {
      dataReads.push(table);
      const query = {
        select: () => query, eq: () => query, limit: () => query, maybeSingle: () => query,
        then: (resolve, reject) => Promise.resolve({ data: table === 'profiles' ? { full_name: 'Test Owner' } : null, error: null }).then(resolve, reject),
      };
      return query;
    },
    rpc: async (name) => ({ data: name === 'get_my_test_workspaces' ? [workspace]
      : name === 'current_user_roles' ? ['admin', 'assignor']
      : name === 'is_super_admin' ? superAdmin : false, error: null }),
  };
  const components = new Map();
  function component(name) {
    if (!components.has(name)) {
      const Pane = (props) => {
        const [loaded, setLoaded] = React.useState(false);
        React.useEffect(() => {
          let active = true;
          lifecycle.push(`mount:${name}`);
          if (name === 'DashboardGames') void dashboardRequest.then(() => { if (active) setLoaded(true); });
          return () => { active = false; lifecycle.push(`unmount:${name}`); };
        }, []);
        return React.createElement('section', {
          'data-pane': name,
          'data-full-access': String(props.fullLeagueAccess ?? props.fullOrganizationAccess ?? ''),
          'data-grants': JSON.stringify(props.leagueGameAccess || []),
        }, name === 'DashboardGames' ? loaded ? 'Dashboard ready' : 'Loading dashboard…' : name);
      };
      Pane.displayName = name;
      components.set(name, Pane);
    }
    return components.get(name);
  }
  const scope = loadModule(scopeSource, require, dom.window);
  const dependencies = (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/lib/supabase/client')) return { createClient: () => client, isTierTestRuntime: () => false };
    if (name.endsWith('/components/leagueGameScope')) return scope;
    if (name.includes('/components/')) return { __esModule: true, default: component(name.split('/').at(-1)), RefProMark: () => null };
    throw new Error(`Unexpected workspace dependency: ${name}`);
  };
  const Workspace = loadModule(workspaceSource, dependencies, dom.window).default;
  const root = createRoot(dom.window.document.getElementById('root'));
  await React.act(async () => { root.render(React.createElement(Workspace)); });
  const panes = () => [...dom.window.document.querySelectorAll('main [data-pane]')].map(node => node.dataset.pane);
  const button = label => [...dom.window.document.querySelectorAll('aside button')].find(node =>
    node.textContent === label || [...node.children].some(child => child.tagName === 'SPAN' && child.textContent === label));
  return {
    dom, lifecycle, warnings, dataReads, panes, button,
    async click(label) {
      const target = button(label);
      assert(target, `Missing navigation button: ${label}`);
      await React.act(async () => { target.click(); });
    },
    async resolveDashboard() { await React.act(async () => { finishDashboard(); }); },
    async close() {
      await React.act(async () => { root.unmount(); });
      console.error = originalConsoleError;
      for (const [key, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

test('owner navigation replaces a pending Dashboard instead of leaving orphaned panes', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.panes(), ['DashboardGames', 'UndoCenter']);
    assert.match(f.dom.window.document.querySelector('[data-pane="DashboardGames"]').textContent, /Loading dashboard/);
    if (!f.button('Assignment Center')) await f.click('Assignments');
    await f.click('Assignment Center');
    assert.deepEqual(f.panes(), ['AssignmentsManagerV2', 'UndoCenter']);
    assert(f.lifecycle.includes('unmount:DashboardGames'), 'the previous dashboard effect is cleaned up');
    assert.equal(f.dom.window.document.querySelector('[data-pane="AssignmentsManagerV2"]').dataset.fullAccess, 'true');
    await f.resolveDashboard();
    assert.deepEqual(f.panes(), ['AssignmentsManagerV2', 'UndoCenter'], 'a late dashboard response cannot restore an old pane');
    await f.click('Team & Roles');
    assert.deepEqual(f.panes(), ['OrganizationTeamManager', 'UndoCenter']);
    assert(f.lifecycle.includes('unmount:AssignmentsManagerV2'));
    for (let repeat = 0; repeat < 2; repeat++) {
      await f.click('Dashboard');
      assert.deepEqual(f.panes(), ['DashboardGames', 'UndoCenter']);
      if (!f.button('Assignment Center')) await f.click('Assignments');
      await f.click('Assignment Center');
      assert.deepEqual(f.panes(), ['AssignmentsManagerV2', 'UndoCenter']);
      await f.click('Team & Roles');
      assert.deepEqual(f.panes(), ['OrganizationTeamManager', 'UndoCenter']);
    }
    assert.deepEqual(f.warnings, [], 'navigation emits no duplicate-key or React lifecycle warnings');
  } finally { await f.close(); }
});

test('owner Payroll siblings have distinct identities and leave no residue on navigation', async () => {
  const f = await fixture();
  try {
    if (!f.button('Assignment Center')) await f.click('Assignments');
    await f.click('Payroll & Game Fees');
    assert.deepEqual(f.panes(), ['PayrollManager', 'MileageCoordinatesManager', 'UndoCenter']);
    await f.click('Assignment Center');
    assert.deepEqual(f.panes(), ['AssignmentsManagerV2', 'UndoCenter']);
    assert(f.lifecycle.includes('unmount:PayrollManager'));
    assert(f.lifecycle.includes('unmount:MileageCoordinatesManager'));
    assert.deepEqual(f.warnings, []);
  } finally { await f.close(); }
});

for (const role of ['assignor', 'admin', 'admin+assignor']) {
  test(`${role} navigation preserves league/location grants and does not restore owner controls`, async () => {
    const f = await fixture({ role });
    try {
      assert.deepEqual(f.panes(), ['DashboardGames']);
      assert.equal(f.button('Team & Roles'), undefined);
      if (!f.button('Assignment Center')) await f.click('Assignments');
      await f.click('Assignment Center');
      assert.deepEqual(f.panes(), ['AssignmentsManagerV2']);
      const assignments = f.dom.window.document.querySelector('[data-pane="AssignmentsManagerV2"]');
      assert.equal(assignments.dataset.fullAccess, 'false');
      assert.deepEqual(JSON.parse(assignments.dataset.grants), [{ league_id: 'league-a', all_locations: false, location_ids: ['venue-a'] }]);
      await f.click('Dashboard');
      assert.deepEqual(f.panes(), ['DashboardGames']);
      assert.deepEqual(f.warnings, []);
    } finally { await f.close(); }
  });
}

test('protected super-admin follows the same safe pane replacement without altering access', async () => {
  const f = await fixture({ role: 'admin', superAdmin: true });
  try {
    assert.deepEqual(f.panes(), ['DashboardGames', 'UndoCenter']);
    await f.click('Team & Roles');
    assert.deepEqual(f.panes(), ['OrganizationTeamManager', 'UndoCenter']);
    if (!f.button('Assignment Center')) await f.click('Assignments');
    await f.click('Assignment Center');
    assert.deepEqual(f.panes(), ['AssignmentsManagerV2', 'UndoCenter']);
    assert.equal(f.dom.window.document.querySelector('[data-pane="AssignmentsManagerV2"]').dataset.fullAccess, 'true');
    assert.deepEqual(f.warnings, []);
  } finally { await f.close(); }
});
