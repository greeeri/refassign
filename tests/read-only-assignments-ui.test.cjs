const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const game = id => ({ id, game_number: id, starts_at: '2026-12-01T12:00:00Z', status: 'active', officials_needed: 1, home: { name: id }, away: null, location: null, leagues: null, assignments: [] });

// A deterministic hook runner exercises effects and event callbacks without a browser or production services.
function setup() {
  const cells = [], loads = [], posts = [], effects = [];
  let cursor = 0, props = { organizationId: 'old-org' }, tree;
  const react = {
    useState(initial) { const id = cursor++; if (!(id in cells)) cells[id] = initial; return [cells[id], value => { cells[id] = typeof value === 'function' ? value(cells[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in cells)) cells[id] = { current: initial }; return cells[id]; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, deps) {
      const id = cursor++, previous = cells[id];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        cells[id] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { cells[id].cleanup?.(); cells[id].cleanup = fn(); });
      }
    },
  };
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? react
    : name.endsWith('.module.css') ? { default: {} }
    : name.endsWith('/readOnlySchedule') ? { readOnlySchedule: (organizationId, signal) => { const d = defer(); loads.push({ ...d, organizationId, signal }); return d.promise; } }
    : require(name);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ReadOnlyAssignments.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, require: mockRequire, AbortController, URLSearchParams, Date, Set, Error,
    fetch: (url, options) => { const d = defer(); posts.push({ ...d, url, options }); return d.promise; },
  });
  function render(nextProps) {
    if (nextProps) props = nextProps;
    cursor = 0; tree = module.exports.default(props);
    while (effects.length) effects.shift()();
    return tree;
  }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(n => nodes(n));
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const buttons = () => nodes(tree).filter(n => n.type === 'button' && ['Self-Assign', 'Assigning…'].includes(n.props.children));
  const text = () => JSON.stringify(tree);
  render();
  return { render, loads, posts, buttons, text, nodes: () => nodes(tree) };
}

test('organization change aborts old load and ignores a late response', async () => {
  const t = setup();
  t.render({ organizationId: 'new-org' });
  assert.equal(t.loads[0].signal.aborted, true);
  t.loads[1].resolve({ games: [game('new-game')], isMentor: false });
  await tick(); t.render();
  t.loads[0].resolve({ games: [game('stale-game')], isMentor: true });
  await tick(); t.render();
  assert(t.text().includes('new-game'));
  assert(!t.text().includes('stale-game'));
  assert.equal(t.buttons().length, 0);
});

test('repeated self-assignment is guarded and failed request unlocks retry', async () => {
  const t = setup();
  t.loads[0].resolve({ games: [game('game-one'), game('game-two')], isMentor: true });
  await tick(); t.render();
  const button = t.buttons()[0];
  button.props.onClick(); button.props.onClick();
  assert.equal(t.posts.length, 1);
  t.render();
  assert(t.buttons().every(b => b.props.disabled));
  t.posts[0].reject(new Error('Network unavailable'));
  await tick(); t.render();
  assert(t.text().includes('Network unavailable'));
  assert(t.buttons().every(b => !b.props.disabled));
  t.buttons()[0].props.onClick();
  assert.equal(t.posts.length, 2);
  t.posts[1].resolve({ ok: true, json: async () => ({ success: true }) });
  await tick(); t.render();
  assert.equal(t.loads.length, 2);
  t.loads[1].resolve({ games: [game('refreshed-game')], isMentor: true });
  await tick(); t.render();
  assert(t.text().includes('refreshed-game'));
  assert(t.text().includes('Mentor assignment accepted.'));
});

test('late mutation result cannot refresh or report success in another organization', async () => {
  const t = setup();
  t.loads[0].resolve({ games: [game('old-game')], isMentor: true });
  await tick(); t.render();
  t.buttons()[0].props.onClick();
  t.render({ organizationId: 'new-org' });
  t.loads[1].resolve({ games: [game('new-game')], isMentor: true });
  await tick(); t.render();
  t.posts[0].resolve({ ok: true, json: async () => ({ success: true }) });
  await tick(); t.render();
  assert.equal(t.loads.length, 2);
  assert(!t.text().includes('Mentor assignment accepted.'));
  assert(t.text().includes('new-game'));
});


test('global filters find later-page games and refresh preserves display page', async () => {
  const t = setup();
  const games = Array.from({ length: 101 }, (_, i) => ({ ...game(`game-${i}`), location: { name: i === 100 ? 'Far venue' : 'Main venue' } }));
  t.loads[0].resolve({ games, isMentor: true });
  await tick(); t.render();
  const next = () => t.nodes().find(n => n.type === 'button' && n.props.children === 'Next');
  next().props.onClick(); t.render();
  assert(t.text().includes('game-50'));
  assert(!t.text().includes('game-0"'));
  t.buttons()[0].props.onClick();
  t.posts[0].resolve({ ok: true, json: async () => ({ success: true }) });
  await tick(); t.render();
  t.loads[1].resolve({ games, isMentor: true });
  await tick(); t.render();
  assert(t.text().includes('game-50'));
  t.nodes().find(n => n.type === 'input' && n.props.placeholder === 'Type a venue name').props.onChange({ target: { value: 'Far' } });
  t.render();
  assert(t.text().includes('game-100'));
  assert(!t.text().includes('game-50'));
  assert.equal(next().props.disabled, true);
});
