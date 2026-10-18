const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function loader(fetch) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assignments/readOnlySchedule.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, fetch, URLSearchParams, Number, Error });
  return module.exports.readOnlySchedule;
}
const response = body => ({ ok: true, json: async () => body });

test('client follows all server pages, pinning date and forwarding abort signal', async () => {
  const calls = [], controller = new AbortController();
  const read = loader(async (url, options) => {
    calls.push(url);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
    const offset = Number(new URL(url, 'https://example.com').searchParams.get('offset'));
    return response({ games: [{ id: offset }], isMentor: true, hasMore: offset < 2, nextOffset: offset + 1, from: '2026-10-18' });
  });
  const result = await read('org', controller.signal);
  assert.equal(JSON.stringify(result.games), JSON.stringify([{ id: 0 }, { id: 1 }, { id: 2 }]));
  assert.equal(result.isMentor, true);
  assert.equal(calls.length, 3);
  assert(calls[1].includes('from=2026-10-18'));
});

test('later-page error rejects the whole load, not a successful partial schedule', async () => {
  let calls = 0;
  const read = loader(async () => ++calls === 1
    ? response({ games: [{ id: 1 }], hasMore: true, nextOffset: 500, from: '2026-10-18' })
    : { ok: false, json: async () => ({ error: 'Access changed' }) });
  await assert.rejects(read('org', new AbortController().signal), /Access changed/);
  assert.equal(calls, 2);
});

test('repeated cursor is rejected instead of looping forever', async () => {
  const read = loader(async () => response({ games: [], hasMore: true, nextOffset: 0, from: '2026-10-18' }));
  await assert.rejects(read('org', new AbortController().signal), /next assignment page/);
});

test('abort prevents a superseded load from completing', async () => {
  const controller = new AbortController();
  let calls = 0;
  const read = loader(async (_, { signal }) => {
    if (++calls === 1) {
      controller.abort();
      return response({ games: [{ id: 1 }], hasMore: true, nextOffset: 500, from: '2026-10-18' });
    }
    signal.throwIfAborted();
  });
  await assert.rejects(read('old-org', controller.signal), { name: 'AbortError' });
});
