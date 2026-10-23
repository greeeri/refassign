export type MatchingGameTotals = {
  total: number; ranges: Record<string, number>; unpublished: number; selfAssign: number;
  replacement: number; allStatuses: number; completeness: Record<string, number>;
  queue: Record<string, number>;
};
export function normalizeMatchingTotals(value: unknown): MatchingGameTotals | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!count(row.total)) return null;
  for (const key of ['ranges', 'completeness', 'queue']) {
    if (!row[key] || typeof row[key] !== 'object' || Array.isArray(row[key])) return null;
    if (!Object.values(row[key] as object).every(count)) return null;
  }
  for (const key of ['unpublished', 'selfAssign', 'replacement', 'allStatuses']) if (!count(row[key])) return null;
  return row as unknown as MatchingGameTotals;
}
export function pageNumbers(page: number, total: number): number[] {
  const start = Math.max(1, Math.min(page - 2, total - 4));
  return Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
}
export function emptyMatchingTotals(): MatchingGameTotals {
  return { total: 0, ranges: Object.fromEntries(['all','today','tomorrow','thisWeek','nextWeek','custom','dateRange'].map(k => [k,0])), unpublished: 0, selfAssign: 0, replacement: 0, allStatuses: 0, completeness: Object.fromEntries(['unassigned','partial','full','awaiting','confirmed','attention'].map(k => [k,0])), queue: Object.fromEntries(['replacement','attention','unassigned','awaiting','unpublished'].map(k => [k,0])) };
}

export type MatchingGameSummary = { total: number; openGames: number };
export function normalizeGameSummary(value: unknown): MatchingGameSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (!count(row.total) || !count(row.openGames) || row.openGames > row.total) return null;
  return { total: row.total, openGames: row.openGames };
}
export function emptyGameSummary(): MatchingGameSummary {
  return { total: 0, openGames: 0 };
}
