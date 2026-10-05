export type LeagueLevelSetting = { league_id: string; level_ids: string[] };

export function levelsForLeague<T extends { id: string }>(
  levels: T[], settings: LeagueLevelSetting[], leagueId: string,
): T[] {
  const setting = settings.find((item) => item.league_id === leagueId);
  return setting ? levels.filter((level) => setting.level_ids.includes(level.id)) : levels;
}
