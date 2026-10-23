const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');

function loadModule(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, Intl,
    require: name => name.startsWith('.') ? loadModule(path.resolve(path.dirname(file), `${name}.ts`)) : require(name),
  });
  return module.exports;
}

const { readBoundedGamePage } = loadModule('lib/assignments/boundedGamePage.ts');
const { eventTimeParts } = loadModule('lib/event-time.ts');
const assignmentDateInRange = (at, location, from, to) => { const date = eventTimeParts(at, location).date; return date >= from && date <= to; };
const copy = value => JSON.parse(JSON.stringify(value));
const game = (index, extras = {}) => ({
  id: `game-${String(index).padStart(6, '0')}`,
  starts_at: new Date(Date.UTC(2026, 9, 23, 0, index)).toISOString(),
  ...extras,
});
const compare = (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ids = rows => Array.from(rows, row => row.id);

function fixture(sources, overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      sourceCount: sources.length,
      matches: () => true,
      readPage: async (sourceIndex, from, to) => {
        calls.push({ sourceIndex, from, to });
        return { data: sources[sourceIndex].slice(from, to + 1), error: null };
      },
      ...overrides,
    },
  };
}

test('filters mixed venue-local boundaries and Day/Time before the visible limit', async () => {
  const rows = [
    game(1, { starts_at: '2026-10-23T04:30:00Z', location: { state: 'CA' } }),
    game(2, { starts_at: '2026-10-23T04:30:00Z', location: { state: 'NY' } }),
    game(3, { starts_at: '2026-10-23T19:00:00Z', location: { state: 'CA' } }),
    game(4, { starts_at: '2026-10-24T01:00:00Z', location: { state: 'IA' } }),
    game(5, { starts_at: '2026-10-24T09:59:00Z', location: { state: 'HI' } }),
    game(6, { starts_at: '2026-10-24T09:59:00Z', location: { state: 'NY' } }),
  ];
  const f = fixture([[rows[0], rows[2], rows[4]], [rows[1], rows[3], rows[5]]], {
    matches: row => assignmentDateInRange(row.starts_at, row.location, '2026-10-23', '2026-10-23')
      && eventTimeParts(row.starts_at, row.location).date === '2026-10-23'
      && ['00:30', '20:00', '23:59'].includes(eventTimeParts(row.starts_at, row.location).time),
    pageSize: 2, batchSize: 2,
  });
  const first = await readBoundedGamePage(f.options);
  assert.equal(first.error, null);
  assert.deepEqual(ids(first.data), [rows[1].id, rows[3].id]);
  assert.equal(first.hasMore, true);
  const second = await readBoundedGamePage({ ...f.options, offsets: first.nextOffsets });
  assert.deepEqual(ids(second.data), [rows[4].id]);
  assert.equal(second.hasMore, false);
});

test('globally orders source heads by instant then id, including equal timestamps', async () => {
  const at = starts_at => ({ starts_at });
  const sources = [
    [game(2, at('2026-10-23T05:00:00Z')), game(5, at('2026-10-23T08:00:00Z'))],
    [game(1, at('2026-10-23T00:00:00-05:00')), game(4, at('2026-10-23T08:00:00Z'))],
    [game(3, at('2026-10-23T05:00:00Z')), game(6, at('2026-10-23T09:00:00Z'))],
  ];
  const f = fixture(sources, { batchSize: 1 });
  const result = await readBoundedGamePage(f.options);
  assert.deepEqual(ids(result.data), [1, 2, 3, 4, 5, 6].map(index => game(index).id));
  assert.equal(result.hasMore, false);
});

test('retains Postgres sub-millisecond timestamp order before comparing ids', async () => {
  const f = fixture([
    [game(1, { starts_at: '2026-10-23T05:00:00.000002Z' })],
    [game(4, { starts_at: '2026-10-23T05:00:00.000001Z' })],
    [game(3, { starts_at: '2026-10-23T00:00:00.0000010-05:00' })],
    [game(2, { starts_at: '2026-10-23T05:00:00.00001Z' })],
  ]);
  const result = await readBoundedGamePage(f.options);
  assert.deepEqual(ids(result.data), [3, 4, 1, 2].map(index => game(index).id));
});

