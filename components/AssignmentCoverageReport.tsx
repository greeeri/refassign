"use client";

import { useEffect, useMemo, useState } from "react";

type Named = { name: string } | null;
type Game = {
  id: string;
  game_number: string | null;
  status: string;
  starts_at: string;
  officials_needed: number;
  leagues: { id: string; name: string } | null;
  levels: Named;
  location: Named;
  home: Named;
  away: Named;
};
type Assignment = {
  id: string;
  game_id: string;
  status: string;
  published_at: string | null;
  accept_by: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  officials: { first_name: string; last_name: string } | null;
  sport_positions: Named;
};
type Period = "30" | "90" | "season" | "all";
type Coverage = "all" | "unfilled" | "partial" | "filled" | "attention";

const inactiveStatuses = new Set([
  "canceled",
  "cancelled",
  "rained_out",
  "on_hold",
]);
const activeAssignment = (item: Assignment) =>
  !["declined", "cancelled"].includes(item.status);
const assignmentName = (item: Assignment) =>
  `${item.officials?.first_name || ""} ${item.officials?.last_name || ""}`.trim() ||
  "Open";

export default function AssignmentCoverageReport({ organizationId }: { organizationId?: string }) {
  const [games, setGames] = useState<Game[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [period, setPeriod] = useState<Period>("90");
  const [league, setLeague] = useState("all");
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/reports/coverage?organizationId=${encodeURIComponent(organizationId || "")}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        setError(result.error || "Coverage reporting could not be loaded.");
      else {
        setGames(result.games || []);
        setAssignments(result.assignments || []);
      }
      setLoading(false);
    })();
  }, []);

  const assignmentsByGame = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignments.forEach((item) =>
      map.set(item.game_id, [...(map.get(item.game_id) || []), item]),
    );
    return map;
  }, [assignments]);
  const leagues = useMemo(
    () =>
      [
        ...new Set(
          games.map((game) => game.leagues?.name).filter(Boolean) as string[],
        ),
      ].sort(),
    [games],
  );
  const stateOf = (game: Game) => {
    const rows = assignmentsByGame.get(game.id) || [];
    const active = rows.filter(activeAssignment).length;
    const confirmed = rows.filter((item) => item.status === "confirmed").length;
    const declined = rows.filter((item) => item.status === "declined").length;
    const overdue = rows.some(
      (item) =>
        item.status === "proposed" &&
        item.accept_by &&
        new Date(item.accept_by) < new Date(),
    );
    const filled = active >= game.officials_needed;
    return {
      rows,
      active,
      confirmed,
      declined,
      overdue,
      filled,
      partial: active > 0 && !filled,
      open: Math.max(0, game.officials_needed - active),
      attention: declined > 0 || overdue,
    };
  };
  const visible = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    if (period === "30") end.setDate(end.getDate() + 30);
    if (period === "90") end.setDate(end.getDate() + 90);
    if (period === "season") end.setMonth(end.getMonth() + 6);
    return games.filter((game) => {
      const state = stateOf(game),
        date = new Date(game.starts_at);
      if (league !== "all" && game.leagues?.name !== league) return false;
      if (period !== "all" && (date < now || date > end)) return false;
      if (coverage === "unfilled" && state.active !== 0) return false;
      if (coverage === "partial" && !state.partial) return false;
      if (coverage === "filled" && !state.filled) return false;
      if (coverage === "attention" && !state.attention) return false;
      return true;
    });
  }, [games, assignmentsByGame, period, league, coverage]);
  const activeGames = visible.filter(
    (game) => !inactiveStatuses.has(game.status),
  );
  const totals = activeGames.reduce(
    (sum, game) => {
      const state = stateOf(game);
      sum.slots += game.officials_needed;
      sum.filled += Math.min(game.officials_needed, state.active);
      sum.open += state.open;
      sum.unconfirmed += Math.max(0, state.active - state.confirmed);
      sum.declined += state.declined;
      if (state.attention || state.open > 0) sum.attention += 1;
      return sum;
    },
    { slots: 0, filled: 0, open: 0, unconfirmed: 0, declined: 0, attention: 0 },
  );
  const leagueSummary = useMemo(() => {
    const map = new Map<
      string,
      { games: number; slots: number; filled: number; open: number }
    >();
    activeGames.forEach((game) => {
      const name = game.leagues?.name || "Not specified",
        state = stateOf(game);
      const row = map.get(name) || { games: 0, slots: 0, filled: 0, open: 0 };
      row.games += 1;
      row.slots += game.officials_needed;
      row.filled += Math.min(game.officials_needed, state.active);
      row.open += state.open;
      map.set(name, row);
    });
    return [...map.entries()].sort(
      (a, b) => b[1].open - a[1].open || a[0].localeCompare(b[0]),
    );
  }, [activeGames, assignmentsByGame]);
  const exportCsv = () => {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = visible.map((game) => {
      const state = stateOf(game);
      return [
        new Date(game.starts_at).toLocaleString(),
        game.game_number,
        game.leagues?.name,
        game.levels?.name,
        game.home?.name,
        game.away?.name,
        game.location?.name,
        game.status,
        game.officials_needed,
        state.active,
        state.confirmed,
        state.open,
        state.declined,
        state.overdue ? "Yes" : "No",
      ]
        .map(quote)
        .join(",");
    });
    const blob = new Blob(
      [
        [
          "Date,Game,League,Level,Home,Away,Location,Game Status,Needed,Assigned,Confirmed,Open,Declined,Overdue",
          ...rows,
        ].join("\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "refassign-assignment-coverage.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading)
    return (
      <section className="card">
        <p>Loading assignment coverage…</p>
      </section>
    );
  return (
    <section className="card officialReports">
      <div className="cardHead">
        <div>
          <h2>Assignment Coverage</h2>
          <p>
            Track filled positions, open slots, confirmations, declines, and
            games requiring attention.
          </p>
        </div>
        <button
          className="secondary"
          disabled={!visible.length}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      {error && <div className="errorBox">{error}</div>}
      <div className="reportFilters">
        <label>
          Upcoming period
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <option value="30">Next 30 days</option>
            <option value="90">Next 90 days</option>
            <option value="season">Next 6 months</option>
            <option value="all">All games</option>
          </select>
        </label>
        <label>
          League
          <select value={league} onChange={(e) => setLeague(e.target.value)}>
            <option value="all">All leagues</option>
            {leagues.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Coverage
          <select
            value={coverage}
            onChange={(e) => setCoverage(e.target.value as Coverage)}
          >
            <option value="all">All coverage</option>
            <option value="unfilled">Unfilled</option>
            <option value="partial">Partially filled</option>
            <option value="filled">Fully filled</option>
            <option value="attention">Needs attention</option>
          </select>
        </label>
      </div>
      <div className="reportMetrics">
        <div>
          <span>Games</span>
          <b>{activeGames.length}</b>
        </div>
        <div>
          <span>Coverage rate</span>
          <b>
            {totals.slots
              ? `${Math.round((totals.filled / totals.slots) * 100)}%`
              : "—"}
          </b>
        </div>
        <div>
          <span>Open positions</span>
          <b>{totals.open}</b>
        </div>
        <div>
          <span>Awaiting confirmation</span>
          <b>{totals.unconfirmed}</b>
        </div>
        <div>
          <span>Declined</span>
          <b>{totals.declined}</b>
        </div>
        <div>
          <span>Games needing attention</span>
          <b>{totals.attention}</b>
        </div>
      </div>
      <h3>Coverage by league</h3>
      <div className="tableWrap">
        <table className="officialReportTable">
          <thead>
            <tr>
              <th>League</th>
              <th>Games</th>
              <th>Positions</th>
              <th>Filled</th>
              <th>Open</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {leagueSummary.map(([name, row]) => (
              <tr key={name}>
                <td>
                  <b>{name}</b>
                </td>
                <td>{row.games}</td>
                <td>{row.slots}</td>
                <td>{row.filled}</td>
                <td>{row.open}</td>
                <td>
                  {row.slots
                    ? `${Math.round((row.filled / row.slots) * 100)}%`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Game coverage detail</h3>
      <div className="tableWrap">
        <table className="officialReportTable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Game</th>
              <th>League / Level</th>
              <th>Location</th>
              <th>Coverage</th>
              <th>Confirmed</th>
              <th>Attention</th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((game) => {
                const state = stateOf(game);
                return (
                  <tr key={game.id}>
                    <td>
                      {new Date(game.starts_at).toLocaleDateString()}
                      <small>
                        {new Date(game.starts_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </small>
                    </td>
                    <td>
                      <b>{game.game_number || "—"}</b>
                      <small>
                        {game.home?.name || "TBD"} vs {game.away?.name || "TBD"}
                      </small>
                    </td>
                    <td>
                      {game.leagues?.name || "—"}
                      <small>{game.levels?.name || "—"}</small>
                    </td>
                    <td>{game.location?.name || "—"}</td>
                    <td>
                      <b>
                        {state.active}/{game.officials_needed}
                      </b>
                      <small>
                        {state.open ? `${state.open} open` : "Fully staffed"}
                      </small>
                    </td>
                    <td>
                      {state.confirmed}/{game.officials_needed}
                      <small>
                        {state.rows
                          .filter(activeAssignment)
                          .map(assignmentName)
                          .join(", ") || "No officials"}
                      </small>
                    </td>
                    <td>
                      {inactiveStatuses.has(game.status)
                        ? game.status.replaceAll("_", " ")
                        : state.overdue
                          ? "Response overdue"
                          : state.declined
                            ? `${state.declined} declined`
                            : state.open
                              ? "Open positions"
                              : "Ready"}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7}>No games match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
