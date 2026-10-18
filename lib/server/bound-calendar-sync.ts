import { createServiceClient } from "../supabase/admin";
import { parseBoundCalendar } from "./bound-calendar";

type Service = ReturnType<typeof createServiceClient>;
export async function syncBoundFeed(service: Service, feedId: string, force = false) {
  const { data: feed, error } = await service.rpc("claim_bound_calendar_feed", { p_feed_id: feedId, p_force: force });
  if (error) throw new Error(error.message);
  if (!feed) return { skipped: true };
  try {
    const url = new URL(feed.url);
    if (url.protocol !== "https:" || url.hostname !== "gobound.com" || !/^\/ia\/conferences\/[a-z]+\/calendar\/ical\/[a-z0-9]+$/.test(url.pathname) || url.search || url.hash) throw new Error("Invalid registered feed URL.");
    const headers: Record<string, string> = { Accept: "text/calendar" };
    if (!force && !feed.needs_full_fetch && feed.etag) headers["If-None-Match"] = feed.etag;
    if (!force && !feed.needs_full_fetch && feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45000), headers });
    let events = null, hash = feed.content_hash;
    if (response.status !== 304) {
      if (!response.ok) throw new Error(`Calendar retrieval failed: HTTP ${response.status}.`);
      if (Number(response.headers.get("content-length") || 0) > 5000000) throw new Error("Calendar exceeded the import size limit.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Calendar response had no body.");
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 5000000) { await reader.cancel(); throw new Error("Calendar exceeded the import size limit."); } chunks.push(value); }
      const parsed = parseBoundCalendar(Buffer.concat(chunks).toString("utf8"));
      events = parsed.events; hash = parsed.hash;
    }
    const applied = await service.rpc("apply_bound_calendar_feed", { p_feed_id: feed.id, p_run_id: feed.run_id, p_events: events, p_hash: hash, p_etag: response.headers.get("etag") || feed.etag, p_last_modified: response.headers.get("last-modified") || feed.last_modified });
    if (applied.error) throw new Error(applied.error.message);
    return applied.data;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Calendar sync failed.";
    const failure = await service.rpc("fail_bound_calendar_feed", { p_feed_id: feed.id, p_run_id: feed.run_id, p_error: message });
    if (failure.error) throw new Error(`${message} Run logging also failed: ${failure.error.message}`);
    return { feed: feed.name, failed: true, error: message };
  }
}
