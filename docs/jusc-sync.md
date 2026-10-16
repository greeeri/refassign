# JUSC PlayMetrics sync

JUSC runs every day at **6:30 PM America/Chicago**, including daylight saving changes. The existing five-minute database dispatcher calls the authenticated worker only when a feed is due. Bound calendars keep their separate 8:00 AM schedule.

In the Assignment Center, choose the JUSC league and expand **Calendar sync**. **Run now** triggers an individual JUSC check using the same worker, with last success, next check, failures, change details and run history shown below. Management and league access are checked server-side. Concurrent runs use a database lease.

The worker reads the fixed club367 GCS report using `JUSC_GOOGLE_SERVICE_ACCOUNT_JSON`, stored only on Vercel. Only JUSC home games dated today or later in Central time are processed. Numeric PlayMetrics IDs match existing games across Discovery and Rec imports, preserving existing identities and source groupings. Historical games are neither updated nor marked removed as they age out.

Verified source changes are applied transactionally and marked NEW for assignor review. Manual overrides, holds, crews, response tokens, fees and billing are preserved. New games are held pending review of level, duration and officials required. Source removals retain upcoming games on hold. Retrieval or validation failures retain the last successful snapshot and schedule retries. No notifications are sent automatically.

Validation: `node tests/jusc-calendar-sync.test.cjs`, `npx tsc --noEmit`, `npm run build`.