test('50 plus one lookahead never consumes the 51st match or any buffered later rows', async () => {
  const rows = Array.from({ length: 151 }, (_, index) => game(index));
  const f = fixture([rows.filter((_, index) => index % 2 === 0), rows.filter((_, index) => index % 2 !== 0)]);
  const output = [];
  let offsets;
  for (const length of [50, 50, 50, 1]) {
    const result = await readBoundedGamePage({ ...f.options, offsets });
    assert.equal(result.data.length, length);
    output.push(...result.data);
    offsets = result.nextOffsets;
    assert.equal(result.hasMore, output.length < rows.length);
    if (offsets) assert.equal(offsets.reduce((sum, offset) => sum + offset, 0), output.length);
  }
  assert.deepEqual(ids(output), ids(rows));
  assert.equal(new Set(ids(output)).size, rows.length);
  assert.equal(offsets, null);
});

test('a locally filtered empty first raw batch does not end pagination', async () => {
  const outside = Array.from({ length: 50 }, (_, index) => game(index, {
    starts_at: '2026-10-23T04:30:00Z', location: { state: 'CA' },
  }));
  const inside = Array.from({ length: 51 }, (_, index) => game(index + 50, {
    starts_at: '2026-10-23T17:00:00Z', location: { state: 'CA' },
  }));
  const f = fixture([[...outside, ...inside]], {
    matches: row => assignmentDateInRange(row.starts_at, row.location, '2026-10-23', '2026-10-23'),
  });
  const first = await readBoundedGamePage(f.options);
  assert.deepEqual(ids(first.data), ids(inside.slice(0, 50)));
  assert.deepEqual(copy(first.nextOffsets), [100]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(f.calls.map(call => call.from), [0, 50, 100]);
  const last = await readBoundedGamePage({ ...f.options, offsets: first.nextOffsets });
  assert.deepEqual(ids(last.data), [inside[50].id]);
  assert.equal(last.hasMore, false);
});

test('empty-but-more after the scan budget advances the raw cursor without claiming global emptiness', async () => {
  const rows = Array.from({ length: 601 }, (_, index) => game(index));
  const f = fixture([rows], { matches: row => row.id >= game(550).id });
  const first = await readBoundedGamePage(f.options);
  assert.deepEqual(copy(first.data), []);
  assert.equal(first.hasMore, true);
  assert.deepEqual(copy(first.nextOffsets), [500]);
  assert.equal(f.calls.length, 10);
  assert.equal(f.calls.reduce((sum, call) => sum + call.to - call.from + 1, 0), 500);
  const second = await readBoundedGamePage({ ...f.options, offsets: first.nextOffsets });
  assert.deepEqual(ids(second.data), ids(rows.slice(550, 600)));
  assert.deepEqual(copy(second.nextOffsets), [600]);
  const last = await readBoundedGamePage({ ...f.options, offsets: second.nextOffsets });
  assert.deepEqual(ids(last.data), [rows[600].id]);
  assert.equal(last.hasMore, false);
});

test('a request-limited short page stops before an unknown source head can break chronology', async () => {
  const f = fixture([[game(0), game(1), game(2)], [game(100), game(101)]], {
    batchSize: 1, maxRequests: 2,
  });
  const first = await readBoundedGamePage(f.options);
  assert.deepEqual(ids(first.data), [game(0).id]);
  assert.deepEqual(copy(first.nextOffsets), [1, 0]);
  assert.equal(first.hasMore, true);
  assert.equal(f.calls.length, 2);
});

test('later source errors discard all partial data and do not issue a continuation cursor', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => game(index));
  const f = fixture([rows]);
  const reader = f.options.readPage;
  f.options.readPage = (source, from, to) => from === 50
    ? Promise.resolve({ data: null, error: { message: 'Later page denied' } })
    : reader(source, from, to);
  const result = await readBoundedGamePage(f.options);
  assert.deepEqual(copy(result), { data: null, error: { message: 'Later page denied' }, nextOffsets: null, hasMore: false });
});

test('initial source errors and rejected reads fail closed rather than expose other source data', async () => {
  for (const reject of [false, true]) {
    const result = await readBoundedGamePage({
      sourceCount: 2,
      matches: () => true,
      readPage: async index => {
        if (index === 0) return { data: [game(0)], error: null };
        if (reject) throw new Error('Source unavailable');
        return { data: null, error: { message: 'Source unavailable' } };
      },
    });
    assert.equal(result.data, null);
    assert.equal(result.error.message, 'Source unavailable');
    assert.equal(result.nextOffsets, null);
  }
});

