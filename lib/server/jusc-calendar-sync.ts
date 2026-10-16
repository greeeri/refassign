import { createHash } from "node:crypto";
import { createServiceClient } from "../supabase/admin";
import { downloadJuscGames, upcomingJuscHomeGames, type PlayMetricsGame } from "./playmetrics";

type Service = ReturnType<typeof createServiceClient>;
export function juscStart(game: PlayMetricsGame) {
  const match = game.time.match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/i);
  if (!match) throw new Error("Invalid JUSC start time.");
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const time = `${String(hour).padStart(2, "0")}:${match[2]}:00`;
  const wall = Date.parse(`${game.date}T${time}Z`);
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc)).map(x => [x.type, x.value]));
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    if (represented === wall) return { time, starts_at: new Date(utc).toISOString() };
    utc += wall - represented;
  }
  throw new Error("JUSC start time does not exist in America/Chicago.");
}
export async function syncJuscFeed(service: Service, feedId: string, force = false) {
  const claim = await service.rpc("claim_bound_calendar_feed", { p_feed_id: feedId, p_force: force });
  if (claim.error) throw new Error(claim.error.message);
  const feed = claim.data;
  if (!feed) return { skipped: true };
  try {
    if (feed.source_system !== "playmetrics" || feed.source_event_id !== "club367-jusc") throw new Error("Invalid JUSC feed registration.");
    const games = upcomingJuscHomeGames(await downloadJuscGames());
    if (!games.length) throw new Error("JUSC returned no upcoming home games; saved schedule retained for review.");
    const existing = await service.from("games").select("source_match_id,duration_minutes,officials_needed,level:levels(name)").eq("organization_id", feed.organization_id).eq("league_id", feed.league_id).eq("source_system", "playmetrics").limit(10000);
    if (existing.error) throw new Error(existing.error.message);
    const byId = new Map<string, any>((existing.data || []).map((g: any) => [g.source_match_id, g]));
    const events = games.map(game => {
      const old = byId.get(game.id);
      const level = (Array.isArray(old?.level) ? old.level[0] : old?.level)?.name || "";
      const start = juscStart(game);
      return { uid: game.id, facts: { date: game.date, time: start.time, end: null, location: game.field, matchup: `${game.home} vs ${game.away}`, level, status: game.cancelled ? "CANCELLED" : "CONFIRMED" }, starts_at: start.starts_at, duration: old?.duration_minutes || 60, crew: old?.officials_needed || 3, time_tbd: false, field_tbd: false, home_school: game.home, away_school: game.away, sex: "", issues: old ? [] : ["New game: verify level, duration and officials required. Held pending assignor review."] };
    });
    const applied = await service.rpc("apply_jusc_calendar_feed", { p_feed_id: feed.id, p_run_id: feed.run_id, p_events: events, p_hash: createHash("sha256").update(JSON.stringify(events)).digest("hex") });
    if (applied.error) throw new Error(applied.error.message);
    return applied.data;
  } catch (e) {
    const error = e instanceof Error ? e.message : "JUSC sync failed.";
    const logged = await service.rpc("fail_bound_calendar_feed", { p_feed_id: feed.id, p_run_id: feed.run_id, p_error: error });
    if (logged.error) throw new Error(`${error} Run logging failed: ${logged.error.message}`);
    return { feed: feed.name, failed: true, error };
  }
}
