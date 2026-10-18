const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function setup(needsFullFetch = false, httpStatus = 304) {
  const calls = []; const module = { exports: {} };
  const feed = { id: 'feed', run_id: 'run', url: 'https://gobound.com/ia/conferences/test/calendar/ical/abc', etag: 'old-tag', last_modified: 'old-date', content_hash: 'old-hash', needs_full_fetch: needsFullFetch };
  const service = { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'claim_bound_calendar_feed' ? feed : { ok: true }, error: null }; } };
  const fetch = async (url, options) => { calls.push({ url, options }); return new Response(httpStatus === 304 ? null : 'calendar', { status: httpStatus }); };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/server/bound-calendar-sync.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => name.endsWith('/bound-calendar') ? { parseBoundCalendar: () => ({ events: [{ uid: 'a' }], hash: 'new-hash' }) } : {}, fetch, URL, AbortSignal, Buffer, Uint8Array, Error });
  return { calls, run: force => module.exports.syncBoundFeed(service, 'feed', force) };
}
test('unchanged HTTP 304 still invokes database hold recheck', async () => {
  const t = setup(); await t.run(false);
  assert.equal(t.calls.find(c => c.options).options.headers['If-None-Match'], 'old-tag');
  const apply = t.calls.find(c => c.name === 'apply_bound_calendar_feed');
  assert.equal(apply.args.p_events, null);
  assert.equal(apply.args.p_hash, 'old-hash');
});
test('legacy snapshots and manual refresh fetch complete calendar rather than cached 304', async () => {
  for (const [needsFullFetch, force] of [[true,false],[false,true]]) {
    const t = setup(needsFullFetch, 200); await t.run(force);
    const headers = t.calls.find(c => c.options).options.headers;
    assert.equal(headers['If-None-Match'], undefined);
    assert.equal(headers['If-Modified-Since'], undefined);
    assert.equal(t.calls.find(c => c.name === 'apply_bound_calendar_feed').args.p_events[0].uid, 'a');
  }
});
