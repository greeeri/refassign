# League and location access

## Authority model

- Organization owners and protected platform superadministrators retain organization-wide authority. Other roles never acquire it through a legacy profile role or a multi-role combination.
- An administrator or assignor needs a current membership and an explicit active league grant. Each grant has `all_locations` or an exact `location_ids` allowlist. Restrictions apply equally to administrator + assignor combinations.
- `All locations` includes games whose location is missing/TBD. A selected-location grant does not. An unchecked All box with no selected locations permits no games. A missing grant never means All.
- Restricted location IDs must be active locations connected to the same organization. Shared venue names, addresses and field-complex labels do not confer location authority.
- Personal official/crew reads remain independent. A personally assigned game outside the management scope does not permit manager edits, deletion or reassignment. Personal responses continue through checked response APIs/RPCs.

Canonical authority comes from `organization_memberships`, `organization_member_league_access`, active coverage, active location links and subscription state. The access-profile array is display metadata, not a fallback grant.

## Capabilities

| Capability | Scoped administrator/assignor | Owner/protected administrator |
| --- | --- | --- |
| Games, imports using existing authorized resources, scheduling, status, archive/delete | Only authorized league/location pairs | Organization-wide |
| Assign, publish, confirm, transfer/switch, AutoAssign, check-in | Only authorized games; both sides and every linked member checked | Organization-wide |
| Game fees, manual reports, game communications and payroll | Only authorized games; mixed-scope batches rejected as a unit | Organization-wide |
| League settings, league-wide eligibility and league templates | Requires All locations for that selected league | Organization-wide |
| Official rankings | Personal ratings for readable eligible officials | Personal ratings plus shared administration |
| Official identity, global level eligibility/certification, roster import/invitations/status | Read-only; no shared mutation | Organization-owner operation |
| Team/level/location shared records, league mileage plan and new shared venue connections | Existing scoped options only | Organization-owner operation |
| Roles, invitations, coverage, location grants and connection links | Not available | Organization-owner operation |
| Contacts, shared billing identity, organization subscription/tax documents | Not available for changes | Organization-owner operation |
| Shared AutoAssign rule edits, global import-error resolution, organization-wide audit summaries | Not available | Organization-owner operation |
| Scheduled organization-wide report delivery and Undo | Not available | Organization-owner operation |
| Platform-wide sports/rules catalog | Not available | Protected platform administrator only |

Whole-league calendar feeds are unavailable for selected-location grants. Existing field-complex relationships help identify candidate fields but do not widen a restricted location grant. A scoped user cannot attach a guessed hidden team, level, venue, official or billing-account ID to make it visible. For a venue without an authorized history/relationship, an owner first establishes that association or explicitly selects the location grant. Team/level options come from explicit league configuration or authorized historical games, not the old null-means-entire-organization fallback.

## Migration bounds

`20261022195617_scope_administrators_to_selected_leagues.sql` runs in one transaction. It does not add memberships, roles or league grants. Existing league-grant rows receive All locations, preserving their existing location footprint. Existing pending invitations retain All locations only for their already-selected league IDs. New grants and omitted location metadata default to no locations. Role edits preserve existing restricted-location choices, including calls made by older clients.

The migration replaces broad permission helpers, adds restrictive RLS fences that cannot be bypassed by an old permissive policy, and hardens checked RPCs and legacy AutoAssign execution. The application also scopes its database queries before pagination and bounds related lookups to returned games/officials. Service-role routes separately authorize every requested identifier.

## Validation and rollout

Local checks include actual PostgreSQL/RLS deny-side tests, service-route/query tests, frontend query and owner-control tests, TypeScript, the bounded-read checker and full migration compilation against a schema-only deployed-catalog snapshot. The snapshot is not a production apply and omits production rows, triggers, constraints, table ACLs and extension internals; deployed function EXECUTE grants are replayed and checked. Live browser/PostgREST and production performance have not been measured by these tests.

### Coordinated release order

1. Confirm the intended project, deployed commit, migration inventory and `docs/league-location-preflight.sql` fingerprints. The read-only fingerprint query must return zero drift rows. Review any mismatch instead of overwriting newer function behavior. Capture pre-migration grant-row counts and the exact `(organization_id,user_id,league_id)` set for comparison; no new league may appear.
2. During an announced short configuration interruption, deploy the new application/server guards and invitation edge function first. Before the columns/RPC signatures exist, scoped actions and grant changes may fail closed. This ordering avoids the unsafe alternative of old service-role routes continuing to bypass the new DB model.
3. Apply the single transaction migration only after explicit permission. It preserves existing league identities, marks existing exact grants All, and defaults new grants to selected-empty. Deploying the SQL alone is not a completed security rollout.
4. Perform the read-only checks below immediately. Then use an approved isolated test account/fixture for write-denial smoke tests and a browser check of the selector. Do not alter a real member’s grants merely for testing.

### Expected post-release read-only checks

- Hidajet: fresh memberships/access profile still list the same roles and only High School - MISOA. The existing grant is All locations. Whole-organization authority is false; manage/read predicates return true only for the selected active league and false for the other six. No user role or additional league was granted.
- Erin: actual owner and protected superadministrator predicates remain true. Her broad organization controls remain available even with multiple membership rows.
- Compare pre/post exact membership and league-grant sets; only the new location columns and invitation metadata should be populated. Verify active/inactive coverage, subscriptions, null/TBD locations and selected-empty behavior with read predicates.
- Inspect effective RLS and EXECUTE grants, including retirement of both legacy unscoped AutoAssign entry points and no public execution of internal grant-normalization/synchronization functions.
- Through a legitimate signed-in scoped session, inspect PostgREST/RPC/network results, not only the dropdown. Games and related queries must contain league/location restrictions before pagination; unrelated league rows must not be returned. Repeat for an owner.
- Measure request counts, returned row counts and loading time before claiming a production performance improvement. Current tests verify bounded queries, not observed production speed.

Write-denial tests must use approved isolated fixtures: excluded league/location, null location with selected-only scope, mixed linked/payroll/overdue batches, self-owner/self-grant attempts, and source/destination moves. Local tests cover these boundaries without touching live user records.

Do not roll back to old broad permission helpers or old service-role routes as an automatic recovery step. Keep deny-side boundaries and fix forward, or temporarily disable affected scoped operations. Restoring broad authority would be a separate security-sensitive action requiring approval.
