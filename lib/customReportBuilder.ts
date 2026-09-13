export type ReportDataset = "games" | "assignments";
export type ReportDimension = "organization" | "league" | "team" | "level" | "location" | "official" | "position" | "gameStatus" | "assignmentStatus" | "paymentStatus" | "month";
export type ReportMetric = "games" | "assignments" | "officials" | "positions" | "openPositions" | "coverageRate" | "declines" | "gameFees" | "miles" | "mileagePay" | "totalCost" | "averageFee" | "averageMiles";
export type ChartType = "bar" | "donut" | "none";
export type CustomReportDefinition = {
  title: string;
  dataset: ReportDataset;
  period: "30" | "90" | "season" | "custom" | "all";
  startDate: string;
  endDate: string;
  organizationIds: string[];
  groupBy: ReportDimension[];
  metrics: ReportMetric[];
  filters: Partial<Record<ReportDimension, string>>;
  chart: ChartType;
};
export type ReportFact = {
  gameId: string; assignmentId: string; date: string; organizationId: string;
  organization: string; league: string; homeTeam: string; awayTeam: string; level: string;
  location: string; officialId: string; official: string; position: string; gameStatus: string;
  assignmentStatus: string; paymentStatus: string; officialsNeeded: number; filledPositions: number;
  gameFee: number; miles: number; mileagePay: number; declined: number;
};
export type ReportResultRow = { key: string; dimensions: string[]; values: Record<ReportMetric, number> };

