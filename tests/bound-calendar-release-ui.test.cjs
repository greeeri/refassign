const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync('components/AssignmentsManagerV2.tsx','utf8');
function setup(response = { data: { status: 'active' } }) {
  const calls = [], notices = [], errors = []; let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const context = { canManage: true, calendarReleaseLock: { current: false }, calendarReleaseOrganization: { current: 'org' }, organizationId: 'org',
    setCalendarReleaseSaving: value => calls.push(['saving',value]), setError: error => errors.push(error), setNotice: notice => notices.push(notice),
    supabase: { rpc: async (name,args) => { calls.push([name,args]); await pending; return response; } }, load: async () => calls.push(['load']), Error };
  const code = source.slice(source.indexOf('  async function reviewAndReleaseCalendarHold('),source.indexOf('  async function confirmCalendarReview('));
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; globalThis.run = reviewAndReleaseCalendarHold;',context);
  return { ...context, calls, notices, errors, finish, run: () => context.run({ id:'game',bound_hold_checked_at:'2026-10-18T22:00:00Z' }) };
}
test('combined calendar action sends one fresh release and prevents repeat clicks',async()=>{
  const t=setup(); const first=t.run(); await t.run(); assert.equal(t.calls.filter(c=>c[0]==='review_and_release_bound_game').length,1);
  assert.equal(t.calls.find(c=>c[0]==='review_and_release_bound_game')[1].p_expected_hold_checked_at,'2026-10-18T22:00:00Z');
  t.finish(); await first; assert.match(t.notices[0],/hold released/); assert.equal(t.calendarReleaseLock.current,false);
});
test('failed release does not report success or call separate acknowledgment',async()=>{
  const t=setup({error:{message:'Live team overlap. No review was acknowledged.'}});const run=t.run();t.finish();await run;
  assert.match(t.errors.at(-1),/Live team overlap/);assert.equal(t.notices.length,0);assert.equal(t.calls.some(c=>c[0]==='confirm_calendar_game_review'),false);assert.equal(t.calendarReleaseLock.current,false);
});
test('cancellation remains canceled and organization change ignores late results',async()=>{
  const t=setup({data:{status:'canceled'}});const run=t.run();t.finish();await run;assert.match(t.notices[0],/remains Cancelled/);
  const switched=setup();const old=switched.run();switched.calendarReleaseOrganization.current='new-org';switched.finish();await old;assert.equal(switched.notices.length,0);assert.equal(switched.calls.some(c=>c[0]==='load'),false);
});
test('unresolved release stays disabled while acknowledgment is separately available',()=>{
  assert.match(source,/!g.bound_hold_resolution_candidate \|\| !g.venue_conflict_hold/);
  assert.match(source,/Review & release hold/);
  assert.match(source,/You can still mark the calendar reviewed/);
  assert.match(source,/confirmCalendarReview\(\[g.id\]\)/);
});
