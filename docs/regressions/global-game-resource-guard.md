# Global game resource guard

League/location RLS can hide a conflicting game from an administrator who may
edit another game. The resource trigger must inspect all games privately while
leaving the administrator's SELECT and write permissions unchanged.

The repair replaces the invoker trigger with
`private.enforce_global_game_resource_conflict()`: SECURITY DEFINER, an empty
search path, fully qualified application objects, and no callable privilege for
PUBLIC, anon or authenticated. Errors identify the resource conflict without
revealing the hidden game. The migration changes no assignments or existing game
rows and does not widen any RLS policy.

Real team IDs and canonical field IDs are locked transactionally in a consistent
order before querying overlaps. Under the application's READ COMMITTED isolation,
a waiting save sees the committed winning game and fails. Half-open intervals
allow adjacent games. Ordinary suspended games reserve resources; venue review
holds and cancelled/rained-out games retain their existing exclusions. A review
hold clears only after a successful activation with confirmed time and field.

## Verification

- `npm run test:data-access`: scoped security and application regression tests,
  including the original invoker failure as a negative control and the repaired
  hidden-league/cross-organization paths.
- `npm run test:game-resources`: serial resource tests; also genuine concurrent
  PostgreSQL transactions when `REFASSIGN_TEST_POSTGRES_URL` points to an isolated
  localhost test server. The test creates and drops a disposable database; never
  use production credentials. GitHub Actions supplies PostgreSQL 16.
- Concurrency cases: cross-organization field inserts, real-team inserts at
  separate fields, simultaneous reschedules, and existing official conflicts.
- Hold cases exercise direct writes and the supported status RPC, verify the flag
  cannot be cleared alone, and preserve assignment IDs, responses and fees.

This migration prevents new conflicting writes. It does not audit or repair
pre-existing overlaps, fix calendar-sync official rescheduling, or change Bound
team identity resolution. Those are separate issues.
