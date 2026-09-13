"use client";

import { useEffect, useMemo, useState } from "react";

type ReportKey =
  | "audit"
  | "coverage"
  | "declines"
  | "operations";
type Game = {
  id: string;
  status: string;
  starts_at: string;
  officials_needed: number;
  leagues: { id: string; name: string } | null;
  levels: { name: string } | null;
  location: { name: string } | null;
  home: { id: string; name: string } | null;
  away: { id: string; name: string } | null;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string | null;
  status: string;
  published_at: string | null;
  responded_at: string | null;
};
type Audit = { action: string; occurred_at: string };
type OverviewData = {
  reportingAccess: "standard" | "premium";
  games: Game[];
  assignments: Assignment[];
  audit: Audit[];
};

const inactive = new Set(["canceled", "cancelled", "rained_out", "on_hold"]);
const activeAssignment = (row: Assignment) =>
  Boolean(row.official_id) && !["declined", "cancelled", "canceled"].includes(row.status);

export default function ReportingOverview({
  organizationId,
  onOpenReport,
  onAccessLoaded,
}: {
  organizationId?: string;
  onOpenReport: (report: ReportKey) => void;
  onAccessLoaded?: (access: "standard" | "premium") => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/reports/operations?organizationId=${encodeURIComponent(organizationId || "")}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Reporting overview could not be loaded.");
        if (!active) return;
        const next = result as OverviewData;
        setData(next);
        onAccessLoaded?.(next.reportingAccess === "premium" ? "premium" : "standard");
      } catch (reason) {
        if (active)
          setError(reason instanceof Error ? reason.message : "Reporting overview could not be loaded.");
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, onAccessLoaded]);

  const summary = useMemo(() => {
    const games = data?.games || [], assignments = data?.assignments || [];
    const currentGames = games.filter((game) => !inactive.has(game.status));
    const byGame = new Map<string, Assignment[]>();
    assignments.forEach((row) => byGame.set(row.game_id, [...(byGame.get(row.game_id) || []), row]));
    const slots = currentGames.reduce((sum, game) => sum + Number(game.officials_needed || 0), 0);
    const filled = currentGames.reduce(
      (sum, game) => sum + Math.min(Number(game.officials_needed || 0), (byGame.get(game.id) || []).filter(activeAssignment).length),
      0,
    );
    const openGames = currentGames.filter(
      (game) => (byGame.get(game.id) || []).filter(activeAssignment).length < Number(game.officials_needed || 0),
    ).length;
    const declines = assignments.filter((row) => row.status === "declined").length;
    const awaiting = assignments.filter(
      (row) => row.published_at && !row.responded_at && !["accepted", "confirmed", "declined", "cancelled"].includes(row.status),
    ).length;
    const incompleteGames = games.filter(
      (game) => !game.leagues || !game.levels || !game.location || !game.home || !game.away,
    ).length;
    const changes = (data?.audit || []).filter(
      (row) => row.action === "assignment_changed" && Date.now() - new Date(row.occurred_at).getTime() <= 30 * 86400000,
    ).length;
    return { slots, filled, openGames, declines, awaiting, incompleteGames, changes };
  }, [data]);

  if (error) return <section className="card"><div className="errorBox">{error}</div></section>;
  if (!data) return <section className="card"><p>Loading reporting overview…</p></section>;
  const coverage = summary.slots ? Math.round((summary.filled / summary.slots) * 100) : 0;
  const qualityIssues = summary.incompleteGames + summary.awaiting;

  return (
    <section className="card reportingOverview">
      <div className="cardHead">
        <div>
          <span className="reportEyebrow">Standard reporting</span>
          <h2>Reporting Overview</h2>
          <p>Start with the health of today&apos;s operation, then open the report behind each result.</p>
        </div>
        <span className={`reportAccessBadge ${data.reportingAccess}`}>{data.reportingAccess === "premium" ? "Premium enabled" : "Standard plan"}</span>
      </div>
      <div className="reportOverviewMetrics">
        <button onClick={() => onOpenReport("coverage")}><span>Assignment coverage</span><b>{coverage}%</b><small>{summary.filled} of {summary.slots} positions filled</small></button>
        <button onClick={() => onOpenReport("coverage")} className={summary.openGames ? "needsAttention" : ""}><span>Games needing officials</span><b>{summary.openGames}</b><small>Open the coverage detail</small></button>
        <button onClick={() => onOpenReport("declines")} className={summary.declines ? "needsAttention" : ""}><span>Declined assignments</span><b>{summary.declines}</b><small>Review replacements and patterns</small></button>
        <button onClick={() => onOpenReport("operations")} className={summary.awaiting ? "needsAttention" : ""}><span>Awaiting response</span><b>{summary.awaiting}</b><small>Published offers without a response</small></button>
        <button onClick={() => onOpenReport("audit")}><span>Changes in 30 days</span><b>{summary.changes}</b><small>Open Change &amp; Audit</small></button>
        <button onClick={() => onOpenReport("operations")} className={qualityIssues ? "needsAttention" : ""}><span>Data quality checks</span><b>{qualityIssues}</b><small>{summary.incompleteGames} incomplete games · {summary.awaiting} open responses</small></button>
      </div>
      <div className="reportTierSummary">
        <article>
          <b>Included with Standard</b>
          <span>Operational reports, mobile layouts, report guidance, CSV exports, data-quality checks, and one remembered report.</span>
        </article>
        <article className="premium">
          <b>Premium adds automation</b>
          <span>Favorites, scheduled delivery, configurable alerts, drill-down analysis, branded PDFs, forecasting, and comparisons.</span>
        </article>
      </div>
    </section>
  );
}
