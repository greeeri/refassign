type EventLocation = { state?: string | null } | null | undefined;

const PACIFIC = new Set(["CA", "NV", "OR", "WA"]);
const MOUNTAIN = new Set(["AZ", "CO", "ID", "MT", "NM", "UT", "WY"]);
const EASTERN = new Set(["CT", "DC", "DE", "FL", "GA", "IN", "KY", "MA", "MD", "ME", "MI", "NC", "NH", "NJ", "NY", "OH", "PA", "RI", "SC", "VA", "VT", "WV"]);
const ALASKA = new Set(["AK"]);

export function eventTimeZone(location: EventLocation) {
  const state = (location?.state || "").trim().toUpperCase();
  if (PACIFIC.has(state)) return "America/Los_Angeles";
  if (MOUNTAIN.has(state)) return state === "AZ" ? "America/Phoenix" : "America/Denver";
  if (EASTERN.has(state)) return "America/New_York";
  if (ALASKA.has(state)) return "America/Anchorage";
  if (state === "HI") return "Pacific/Honolulu";
  return "America/Chicago";
}

function partsAt(instant: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function eventTimeParts(value: string | Date, location: EventLocation) {
  const instant = value instanceof Date ? value : new Date(value);
  return partsAt(instant, eventTimeZone(location));
}

export function eventLocalToIso(date: string, time: string, location: EventLocation) {
  const timeZone = eventTimeZone(location);
  const targetUtc = Date.parse(`${date}T${time}:00Z`);
  let instant = new Date(targetUtc);
  for (let attempt = 0; attempt < 3; attempt++) {
    const wall = partsAt(instant, timeZone);
    const representedUtc = Date.parse(`${wall.date}T${wall.time}:00Z`);
    instant = new Date(instant.getTime() + targetUtc - representedUtc);
  }
  return instant.toISOString();
}

export function formatEventDate(value: string | Date, location: EventLocation) {
  return new Intl.DateTimeFormat("en-US", { timeZone: eventTimeZone(location), month: "numeric", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function formatEventTime(value: string | Date, location: EventLocation) {
  return new Intl.DateTimeFormat("en-US", { timeZone: eventTimeZone(location), hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatEventDateTime(value: string | Date, location: EventLocation) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: eventTimeZone(location),
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