export const dimensionLabels: Record<ReportDimension, string> = {
  organization: "Organization", league: "League", team: "Team", level: "Level", location: "Location",
  official: "Official", position: "Position", gameStatus: "Game status", assignmentStatus: "Assignment status",
  paymentStatus: "Payment status", month: "Month",
};
export const metricLabels: Record<ReportMetric, string> = {
  games: "Games", assignments: "Assignments", officials: "Officials", positions: "Filled positions",
  openPositions: "Open positions", coverageRate: "Coverage rate", declines: "Declines", gameFees: "Game fees",
  miles: "Miles", mileagePay: "Mileage pay", totalCost: "Total cost", averageFee: "Average fee",
  averageMiles: "Average miles",
};
export const defaultCustomReport: CustomReportDefinition = {
  title: "Custom Operations Report", dataset: "games", period: "season", startDate: "", endDate: "",
  organizationIds: [], groupBy: ["organization"], metrics: ["games", "coverageRate", "openPositions", "totalCost"],
  filters: {}, chart: "bar",
};
const inactive = new Set(["cancelled", "canceled", "rained_out", "on_hold"]);
const activeAssignment = (fact: ReportFact) => Boolean(fact.assignmentId) && !["declined", "cancelled"].includes(fact.assignmentStatus);
const dimensionValue = (fact: ReportFact, dimension: ReportDimension) => {
  if (dimension === "month") return new Date(fact.date).toLocaleDateString("en-US", { year: "numeric", month: "short" });
  return fact[dimension] || "Unspecified";
};
const cutoff = (definition: CustomReportDefinition) => {
  if (definition.period === "all" || definition.period === "custom") return 0;
  if (definition.period === "season") return new Date(new Date().getFullYear(), 0, 1).getTime();
  return Date.now() - Number(definition.period) * 86400000;
};
export function filterFacts(facts: ReportFact[], definition: CustomReportDefinition) {
  const after = cutoff(definition), start = definition.startDate ? new Date(`${definition.startDate}T00:00:00`).getTime() : 0,
    end = definition.endDate ? new Date(`${definition.endDate}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;
  return facts.filter((fact) => {
    const time = new Date(fact.date).getTime();
    if (definition.dataset === "assignments" && !fact.assignmentId) return false;
    if (definition.organizationIds.length && !definition.organizationIds.includes(fact.organizationId)) return false;
    if (definition.period === "custom" ? time < start || time > end : after && time < after) return false;
    return Object.entries(definition.filters).every(([key, value]) => !value || value === "all" || (key === "team" ? [fact.homeTeam, fact.awayTeam].includes(value) : dimensionValue(fact, key as ReportDimension) === value));
  });
}
export function buildCustomReport(facts: ReportFact[], definition: CustomReportDefinition): ReportResultRow[] {
  const grouped = new Map<string, { dimensions: string[]; facts: ReportFact[] }>();
  filterFacts(facts, definition).forEach((fact) => {
    const teams = definition.groupBy.includes("team") ? [...new Set([fact.homeTeam, fact.awayTeam].filter(Boolean))] : [""];
    teams.forEach((team) => {
      const dimensions = definition.groupBy.map((item) => item === "team" ? team || "Unspecified" : dimensionValue(fact, item));
      const key = dimensions.join("\u001f") || "All records", current = grouped.get(key) || { dimensions, facts: [] };
      current.facts.push(fact); grouped.set(key, current);
    });
  });
  return [...grouped.entries()].map(([key, group]) => {
    const gameFacts = [...new Map(group.facts.map((fact) => [fact.gameId, fact])).values()], active = group.facts.filter(activeAssignment),
      fees = active.reduce((sum, fact) => sum + fact.gameFee, 0), miles = active.reduce((sum, fact) => sum + fact.miles, 0),
      mileagePay = active.reduce((sum, fact) => sum + fact.mileagePay, 0), slots = gameFacts.filter((fact) => !inactive.has(fact.gameStatus)).reduce((sum, fact) => sum + fact.officialsNeeded, 0),
      filled = gameFacts.reduce((sum, fact) => sum + fact.filledPositions, 0), assignments = group.facts.filter((fact) => fact.assignmentId).length;
    return { key, dimensions: group.dimensions, values: {
      games: gameFacts.length, assignments, officials: new Set(active.map((fact) => fact.officialId).filter(Boolean)).size,
      positions: filled, openPositions: Math.max(0, slots - filled), coverageRate: slots ? (filled / slots) * 100 : 0,
      declines: group.facts.reduce((sum, fact) => sum + fact.declined, 0), gameFees: fees, miles, mileagePay,
      totalCost: fees + mileagePay, averageFee: active.length ? fees / active.length : 0,
      averageMiles: active.length ? miles / active.length : 0,
    } };
  }).sort((a, b) => (b.values[definition.metrics[0] || "games"] || 0) - (a.values[definition.metrics[0] || "games"] || 0));
}
export function normalizeReportFacts(games: any[], assignments: any[], organizations: Array<{ id: string; name: string }>): ReportFact[] {
  const one = (value: any) => Array.isArray(value) ? value[0] : value, orgNames = new Map(organizations.map((row) => [row.id, row.name])), byGame = new Map<string, any[]>();
  assignments.forEach((row) => byGame.set(row.game_id, [...(byGame.get(row.game_id) || []), row]));
  const facts: ReportFact[] = [];
  games.forEach((raw) => {
    const game = raw, rows = byGame.get(game.id) || [], active = rows.filter((row) => row.official_id && !["declined", "cancelled"].includes(row.status)), declined = rows.filter((row) => row.status === "declined").length;
    const base = { gameId: game.id, date: game.starts_at, organizationId: game.organization_id || "", organization: orgNames.get(game.organization_id) || "Unassigned organization", league: one(game.leagues)?.name || "Unspecified", homeTeam: one(game.home)?.name || "TBD", awayTeam: one(game.away)?.name || "TBD", level: one(game.levels)?.name || "Unspecified", location: one(game.location)?.name || "Unspecified", gameStatus: game.status || "active", officialsNeeded: Number(game.officials_needed) || 0, filledPositions: active.length };
    if (!rows.length) facts.push({ ...base, assignmentId: "", officialId: "", official: "", position: "", assignmentStatus: "", paymentStatus: "", gameFee: 0, miles: 0, mileagePay: 0, declined });
    rows.forEach((row, index) => { const official = one(row.officials), position = one(row.sport_positions), miles = Number(row.mileage_miles) || 0, rate = Number(row.mileage_rate) || 0; facts.push({ ...base, assignmentId: row.id, officialId: row.official_id || "", official: official ? `${official.first_name || ""} ${official.last_name || ""}`.trim() : "Unassigned", position: position?.name || "Unspecified", assignmentStatus: row.status || "unassigned", paymentStatus: row.payment_status || "unpaid", gameFee: Number(row.game_fee) || 0, miles, mileagePay: miles * rate, declined: index === 0 ? declined : 0 }); });
  });
  return facts;
}
