const SPORTING_IOWA_FALL_CUP_2026 = "SPORTING IOWA FALL CUP 2026";
const SPORTING_IOWA_RULES_URL = "https://events.htgsports.net/?eventid=14344#/rules";

export function hasTournamentRules(leagueName: string | null | undefined) {
  return leagueName?.trim().toUpperCase() === SPORTING_IOWA_FALL_CUP_2026;
}

export default function TournamentRulesLink({
  leagueName,
  compact = false,
}: {
  leagueName: string | null | undefined;
  compact?: boolean;
}) {
  if (!hasTournamentRules(leagueName)) return null;

  return (
    <a
      className={compact ? "tableButton" : "secondary"}
      href={SPORTING_IOWA_RULES_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Sporting Iowa Fall Cup 2026 tournament rules"
    >
      Tournament Rules
    </a>
  );
}
