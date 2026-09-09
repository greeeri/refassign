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
