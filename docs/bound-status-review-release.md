# Bound calendar status and hold review release

## Scope
- Show Bound's source status separately from the operational RefAssign status, with an inline assignor recommendation in Games and Assignments.
- Keep calendar review acknowledgment separate from activation. Checking Reviewed does not change the game status or release a hold.
- Recheck held games after every successful Bound feed check, including unchanged payloads and HTTP 304. Mark resolution candidates for review, never automatically reactivate them.
- Preserve source cancellations as Cancelled. Retain audit records and existing assignment/payroll protections; do not notify officials from this reconciliation.
- Treat shared venue names as possible conflicts, not proof that two games use the same physical field.

## Release boundary
Production changes require release approval. Do not run all pending migrations. In particular, do not apply the unrelated JUSC team-level fallback migration in this release.

1. Apply only `20261018220000_bound_status_hold_rechecks.sql` to the intended RefAssign database. It adds source/hold metadata and guarded sync/recheck functions. Existing game statuses are not changed by migration deployment.
2. Deploy this branch's application commit after the new columns exist. Old application code is compatible with the additive schema; new application selects require those columns.
3. Run a fresh Bound-only sync for the four registered High School-MISOA feeds. Manual refresh requests bypass conditional HTTP caching; legacy snapshots also request a full fetch so missing normalized source evidence cannot be mistaken for resolution.
4. Verify expected operational delta against a fresh preflight: the eight source-CANCELLED overlap-held games become `canceled`, the other 19 remain `suspended`; no game becomes active. Any changed live-source evidence must be reviewed before asserting this exact count.
5. Verify all 27 have the correct source status and recommendation metadata, cancellation/resolution changes need review, assignments and payroll records are unchanged, no official notification was sent, and existing audit history is retained.
6. A repeat unchanged sync must retain review acknowledgments and add no repeated hold-change records. Check a held record's review checkbox and confirm its operational status remains On Hold.

## Rollback
Revert the application commit first if necessary. Keep the additive database metadata and audit history; do not automatically undo source cancellations or activate games. Any database function rollback needs separate review against actual sync activity since deployment.

## Combined review and release
The Assignments row offers “Review & release hold” for eligible resolved calendar overlap holds, alongside the existing Reviewed checkbox. The operation atomically validates manager/league access, freshness and live conflicts before recording review and activating. It does not override unresolved venue/team conflicts, missing details or unrelated manual holds. If blocked, neither review nor release is recorded; Mark reviewed remains available separately. For canceled games, “Review cancellation” records review while keeping Cancelled. No sync automatically releases a hold.
