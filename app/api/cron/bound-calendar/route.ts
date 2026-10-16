import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { syncJuscFeed } from "../../../../lib/server/jusc-calendar-sync";
import { syncBoundFeed } from "../../../../lib/server/bound-calendar-sync";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const service = createServiceClient();
  let authorized = Boolean(process.env.CRON_SECRET) && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) {
    const token = request.headers.get("x-schedule-token");
    if (token && /^[0-9a-f-]{36}$/i.test(token)) {
      const used = await service.from("schedule_sync_tokens").update({ used_at: new Date().toISOString() }).eq("token", token).is("used_at", null).gt("expires_at", new Date().toISOString()).select("token").maybeSingle();
      authorized = !used.error && Boolean(used.data);
    }
  }
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: feeds, error } = await service.from("calendar_sync_feeds").select("id,source_system").eq("enabled", true).eq("bootstrapped", true).lte("next_run_at", new Date().toISOString()).order("next_run_at").limit(6);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  // Each feed commits independently; one failed retrieval never blocks other feeds.
  for (let i = 0; i < feeds.length; i += 2) {
    const batch = await Promise.allSettled(feeds.slice(i, i + 2).map(f => f.source_system === "playmetrics" ? syncJuscFeed(service, f.id) : syncBoundFeed(service, f.id)));
    results.push(...batch.map(r => r.status === "fulfilled" ? r.value : { failed: true, error: r.reason instanceof Error ? r.reason.message : "Sync failed" }));
  }
  return NextResponse.json({ results, failed: results.some(x => x.failed) });
}
