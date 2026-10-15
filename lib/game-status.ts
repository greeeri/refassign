export function normalizeGameStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "open") return "active";
  if (normalized === "cancelled") return "canceled";
  if (normalized === "hold" || normalized === "on_hold") return "suspended";
  if (normalized === "rain_out") return "rained_out";
  return normalized;
}

export function gameAcceptsAssignments(game: { status: string }) {
  return normalizeGameStatus(game.status) === "active";
}

export function inactiveGameStatusLabel(status: string) {
  const normalized = normalizeGameStatus(status);
  if (normalized === "suspended") return "On Hold";
  if (normalized === "rained_out") return "Rain Out";
  if (normalized === "canceled") return "Cancelled";
  return "Inactive";
}

export function gameHoldReason(game: {
  status: string;
  venue_conflict_hold?: boolean;
  time_tbd?: boolean;
  field_tbd?: boolean;
  notes?: string | null;
}) {
  if (normalizeGameStatus(game.status) !== "suspended") return null;
  const reasons: string[] = [];
  if (game.venue_conflict_hold) reasons.push("Venue or team overlap must be reviewed and resolved before activation.");
  if (game.time_tbd) reasons.push("Start time needs confirmation.");
  if (game.field_tbd) reasons.push("Venue or field needs confirmation.");
  const notes = (game.notes || "").split(/\s*\|\s*|\n/)
    .map(part => part.split(" Source facts:")[0].trim())
    .filter(part => /^(?:on hold|hold reason|venue conflict|resource conflict|removed from source)/i.test(part)
      || /Source review:|Resource conflict with Game #/i.test(part));
  // The latest recorded explanation is most relevant; source snapshots stay in Notes.
  if (notes.length) reasons.push(notes[notes.length - 1].replace(/^(?:on hold|hold reason)\s*:\s*/i, ""));
  return reasons.length ? reasons.join(" ") : "No hold reason has been recorded. Review the game details before activating.";
}
