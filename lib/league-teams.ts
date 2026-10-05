export type LeagueTeamSetting = { league_id: string; team_ids: string[] };
export function teamsForLeague<T extends { id: string }>(teams: T[], settings: LeagueTeamSetting[], leagueId: string): T[] {
  const setting = settings.find((item) => item.league_id === leagueId);
  return setting ? teams.filter((team) => setting.team_ids.includes(team.id)) : teams;
}
export function selectionFromRows(
  rows: string[][], league: { id: string; name: string },
  teams: { id: string; name: string }[], current: string[],
): { ids: string[]; changes: number } {
  if (rows.length < 2) throw new Error("The file contains no team selections.");
  const headers = rows[0].map((value) => String(value).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "_"));
  if (!headers.includes("selected") || (!headers.includes("team_id") && !headers.includes("team"))) throw new Error("Include team_id (or team) and selected columns.");
  if (!headers.includes("league_id") && !headers.includes("league")) throw new Error("Include league_id or league so the selection is applied to the correct league.");
  const next = new Set(current);
  const seen = new Set<string>();
  let changes = 0;
  rows.slice(1).forEach((row, index) => {
    if (!row.some((value) => String(value).trim())) return;
    const get = (name: string) => String(row[headers.indexOf(name)] ?? "").trim();
    const fail = (message: string): never => { throw new Error(`Row ${index + 2}: ${message}`); };
    const leagueId = get("league_id"), leagueName = get("league");
    if (leagueId ? leagueId !== league.id : leagueName.toLowerCase() !== league.name.toLowerCase()) fail("League does not match the selected league.");
    const id = get("team_id"), name = get("team");
    const matches = teams.filter((team) => id ? team.id === id : team.name.toLowerCase() === name.toLowerCase());
    if (matches.length !== 1) fail(matches.length ? "Team name is ambiguous; use team_id." : "Team is not connected to this organization.");
    const team = matches[0];
    if (seen.has(team.id)) fail("Duplicate team selection.");
    seen.add(team.id);
    const value = get("selected").toLowerCase();
    if (!["true", "false", "yes", "no", "1", "0"].includes(value)) fail("Selected must be true/false, yes/no, or 1/0.");
    const selected = ["true", "yes", "1"].includes(value);
    if (next.has(team.id) !== selected) changes++;
    if (selected) next.add(team.id); else next.delete(team.id);
  });
  if (!seen.size) throw new Error("The file contains no team selections.");
  return { ids: [...next], changes };
}
