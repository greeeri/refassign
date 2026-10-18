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

export type BoundCalendarReview = {
  status: string;
  venue_conflict_hold?: boolean;
  bound_source_status?: string | null;
  bound_hold_reasons?: string[] | null;
  bound_hold_resolution_candidate?: boolean;
  calendar_needs_review?: boolean;
};

export function boundCalendarReview(game: BoundCalendarReview) {
  if (!game.bound_source_status) return null;
  const source = game.bound_source_status.trim().toUpperCase();
  const sourceLabel = source === "CANCELLED" || source === "CANCELED" ? "Cancelled"
    : source === "CONFIRMED" ? "Confirmed" : source === "TENTATIVE" ? "Tentative" : "Unknown";
  const status = normalizeGameStatus(game.status);
  const operationalLabel = status === "active" ? "Active" : inactiveGameStatusLabel(status);
  const reasons = game.bound_hold_reasons || [];
  let recommendation: string;
  if (sourceLabel === "Cancelled") {
    recommendation = "Review the calendar cancellation; do not assign.";
  } else if (game.bound_hold_resolution_candidate && status === "suspended") {
    recommendation = "Previous blockers are no longer detected. Verify the correction before manually releasing the hold.";
  } else if (status === "suspended" || game.venue_conflict_hold) {
    const checks: string[] = [];
    if (reasons.includes("source_overlap") || reasons.includes("database_overlap") || game.venue_conflict_hold)
      checks.push("verify overlapping teams and the actual field (a shared venue may have multiple fields)");
    if (reasons.includes("invalid_duration")) checks.push("confirm the end time and duration");
    if (reasons.includes("missing_time")) checks.push("confirm the start time");
    if (reasons.includes("missing_venue")) checks.push("confirm the venue or field");
    if (reasons.some(reason => ["missing_level", "ambiguous_level"].includes(reason))) checks.push("confirm the team level");
    if (reasons.includes("missing_teams")) checks.push("confirm both teams");
    if (reasons.includes("source_removed")) checks.push("confirm why the game was removed from the calendar");
    if (reasons.includes("source_tentative")) checks.push("confirm the tentative calendar event");
    if (reasons.includes("source_status_unknown")) checks.push("confirm the source calendar status");
    if (reasons.includes("source_details_unverified")) checks.push("refresh and verify the full source calendar details");
    recommendation = checks.length ? `Assignor review: ${checks.join("; ")}. Keep on hold until resolved.` : "Assignor review: confirm the saved hold reason before releasing the hold.";
  } else if (status !== "active") {
    recommendation = "Review the difference from the source calendar before changing the RefAssign status.";
  } else {
    recommendation = game.calendar_needs_review ? "Review the calendar details before assigning." : "Calendar review acknowledged; assign using the usual eligibility checks.";
  }
  return { sourceLabel, operationalLabel, recommendation };
}
