import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { fetchEventIndex, fetchGroupMatches, fetchVenue, fetchVenueIndex, venueForLocation, type GotSportMatch, type GotSportVenue } from "../../../../lib/server/gotsport";

export const maxDuration = 300;
const EVENT_ID = "54033";
const SOURCE = "gotsport";
const CENTRAL_RUN_HOURS = new Set([8, 12, 17, 21]);

function centralHour() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date())) % 24;
}

async function authorized(req: NextRequest, supabase: ReturnType<typeof createServiceClient>) {
  if (Boolean(process.env.CRON_SECRET) && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) return true;
  const token = req.headers.get("x-schedule-token");
  if (!token) return false;
  const { data, error } = await supabase.from("schedule_sync_tokens").update({ used_at: new Date().toISOString() }).eq("token", token).is("used_at", null).gt("expires_at", new Date().toISOString()).select("token").maybeSingle();
  return !error && Boolean(data);
}

function compactName(name: string) {
  return name.replace(/\s+\([A-Z]{2}\)\s*$/, "").trim();
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  if (!await authorized(req, supabase)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!CENTRAL_RUN_HOURS.has(centralHour()) && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ skipped: true, reason: "DST guard: not a requested Central Time run hour" });
  }

  const { data: run, error: runError } = await supabase.from("schedule_sync_runs").insert({ source_system: SOURCE, source_event_id: EVENT_ID }).select("id").single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });
  const counts = { groups_checked: 0, games_found: 0, games_added: 0, games_updated: 0, games_cancelled: 0, games_skipped: 0 };

  try {
    const [{ data: sport }, { data: league }, { data: levels }, { data: cachedVenues }, groupIds, venueIndex] = await Promise.all([
      supabase.from("sports").select("id").eq("name", "Soccer").single(),
      supabase.from("leagues").select("id").eq("name", "N1").single(),
      supabase.from("levels").select("id,name,officials_needed").eq("active", true),
      supabase.from("schedule_sync_venues").select("source_venue_id,venue_name,address,city,state").eq("source_system", SOURCE).eq("source_event_id", EVENT_ID),
      fetchEventIndex(EVENT_ID),
      fetchVenueIndex(EVENT_ID),
    ]);
    if (!sport || !league) throw new Error("RefAssign needs active Soccer and N1 setup records before synchronization.");

    const settled: PromiseSettledResult<GotSportMatch[]>[] = [];
    for (let index = 0; index < groupIds.length; index += 4) {
      settled.push(...await Promise.allSettled(groupIds.slice(index, index + 4).map((id) => fetchGroupMatches(EVENT_ID, id))));
    }
    const failed = settled.filter((result) => result.status === "rejected");
    if (failed.length) throw new Error(`${failed.length} of ${groupIds.length} GotSport schedule levels could not be read; no partial import was applied.`);
    counts.groups_checked = groupIds.length;
    const allMatches = new Map<string, GotSportMatch>();
    for (const result of settled) if (result.status === "fulfilled") for (const match of result.value) allMatches.set(match.id, match);
    counts.games_found = allMatches.size;

    const venueCache = new Map<string, GotSportVenue>();
    for (const venue of cachedVenues || []) venueCache.set(venue.source_venue_id, { id: venue.source_venue_id, name: venue.venue_name, address: venue.address, city: venue.city, state: venue.state });
    const usedVenues = new Map<string, { id: string; name: string }>();
    for (const match of allMatches.values()) {
      if (!match.location) continue;
      const venue = venueForLocation(match.location, venueIndex);
      if (venue) usedVenues.set(venue.id, venue);
    }
    const missingVenues = [...usedVenues.values()].filter((venue) => !venueCache.has(venue.id));
    for (let index = 0; index < missingVenues.length; index += 8) {
      const batch = await Promise.all(missingVenues.slice(index, index + 8).map((venue) => fetchVenue(EVENT_ID, venue.id, venue.name)));
      for (const venue of batch) {
        venueCache.set(venue.id, venue);
        const { error } = await supabase.from("schedule_sync_venues").upsert({ source_system: SOURCE, source_event_id: EVENT_ID, source_venue_id: venue.id, venue_name: venue.name, address: venue.address, city: venue.city, state: venue.state, checked_at: new Date().toISOString() });
        if (error) throw error;
      }
    }

    const levelByName = new Map((levels || []).map((level) => [level.name.toUpperCase(), level]));
    const { data: existingGames, error: gamesError } = await supabase.from("games").select("id,source_match_id,status,starts_at,home_team_id,away_team_id,location_id,level_id").eq("source_system", SOURCE).eq("source_event_id", EVENT_ID);
    if (gamesError) throw gamesError;
    const gameBySource = new Map((existingGames || []).map((game) => [game.source_match_id, game]));
    const seenIowa = new Set<string>();
    const teamCache = new Map<string, string>();
    const locationCache = new Map<string, string>();

    async function teamId(sourceTeamId: string, name: string, levelId: string, levelName: string) {
      const key = sourceTeamId || `${levelId}:${name}`;
      if (teamCache.has(key)) return teamCache.get(key)!;
      let query = supabase.from("teams").select("id").eq("source_system", SOURCE).eq("source_event_id", EVENT_ID);
      query = sourceTeamId ? query.eq("source_team_id", sourceTeamId) : query.eq("name", compactName(name)).eq("level_id", levelId);
      const { data: found, error: findError } = await query.maybeSingle();
      if (findError) throw findError;
      if (found) { teamCache.set(key, found.id); return found.id; }
      const { data: created, error } = await supabase.from("teams").insert({ name: compactName(name), sport_id: sport.id, level_id: levelId, level: levelName, source_system: SOURCE, source_event_id: EVENT_ID, source_team_id: sourceTeamId || null, active: true }).select("id").single();
      if (error) throw error;
      teamCache.set(key, created.id);
      return created.id;
    }

    async function locationId(match: GotSportMatch, venue: GotSportVenue) {
      if (!match.pitchId || !match.location) throw new Error("Match is missing a GotSport field.");
      if (locationCache.has(match.pitchId)) return locationCache.get(match.pitchId)!;
      const { data: found, error: findError } = await supabase.from("locations").select("id").eq("source_system", SOURCE).eq("source_event_id", EVENT_ID).eq("source_pitch_id", match.pitchId).maybeSingle();
      if (findError) throw findError;
      if (found) { locationCache.set(match.pitchId, found.id); return found.id; }
      const { data: created, error } = await supabase.from("locations").insert({ name: match.location, address: venue.address, city: venue.city, state: venue.state, source_system: SOURCE, source_event_id: EVENT_ID, source_pitch_id: match.pitchId, source_venue_id: venue.id, active: true }).select("id").single();
      if (error) throw error;
      locationCache.set(match.pitchId, created.id);
      return created.id;
    }

    for (const match of allMatches.values()) {
      const venueRef = match.location ? venueForLocation(match.location, venueIndex) : null;
      const venue = venueRef ? venueCache.get(venueRef.id) : null;
      if (!venue || venue.state !== "IA") continue;
      seenIowa.add(match.id);
      const level = match.levelName ? levelByName.get(match.levelName.toUpperCase()) : null;
      if (!match.startsAt || !match.pitchId || !match.homeTeam || !match.awayTeam || !level) { counts.games_skipped++; continue; }
      const [home, away, location] = await Promise.all([
        teamId(match.homeTeamId, match.homeTeam, level.id, level.name),
        teamId(match.awayTeamId, match.awayTeam, level.id, level.name),
        locationId(match, venue),
      ]);
      const payload = { game_number: match.number, sport_id: sport.id, league_id: league.id, level_id: level.id, level: level.name, home_team_id: home, away_team_id: away, location_id: location, starts_at: match.startsAt, duration_minutes: match.durationMinutes, officials_needed: level.officials_needed, status: match.cancelled ? "canceled" : "active", notes: `Synced from GotSport event ${EVENT_ID}, ${match.division}`, source_synced_at: new Date().toISOString() };
      const existing = gameBySource.get(match.id);
      if (existing) {
        const { error } = await supabase.from("games").update(payload).eq("id", existing.id);
        if (error) throw error;
        counts.games_updated++;
      } else {
        const { error } = await supabase.from("games").insert({ ...payload, source_system: SOURCE, source_event_id: EVENT_ID, source_match_id: match.id });
        if (error) throw error;
        counts.games_added++;
      }
    }

    const now = new Date().toISOString();
    for (const existing of existingGames || []) {
      if (seenIowa.has(existing.source_match_id) || existing.status === "canceled" || existing.starts_at < now) continue;
      const { error } = await supabase.from("games").update({ status: "canceled", source_synced_at: now, notes: `Removed from GotSport event ${EVENT_ID} schedule` }).eq("id", existing.id);
      if (error) throw error;
      counts.games_cancelled++;
    }

    await supabase.from("schedule_sync_runs").update({ ...counts, status: "success", finished_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ ok: true, event_id: EVENT_ID, ...counts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GotSport schedule sync failed";
    await supabase.from("schedule_sync_runs").update({ ...counts, status: "failed", finished_at: new Date().toISOString(), error_message: message }).eq("id", run.id);
    return NextResponse.json({ error: message, ...counts }, { status: 502 });
  }
}
