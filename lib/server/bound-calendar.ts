import ICAL from "ical.js";
import { createHash } from "node:crypto";

export type BoundFacts = { date: string; time: string | null; end: string | null; location: string; matchup: string; level: string; status: string };
export type BoundEvent = { uid: string; facts: BoundFacts; starts_at: string; duration: number; time_tbd: boolean; field_tbd: boolean; sex: string; source_level: string; home_school: string | null; away_school: string | null; issues: string[] };
const levels: Record<string, string> = { varsity: "Varsity", "junior varsity": "JV", jv: "JV", jv1: "JV", "jv 1": "JV", "level 2": "JV", "junior varsity 2": "JV2", jv2: "JV2", "jv 2": "JV2", "level 3": "JV2", "jvr-a": "JV2" };
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function normalizeBoundVenue(s: string) {
  return clean(s).replace(/^Goeppinger Field Soccer Field$/i, "Goeppinger Field").replace(/^H\.?\s*A\.?\s*Lynn Stadium(?:\s+Stadium)?$/i, "H. A. Lynn Stadium");
}
function localParts(date: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export function parseBoundCalendar(text: string): { name: string; events: BoundEvent[]; hash: string } {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw.startsWith("BEGIN:VCALENDAR") || !raw.endsWith("END:VCALENDAR") || /<!doctype|<html/i.test(raw)) throw new Error("The source did not return a complete iCalendar file.");
  const stack: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("BEGIN:")) stack.push(line.slice(6).trim());
    if (line.startsWith("END:") && stack.pop() !== line.slice(4).trim()) throw new Error("Unbalanced calendar components.");
  }
  if (stack.length) throw new Error("Truncated calendar.");
  const root = new ICAL.Component(ICAL.parse(raw));
  if (root.name !== "vcalendar" || clean(root.getFirstPropertyValue("version")) !== "2.0") throw new Error("Unsupported calendar format.");
  const zones = root.getAllSubcomponents("vtimezone");
  for (const z of zones) ICAL.TimezoneService.register(new ICAL.Timezone(z));
  const zoneName = clean(root.getFirstPropertyValue("x-wr-timezone")) || "America/Chicago";
  if (zoneName !== "America/Chicago") throw new Error(`Unexpected calendar timezone: ${zoneName}`);
  const chicago = ICAL.TimezoneService.get("America/Chicago");
  const seen = new Set<string>();
  const events: BoundEvent[] = root.getAllSubcomponents("vevent").map(c => {
    const val = (name: string) => clean(c.getFirstPropertyValue(name));
    const uid = val("uid").toLowerCase();
    if (!/^h[a-z0-9]+$/.test(uid) || seen.has(uid)) throw new Error("A source UID is missing, invalid or duplicated.");
    seen.add(uid);
    if (c.hasProperty("rrule") || c.hasProperty("recurrence-id")) throw new Error("Recurring source events require review before import.");
    if (val("x-bnd-activitykey") !== "soccer") throw new Error(`Non-soccer activity requires review: ${uid}`);
    const start = c.getFirstPropertyValue("dtstart") as ICAL.Time;
    const finish = c.getFirstPropertyValue("dtend") as ICAL.Time | null;
    if (!start) throw new Error(`Missing source date: ${uid}`);
    const timeTbd = start.isDate;
    if (start.zone === ICAL.Timezone.localTimezone && !timeTbd) {
      if (!chicago) throw new Error("The source omitted timezone definitions.");
      start.zone = chicago;
    }
    if (finish && finish.zone === ICAL.Timezone.localTimezone && !finish.isDate) finish.zone = start.zone;
    const parts = timeTbd ? { date: start.toString(), time: null } : localParts(start.toJSDate());
    const end = finish && !timeTbd ? localParts(finish.toJSDate()) : null;
    const endText = end ? `${end.date}T${end.time}` : null;
    const duration = finish && !timeTbd ? (finish.toJSDate().getTime() - start.toJSDate().getTime()) / 60000 : 110;
    const summary = val("summary").replace(/^CANCELLED\s*(?:[-:]\s*)?/i, "");
    const match = /^.+?:\s*(.*?)\s*\(([^()]*)\)\s*$/.exec(summary);
    if (!match) throw new Error(`Unrecognized source summary: ${uid}`);
    const matchup = clean(match[1]), tier = clean(match[2]);
    const activity = val("x-bnd-activityname");
    const sex = val("x-bnd-activitysex").toLowerCase() === "male" ? "Boys" : val("x-bnd-activitysex").toLowerCase() === "female" ? "Girls" : /boys/i.test(activity) ? "Boys" : /girls/i.test(activity) ? "Girls" : "";
    const level = levels[tier.toLowerCase()] && sex ? `${levels[tier.toLowerCase()]} ${sex}` : "";
    const location = normalizeBoundVenue(val("location"));
    const pair = matchup.split(/\s+vs\.?\s+/i);
    const homeCandidates = pair.length === 2 && !/,|invite|tournament|complex/i.test(location) ? pair.filter(t => key(t).length >= 3 && key(location).includes(key(t))) : [];
    const home = homeCandidates.length === 1 ? homeCandidates[0] : null;
    const away = home ? pair.find(t => t !== home) || null : null;
    const issues: string[] = [];
    if (timeTbd) issues.push("Start time missing; display TBD.");
    if (!location) issues.push("Venue missing; display TBD.");
    if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) issues.push("Source end time/duration is invalid; confirm the actual end time.");
    if (!level) issues.push(`Unfamiliar level or gender: ${tier} / ${activity}.`);
    if (tier.toLowerCase() === "jvr-a") issues.push("JVR-A provisionally mapped to JV2; assignor confirmation required.");
    if (!home || !away) issues.push("Home school is unclear; preserve or use TBD teams and blank Bill To.");
    const status = val("status") || (/^CANCELLED/i.test(val("summary")) ? "CANCELLED" : "CONFIRMED");
    if (!["CONFIRMED", "CANCELLED", "TENTATIVE"].includes(status)) throw new Error(`Unfamiliar source status: ${status}`);
    // Midnight is storage only for date-only events; do not fabricate an actual start time.
    let startsAt: string;
    if (timeTbd) {
      if (!chicago) throw new Error("The source omitted timezone definitions.");
      const midnight = ICAL.Time.fromDateTimeString(`${parts.date}T00:00:00`); midnight.zone = chicago; startsAt = midnight.toJSDate().toISOString();
    } else startsAt = start.toJSDate().toISOString();
    return { uid, facts: { date: parts.date, time: parts.time, end: endText, location, matchup, level, status }, starts_at: startsAt, duration, time_tbd: timeTbd, field_tbd: !location, sex, source_level: tier, home_school: home, away_school: away, issues };
  });
  return { name: clean(root.getFirstPropertyValue("x-wr-calname")), events, hash: createHash("sha256").update(JSON.stringify(events.map(e => [e.uid, e.facts]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex") };
}
