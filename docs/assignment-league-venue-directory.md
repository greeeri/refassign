# Assignment league venue directory

## Scope

Assignment Center's Venue options now come from distinct non-archived schedule
locations in the selected organization and league, across all dates and pages.
All Leagues is the authorized union. Past, canceled, held and future games
contribute locations; archived games and null/TBD locations do not. A null/TBD
game still appears in the table when no venue filter is selected.

Complexes use exact current organization metadata and contain only fields in
that scoped schedule. Shared names, addresses or sibling membership never add
another league's fields. Historical names remain subject to existing location
RLS. This does not change game-creation options or the location administration
directory.

The new `get_assignment_venue_directory(uuid, uuid)` function is STABLE SECURITY
INVOKER, with an empty search path. Existing game/location/link RLS remains in
force. An additional management-scope predicate excludes personal-only game
access outside the user's league/location grants. PUBLIC/anon cannot execute
the function; authenticated and service_role can. No table policy, table grant,
membership, role, or league/location grant changes. This rebase introduces no
new SQL behavior: the reviewed RPC was already installed before this frontend.

## Loading and invalidation

- One paginated RPC returns location ID, field name and complex together.
- With no selected venue, the today-forward first 50 rows are published to React
  state before the background directory starts. It is not awaited by assignment
  readiness or the automatic two-field summary. This is ordering verification,
  not a claim that a physical browser paint has already completed.
- Any selected field or complex waits for the scoped directory so invalid choices
  are pruned before a table request. A background directory failure clears the
  picker and reports the error without erasing an already actionable game page.
- A single in-memory cache slot is keyed by authenticated user, organization,
  full-access flag, freshly fetched paired league/location grants and selected
  league. Pending and completed requests can be reused for at most 30 seconds.
- Page and unrelated filter changes reuse the directory. League, organization,
  identity or verified grants changes do not reuse it. Old visible options are
  cleared before an authorization-changed request finishes, even if props lag.
- Schedule edits, archive, Undo and calendar sync call the existing full refresh,
  which invalidates the slot. Errors are not cached and clear old presentation.
- Existing load generations ignore late responses. Invalid field/complex
  selections are pruned before a table request; the production filter effect
  then loads the corrected snapshot. Valid shared choices are retained.
- Game matching, independent totals and 50-game hydration remain unchanged.

## Evidence

Read-only production aggregate on 2026-10-23 for Iowa Referee Committee / JUSC:

| Directory payload shape | Old | New |
| --- | ---: | ---: |
| Membership rows | 135 | Included in combined rows |
| Separate field-name rows | 135 | None |
| Combined directory rows | None | 40 |
| PostgreSQL JSON serialization bytes | 22,620 | 4,791 |
| Directory requests for this fixture | 2 | 1 cold / 0 reused |

JUSC has 202 non-archived games at those 40 locations. Its coverage record has no
specific location, so the organization directory is not league membership.
The compared JSON payload is 78.8% smaller. This is not compressed HTTP payload
or observed production/browser loading latency. SQL/RLS tests and query mocks
validate request scope, paging and cache behavior; a live preview/network canary
is still required before claiming end-to-end latency improvement.

## Release

The reviewed SQL draft is `supabase/assignment_venue_directory.sql`. Supabase CLI
was unavailable in the implementation environment, so no migration timestamp
was invented. The release owner must generate the migration identity using the
supported release workflow and preserve the reviewed SQL bytes. The
compatible RPC was installed before this frontend rebase; do not apply it again
for this source-only release. A missing RPC fails the venue picker closed and
does not fall back to the organization-wide catalog. Unfiltered game rows remain
independent of a background picker failure.

Run `npm run test:data-access`, `npx tsc --noEmit --incremental false` and
`npm run build` against the final integrated source. Tests cover actual SQL/RLS,
more than 1,000 locations, paired grants, all-league union, late successes,
pending revocation/user changes, errors, expiry, schedule refresh and the real
filter-effect reload after selection pruning.
