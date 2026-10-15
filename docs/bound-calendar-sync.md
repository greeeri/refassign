# Bound calendar synchronization

The Assignment Center's Calendar sync panel shows registered calendars, last successful checks, next checks, recent changes and failures. Assignors can run a check immediately and acknowledge new or changed games individually or in bulk using the existing review controls.

The backend registry stores the organization, league and a validated Bound URL per feed. Only backend service-role requests can read or write sync tables or execute sync mutations. User-facing requests first verify organization management and league access. Cron requests require an expiring single-use schedule token or the existing cron secret; no credentials are included in URLs or client bundles.

`private.trigger_bound_calendar_sync()` dispatches only due feeds through `/api/cron/bound-calendar`. A lightweight database cron tick checks for work every five minutes. Successful feeds are due next at 8:00 AM America/Chicago, including daylight saving transitions. Failed feeds retry after five, fifteen, then sixty minutes. Feed leases and an organization-wide advisory lock prevent concurrent writes and duplicate games across overlapping subscriptions.

The worker accepts only complete, bounded iCalendar responses. HTML, malformed calendars, missing dates, duplicate UIDs, unfamiliar activities and suspicious losses exceeding 25 percent fail without changing games or advancing snapshots. A valid initially empty feed remains valid. Recurring event expansion is intentionally rejected for review.

Source facts and last-applied game values are separate. Three-way comparisons preserve manual date, time, duration, venue, level, crew and team overrides; explicit TBD teams, user holds, cancellation overrides, billing, rankings and archived games remain protected. Verified changes are atomic per feed. Source removals retain the game on hold unless another subscribed feed still contains it. Source disagreements are recorded for review rather than overwriting the owning feed.

Every addition or meaningful change requires assignor review. Missing details, provisional or unknown tiers, malformed durations and resource overlaps are held. Existing database activation guards remain in force. Sync transactions suppress only assignment-response resets and crew-reduction fee redistribution; normal manual edits retain their existing behavior. The sync never sends email or text, changes billing, removes officials, or confirms the assignor's review.

Feed snapshots and history are now authoritative in the database. The old CSV snapshots remain historical migration baselines. Do not run the retired chat-based import tasks concurrently with native synchronization.

Tests: `node --test --experimental-strip-types tests/bound-calendar.test.mjs` and `node tests/bound-calendar-sync.test.cjs`. The latter uses an isolated database with the service role, existing activation guard, assignment-reset and fee-redistribution triggers. No production fixture games or assignments are created.
