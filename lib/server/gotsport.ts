import { load } from "cheerio";

const ORIGIN = "https://system.gotsport.com";
const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export type GotSportVenue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
};

export type GotSportMatch = {
  id: string;
  number: string;
  groupId: string;
  startsAt: string | null;
  sourceStatus: string;
  cancelled: boolean;
  homeTeamId: string;
  homeTeam: string;
  awayTeamId: string;
  awayTeam: string;
  pitchId: string | null;
  location: string | null;
  division: string;
  levelName: string | null;
  durationMinutes: number;
};

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function getHtml(path: string) {
  const response = await fetch(`${ORIGIN}${path}`, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "RefAssign schedule synchronization (contact: assignments@ref-assign.com)",
    },
    signal: AbortSignal.timeout(25_000),
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`GotSport returned ${response.status} for ${path}`);
  if (response.url.includes("verify_captchas") || /Please verify to continue/i.test(html)) {
    throw new Error("GotSport requested human verification; the sync stopped without changing schedules.");
  }
  return html;
}

function queryId(href: string | undefined, key: string) {
  if (!href) return "";
  return new URL(href, ORIGIN).searchParams.get(key) || "";
}

function parseCentralTime(text: string) {
  const match = clean(text).match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4}).*?\b(\d{1,2}):(\d{2})(AM|PM)\s+(CST|CDT)\b/i);
  if (!match) return null;
  const [, monthText, dayText, yearText, hourText, minuteText, meridiem, zone] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  const offset = zone.toUpperCase() === "CDT" ? "-05:00" : "-06:00";
  return `${yearText}-${String(MONTHS[monthText.slice(0, 1).toUpperCase() + monthText.slice(1, 3).toLowerCase()]).padStart(2, "0")}-${dayText.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minuteText}:00${offset}`;
}

function levelFromDivision(division: string) {
  const age = division.match(/U(13|14|15|16|17|19)\b/i)?.[1];
  if (!age) return null;
  const gender = /girl|female/i.test(division) ? "G" : /boy|male/i.test(division) ? "B" : "";
  return `U${age}${gender}`;
}

function durationFor(levelName: string | null) {
  const age = Number(levelName?.match(/\d+/)?.[0] || 19);
  if (age <= 14) return 70;
  if (age <= 16) return 80;
  return 90;
}

export async function fetchEventIndex(eventId: string) {
  const html = await getHtml(`/org_event/events/${eventId}`);
  const $ = load(html);
  const groupIds = new Set<string>();
  $('a[href*="/schedules?"]').each((_, element) => {
    const id = queryId($(element).attr("href"), "group");
    if (id) groupIds.add(id);
  });
  if (!groupIds.size) throw new Error("GotSport did not return any schedule levels for this event.");
  return [...groupIds];
}

export async function fetchVenueIndex(eventId: string) {
  const html = await getHtml(`/org_event/events/${eventId}/fields`);
  const $ = load(html);
  const venues = new Map<string, string>();
  $('a[href*="/fields?venue="]').each((_, element) => {
    const id = queryId($(element).attr("href"), "venue");
    const name = clean($(element).text());
    if (id && name && !/^\d+$/.test(name)) venues.set(id, name);
  });
  return [...venues].map(([id, name]) => ({ id, name }));
}

export async function fetchVenue(eventId: string, venueId: string, venueName: string): Promise<GotSportVenue> {
  const html = await getHtml(`/org_event/events/${eventId}/fields?venue=${venueId}`);
  const $ = load(html);
  const lines = $("main").text().split(/\r?\n/).map(clean).filter(Boolean);
  const index = lines.findIndex((line) => line === venueName);
  const address = index >= 0 ? lines[index + 1] || null : null;
  const cityLine = index >= 0 ? lines[index + 2] || "" : "";
  const cityMatch = cityLine.match(/^(.*?),\s*([A-Z]{2})(?:,\s*(?:US|USA))?$/i);
  return {
    id: venueId,
    name: venueName,
    address,
    city: cityMatch ? clean(cityMatch[1]) : null,
    state: cityMatch ? cityMatch[2].toUpperCase() : null,
  };
}

export async function fetchGroupMatches(eventId: string, groupId: string) {
  const html = await getHtml(`/org_event/events/${eventId}/schedules?date=All&group=${groupId}`);
  const $ = load(html);
  const matches: GotSportMatch[] = [];
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    const matchLink = $(row).find('a[href*="match="]').first();
    const id = queryId(matchLink.attr("href"), "match");
    if (!id || cells.length < 7) return;
    const homeLink = cells.eq(2).find('a[href*="team="]').first();
    const awayLink = cells.eq(4).find('a[href*="team="]').first();
    const pitchLink = cells.eq(5).find('a[href*="pitch="]').first();
    const timeText = clean(cells.eq(1).text());
    const division = clean(cells.eq(6).text());
    const levelName = levelFromDivision(division);
    matches.push({
      id,
      number: clean(cells.eq(0).text()) || id,
      groupId,
      startsAt: parseCentralTime(timeText),
      sourceStatus: timeText,
      cancelled: /cancel/i.test(timeText),
      homeTeamId: queryId(homeLink.attr("href"), "team"),
      homeTeam: clean(homeLink.text()),
      awayTeamId: queryId(awayLink.attr("href"), "team"),
      awayTeam: clean(awayLink.text()),
      pitchId: queryId(pitchLink.attr("href"), "pitch") || null,
      location: clean(pitchLink.text()) || null,
      division,
      levelName,
      durationMinutes: durationFor(levelName),
    });
  });
  return matches;
}

export function venueForLocation(location: string, venues: Array<{ id: string; name: string }>) {
  const normalized = clean(location).toLowerCase();
  return venues
    .filter((venue) => normalized === venue.name.toLowerCase() || normalized.startsWith(`${venue.name.toLowerCase()} -`) || normalized.startsWith(`${venue.name.toLowerCase()}:`))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

