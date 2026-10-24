# Explicit venue parents: database implementation

## Review artifacts (not applied to production)

- `supabase/explicit_venue_parents.sql`
- `supabase/migrations/20261024180343_explicit_venue_parents.sql`
- `tests/explicit-venue-parents-rpc.test.cjs`

The migration filename was generated with `supabase migration new explicit_venue_parents`; it was not invented. Its bytes must equal the standalone review SQL (enforced by the test). The isolated local fixture executes this SQL; neither artifact was applied to a remote database.

## Contract

- `get_location_venue_options()` returns `id, name, address, city, state`. It returns only venues readable under the caller's existing RLS; an unattached or otherwise invisible venue is not exposed to ordinary organization owners. Super-admins retain their existing broader visibility. Clients must paginate this RPC and use IDs as values, not names.
- `set_location_venue(p_location_id, p_venue_id, p_expected_venue_id)` returns the saved parent UUID, or SQL `NULL` after an explicit unassignment. All three arguments are required. The expected parent is the loaded value, including `NULL`, not the selected draft. A missing login, denied field, unreadable parent or zero-row update raises `42501`; a stale parent raises `40001`. The row is locked before checking. Clients must not claim success after errors.
- `get_assignment_venue_directory_v2(p_organization_id, p_league_id default null)` returns `location_id, name, field_complex, venue_id, venue_name`. It mirrors the existing directory's exact organization/league/management filtering before joining parent data. The old RPC is not altered. Unassigned fields stay present. A venue never expands the result to unrelated sibling fields.

All three functions are `SECURITY INVOKER`, use an empty search path and schema-qualified relations, and revoke execute from `PUBLIC` and `anon`. Authenticated users may execute them; only the read RPCs explicitly grant execute to `service_role`. Existing table grants and policies are unchanged. The setter also checks the existing shared-location management predicate; it does not turn league-only administrators into shared-catalog managers.

## Deliberately unchanged

- `locations.id`, `games.location_id`, game IDs, assignments and the existing parent FK are retained.
- No parent is inferred, inserted, merged, deleted or backfilled by this migration.
- `locations.field_complex`, `organization_locations.field_complex`, their authorization helpers, and transfer security semantics are untouched.
- Existing legacy complex-based sibling read visibility can still make a sibling venue visible in the options list. This is pre-existing authorization, not permission created by this change. The assignment directory still limits its field results to the selected authorized schedule.
- Venue creation/editing remains under existing super-admin fences. An owner who cannot see the desired venue needs the existing catalog administrator workflow, not an authorization bypass.

## Indexes

- `locations_venue_id_id_idx (venue_id, id) WHERE venue_id IS NOT NULL` supports parent lookups and existing venue-read policy lookups.
- `games_assignment_venue_directory_idx (organization_id, league_id, location_id) WHERE archived_at IS NULL AND location_id IS NOT NULL` supports the scoped field projection. All-league requests can use its organization prefix.

Local `EXPLAIN (FORMAT JSON)` tests disable sequential scans only for the tiny fixture and prove both indexes are eligible for their intended predicates. They are **not** production latency benchmarks. A production/staging plan and lock window should be checked before an authorized deployment; no remote application or performance claim is made here.

## Verification

Run from the repository root:

```sh
node --test tests/explicit-venue-parents-rpc.test.cjs tests/assignment-venue-directory-rpc.test.cjs tests/league-admin-security.test.cjs
```

The new PGlite suite executes real authorization predicates and restrictive policies from the repository fixture. It tests explicit assignment/change/clear, optimistic-concurrency failure including NULL transitions, permission denials, hidden/missing parents, unchanged RLS/grants and row identities, legacy complex preservation, same-name venue identity, rename stability, selected-league boundaries, index eligibility and migration idempotence. Stale expected-value tests are deterministic sequential simulations, not a multi-connection concurrency benchmark.

The existing directory suite additionally covers historical/inactive fields, archived/TBD games, paired league/location grants, revoked grants and deterministic paging past 1,000 fields. Run the aggregate application checks separately before releasing the complete UI change.
