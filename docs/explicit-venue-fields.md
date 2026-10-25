# Explicit venues and fields

## Model and user path

Open **Locations → Fields → Assign fields to venues**. Select a **Parent venue** and click **Save venue**. **Unassigned venue** filters the review queue. An explicit blank selection unassigns a parent only when Save is clicked. **Locations → Venues** lists the venue catalog; existing super administrators may create/edit venue records. Creating or renaming a venue does not move any fields.

The model stays `venues.id ← locations.venue_id`, `locations.id ← games.location_id`, and `games.id ← assignments.game_id`. There is no replacement fields table, name-derived parentage, merge, field-ID rewrite, game remap, or assignment rewrite. Existing nullable parents remain valid.

Assignment filters use `venue:<UUID>` and expand only through the selected league's authorized field directory. Renaming a venue preserves filter identity; unavailable saved parents remain visibly unavailable and match no fields rather than silently clearing to all games. Raw field-ID filters and legacy organization-local complex selections continue working.

## Authorization and compatibility

- New RPCs are SECURITY INVOKER, using unchanged table RLS and existing shared-resource authorization. No auth policies or existing complex-based sibling visibility are modified.
- Parent options include only venues the caller already may read. A venue outside that scope is not available merely because another field has a similar name. Super-administrator catalog restrictions remain in force.
- Parent saves lock the field and require its expected previous parent, so a stale view is rejected. The UI confirms the returned UUID and suppresses stale scope responses.
- The existing assignment directory RPC is retained. Its new v2 counterpart preserves the same scoped predicate and adds parent UUID/name without widening the field set. Clients fall back to the old RPC only when the new function is actually missing, not on permission/network errors.
- Existing `field_complex` settings, transfer/address fallbacks, and their security semantics are deliberately retained. They are separate from the explicit parent relationship. Replacing those legacy rules requires its own reviewed compatibility change.
- The Locations uploader exports field `id`, `venue_id`, informational `venue_name`, and `venue_action=preserve`. **Download Venue IDs** also exports the authorized venue catalog, including newly created venues not yet linked to fields. To change an association, supply the existing field ID, an available venue ID, and `venue_action=set`; explicit `clear` plus a blank venue ID unassigns. Blank parent columns alone preserve the mapping. Unknown IDs and ambiguous names are rejected; new fields must first be added and exported before association. Older metadata-only files remain supported. Imports are sequential, not atomic: failure stops later rows, reports confirmed writes, and requires refresh/review rather than automatic retry. Parent saves use the same permission-checked, expected-old-parent RPC. Existing schedule sync source/name matching remains unchanged and does not establish these explicit parent links.

## Prepared database change (not applied by implementation)

`supabase/explicit_venue_parents.sql` and its matching migration add:

1. `get_location_venue_options()` — RLS-visible parents.
2. `set_location_venue(location, new_parent, expected_parent)` — explicit, guarded association only.
3. `get_assignment_venue_directory_v2(organization, league)` — scoped directory plus parent metadata.
4. Partial indexes on `locations(venue_id,id)` and nonarchived `games(organization_id,league_id,location_id)`.

There are no mapping UPDATE/DELETE statements in the migration. Apply only after authorized database review. Use the migration as the production artifact; do not apply both copies separately. Existing clients continue to use the old RPC. The new association UI requires this migration before saving; an unapplied migration produces an error rather than fabricating success.

## Mapping review — no automatic backfill

### Workspace-scoped import/export

The Locations field export and import preview use the **current organization's loaded field IDs**, intersected with its freshly authorized active directory. They do not use the user's entire shared/global catalog. IDs outside this workspace are rejected even when the user can access them in another workspace. Missing workspace/permission context fails closed; an empty workspace never falls back to all locations. Scope, permission and sign-in changes invalidate old previews and downloads. Before the first import write the whole batch is checked, and current organization authority and target membership are checked again before each write. This adds application-context safeguards without changing existing RLS or database permissions.

**Download Venue IDs** remains a separately labeled catalog of all parent venues readable under existing permissions. It supplies IDs for explicit association but does not expand the workspace's field list.

Workspace imports update existing fields only. New or unconnected fields must first be added or connected through the existing Locations workflow, followed by refresh/export. They are not silently inserted into the global catalog by the uploader. A row combining deactivation with a parent change is rejected during preview; make the association change while the field is active, then deactivate it separately. Older metadata-only files still work for unambiguous existing workspace fields; explicit parent changes still require the exported field ID.

This corrects a legacy scope discrepancy: the old standalone uploader queried all RLS-visible locations while the surrounding Locations screen showed only organization-connected fields. No records are moved, linked or removed by this correction.

Production catalog exports belong outside source control. The separately prepared review packet contains a read-only snapshot, a venue catalog, and a field mapping worksheet. Existing links are marked preserve, unlinked fields are marked for review, and approved venue IDs start blank. Similar names, shared complex text, and shared addresses are evidence for a human review, not proof of parentage.

1. Confirm the field and physical parent with an authoritative source.
2. Put the chosen **existing venue UUID**, not its name, into `approved_venue_id`; add a reviewer note. Blank means **no change**, never unassign.
3. If the real parent does not exist, have an authorized super administrator create it in Venues; refresh the review snapshot before referencing its ID.
4. Validate offline: `python scripts/validate-venue-mapping-review.py snapshot.json field-venue-mapping-review.csv`.
5. The validator only outputs proposals; it has no database connection and performs zero writes. Apply a reviewed association explicitly through Locations, with current authorization and the expected-old-parent check. A refreshed live review is required if the record has changed since export.

No worksheet automatically authorizes deletion, merging, or changing historical game locations. The validator intentionally has no bulk apply or unassignment mode.

## Verification

- `node --test tests/explicit-venue-parents-rpc.test.cjs`: executable local Postgres/PGlite authorization, stale writes, scope, IDs and legacy semantics checks.
- `node --test tests/location-venue-structure-ui.test.cjs tests/location-import-export.test.cjs tests/location-import-export-ui.test.cjs`: React/jsdom association, CSV roundtrip, explicit import intent, unknown/ambiguous IDs, restricted users, partial failures and navigation/auth races.
- `node --test tests/assignment-venue-directory.test.cjs tests/assignment-venue-filter.test.cjs`: stable parent filters and bounded league expansion.
- `python tests/venue-mapping-review.test.py`: explicit-review-only validator behavior.
- `npm run test:data-access`, `npx tsc --noEmit`, `npm run build` for aggregate checks.

Local verification cannot establish production index plans or live authenticated browser behavior before an authorized apply/deployment. Release verification must repeat representative league directory reads, restricted-user checks, parent save/rename flows, and confirm unchanged game/assignment IDs.