test('caller cursors are immutable and invalid or mismatched cursors never query', async () => {
  const f = fixture([[game(0), game(1), game(2)], [game(3)]]);
  const offsets = Object.freeze([1, 0]);
  const result = await readBoundedGamePage({ ...f.options, offsets });
  assert.deepEqual(ids(result.data), [game(1).id, game(2).id, game(3).id]);
  assert.deepEqual(offsets, [1, 0]);
  assert.deepEqual(f.calls.map(call => call.from), [1, 0]);
  f.calls.length = 0;
  for (const bad of [[0], [0, 0, 0], [-1, 0], [0.5, 0], [NaN, 0], [Infinity, 0]]) {
    const invalid = await readBoundedGamePage({ ...f.options, offsets: bad });
    assert.equal(invalid.data, null);
    assert.match(invalid.error.message, /cursor/i);
  }
  assert.equal(f.calls.length, 0);
});

test('large multi-chunk selections remain globally ordered and bounded on every page', async () => {
  const rows = Array.from({ length: 1360 }, (_, index) => game(index));
  const sources = Array.from({ length: 17 }, (_, source) => rows.filter((_, index) => index % 17 === source));
  const f = fixture(sources);
  const output = [];
  let offsets;
  do {
    f.calls.length = 0;
    const result = await readBoundedGamePage({ ...f.options, offsets });
    assert.equal(result.error, null);
    assert(result.data.length <= 50);
    assert(f.calls.length <= 20);
    assert(f.calls.reduce((sum, call) => sum + call.to - call.from + 1, 0) <= 500);
    assert(f.calls.every(call => call.to - call.from + 1 <= 50));
    output.push(...result.data);
    offsets = result.nextOffsets;
    assert(output.length <= rows.length);
  } while (offsets);
  assert.deepEqual(ids(output), ids(rows));
});

test('too many sources fail explicitly before reading instead of silently dropping chunks', async () => {
  for (const options of [{ sourceCount: 21 }, { sourceCount: 3, maxScanned: 2 }]) {
    let called = false;
    const result = await readBoundedGamePage({
      ...options, matches: () => true,
      readPage: async () => { called = true; return { data: [], error: null }; },
    });
    assert.equal(called, false);
    assert.equal(result.data, null);
    assert.match(result.error.message, /Narrow your selected venues/);
    assert.equal(result.nextOffsets, null);
  }
});

test('small mixed budgets and predicates traverse every matching row exactly once', async () => {
  const rows = Array.from({ length: 203 }, (_, index) => game(index, { starts_at: game(Math.floor(index / 3)).starts_at }));
  for (const sourceCount of [1, 3, 7]) {
    const sources = Array.from({ length: sourceCount }, (_, source) => rows.filter((_, index) => index % sourceCount === source));
    const matches = row => Number(row.id.slice(5)) % 5 === 0;
    const f = fixture(sources, { pageSize: 4, batchSize: 7, maxRequests: 8, maxScanned: 25, matches });
    const output = [];
    let offsets;
    let attempts = 0;
    do {
      const previous = offsets;
      f.calls.length = 0;
      const result = await readBoundedGamePage({ ...f.options, offsets });
      assert.equal(result.error, null);
      assert(f.calls.length <= 8);
      assert(f.calls.reduce((sum, call) => sum + call.to - call.from + 1, 0) <= 25);
      output.push(...result.data);
      offsets = result.nextOffsets;
      if (offsets && previous) assert(offsets.some((offset, index) => offset > previous[index]));
      assert(++attempts <= rows.length + 1, 'cursor must make forward progress');
    } while (offsets);
    assert.deepEqual(ids(output), ids(rows.filter(matches).sort(compare)));
  }
});

test('zero sources and exhausted raw sources return a definitive empty result', async () => {
  for (const sources of [[], [[]], [[], []]]) {
    const f = fixture(sources);
    const result = await readBoundedGamePage(f.options);
    assert.deepEqual(copy(result), { data: [], error: null, nextOffsets: null, hasMore: false });
  }
});

test('bad configuration, oversized responses, and invalid timestamps fail closed', async () => {
  for (const options of [{ pageSize: 0 }, { batchSize: -1 }, { maxRequests: 0 }, { maxScanned: NaN }, { sourceCount: -1 }]) {
    const f = fixture([[game(0)]], options);
    assert.equal((await readBoundedGamePage(f.options)).data, null);
    assert.equal(f.calls.length, 0);
  }
  const oversized = await readBoundedGamePage({
    sourceCount: 1, batchSize: 1, matches: () => true,
    readPage: async () => ({ data: [game(0), game(1)], error: null }),
  });
  assert.match(oversized.error.message, /unbounded/);
  const f = fixture([[game(0, { starts_at: 'invalid' })]]);
  assert.equal((await readBoundedGamePage(f.options)).data, null);
});
