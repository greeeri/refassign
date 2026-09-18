export type ImportTeam = {
  id: string;
  name: string;
  sport_id: string | null;
  level_id: string | null;
};

const normalizeTeamName = (value: string) => value.trim().toLowerCase();

/**
 * A game's competition level does not necessarily match each team's roster
 * level (for example, a U17 team can play in a U18 division). Prefer an exact
 * level match when one exists, then accept a unique connected team with the
 * same name and sport.
 */
export function resolveImportTeam<T extends ImportTeam>(
  teams: T[],
  name: string,
  sportId?: string,
  levelId?: string,
): T | undefined {
  const matches = teams.filter(
    (team) =>
      normalizeTeamName(team.name) === normalizeTeamName(name) &&
      team.sport_id === sportId,
  );
  const exactLevel = matches.find((team) => team.level_id === levelId);
  if (exactLevel) return exactLevel;
  return matches.length === 1 ? matches[0] : undefined;
}
