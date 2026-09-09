"use client";

import { addReportCopyright } from "../lib/pdfCopyright";

import { useEffect, useMemo, useState } from "react";
import ReportSavedViews from "./ReportSavedViews";

type Named = { name: string } | null;
type Team = { id: string; name: string } | null;
type Game = {
  id: string;
  game_number: string | null;
  status: string;
  starts_at: string;
  officials_needed: number;
  leagues: { id: string; name: string } | null;
  levels: Named;
  location: Named;
  home: Team;
  away: Team;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string | null;
  status: string;
  game_fee: number | null;
  mileage_miles: number | null;
  mileage_rate: number | null;
  payment_status: string | null;
  published_at: string | null;
  accept_by: string | null;
  responded_at: string | null;
  officials: { id: string; first_name: string; last_name: string } | null;
  sport_positions: Named;
};
type Audit = {
  game_id: string | null;
  action: string;
  occurred_at: string;
};
type Period = "30" | "90" | "season" | "custom" | "all";
type Dimension = "organization" | "team" | "level" | "location";
type DetailFocus = "all" | "staffed" | "open" | "declines" | "changes";
type Summary = {
  games: Set<string>;
  slots: number;
  filled: number;
  declines: number;
  changes: number;
  officials: Set<string>;
  fees: number;
  mileage: number;
};

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const inactiveStatuses = new Set([
  "canceled",
  "cancelled",
  "rained_out",
  "on_hold",
]);
const activeAssignment = (item: Assignment) =>
  !["declined", "cancelled"].includes(item.status) && Boolean(item.official_id);
const paidAssignment = (item: Assignment) =>
  activeAssignment(item) && item.payment_status !== "void";
const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const pct = (filled: number, slots: number) =>
  slots ? `${Math.round((filled / slots) * 100)}%` : "—";

export default function OrganizationOperationsReport({ organizationId }: { organizationId?: string }) {
  const [games, setGames] = useState<Game[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [reportingAccess, setReportingAccess] = useState<"standard" | "premium">(
      "standard",
    ),
    [period, setPeriod] = useState<Period>("season"),
    [organization, setOrganization] = useState("all"),
    [team, setTeam] = useState("all"),
    [level, setLevel] = useState("all"),
    [location, setLocation] = useState("all"),
    [status, setStatus] = useState("all"),
    [dimension, setDimension] = useState<Dimension>("organization"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [detailFocus, setDetailFocus] = useState<DetailFocus>("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const drill = (focus: DetailFocus, label?: string) => {
    if (label) {
      if (dimension === "organization") setOrganization(label);
      if (dimension === "team") setTeam(label);
      if (dimension === "level") setLevel(label);
      if (dimension === "location") setLocation(label);
    }
    setDetailFocus(focus);
    window.setTimeout(() => document.getElementById("operations-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/reports/operations?organizationId=${encodeURIComponent(organizationId || "")}`, {
            cache: "no-store",
          }),
          result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Organization reporting could not be loaded.",
          );
        setGames(result.games || []);
        setAssignments(result.assignments || []);
        setAudit(result.audit || []);
        setReportingAccess(
          result.reportingAccess === "premium" ? "premium" : "standard",
        );
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Organization reporting could not be loaded.",
        );
      }
      setLoading(false);
    })();
  }, []);

  const premium = reportingAccess === "premium";
  const assignmentsByGame = useMemo(() => {
    const rows = new Map<string, Assignment[]>();
    assignments.forEach((item) =>
      rows.set(item.game_id, [...(rows.get(item.game_id) || []), item]),
    );
    return rows;
  }, [assignments]);
  const changesByGame = useMemo(() => {
    const rows = new Map<string, number>();
    audit
      .filter((item) => item.action === "assignment_changed" && item.game_id)
      .forEach((item) =>
        rows.set(item.game_id!, (rows.get(item.game_id!) || 0) + 1),
      );
    return rows;
  }, [audit]);
  const gameState = (game: Game) => {
    const rows = assignmentsByGame.get(game.id) || [],
      active = rows.filter(activeAssignment),
      confirmed = active.filter((item) => item.status === "confirmed"),
      declined = rows.filter((item) => item.status === "declined"),
      financial = rows.filter(paidAssignment),
      fees = financial.reduce(
        (sum, item) => sum + Number(item.game_fee || 0),
        0,
      ),
      mileage = financial.reduce(
        (sum, item) =>
          sum +
          Number(item.mileage_miles || 0) * Number(item.mileage_rate || 0),
        0,
      );
    return {
      active,
      confirmed,
      declined,
      open: Math.max(0, Number(game.officials_needed || 0) - active.length),
      filled: Math.min(Number(game.officials_needed || 0), active.length),
      changes: changesByGame.get(game.id) || 0,
      fees,
      mileage,
      total: fees + mileage,
    };
  };

  const options = useMemo(() => {
    const unique = (values: (string | null | undefined)[]) =>
      [...new Set(values.filter(Boolean) as string[])].sort((a, b) =>
        a.localeCompare(b),
      );
    return {
      organizations: unique(games.map((game) => game.leagues?.name)),
      teams: unique(
        games.flatMap((game) => [game.home?.name, game.away?.name]),
      ),
      levels: unique(games.map((game) => game.levels?.name)),
      locations: unique(games.map((game) => game.location?.name)),
      statuses: unique(games.map((game) => game.status)),
    };
  }, [games]);

  const visible = useMemo(() => {
    const now = new Date(),
      cutoff = new Date(now);
    if (period === "30") cutoff.setDate(now.getDate() - 30);
    if (period === "90") cutoff.setDate(now.getDate() - 90);
    return games.filter((game) => {
      const date = new Date(game.starts_at);
      if (
        organization !== "all" &&
        game.leagues?.name !== organization
      )
        return false;
      if (
        team !== "all" &&
        game.home?.name !== team &&
        game.away?.name !== team
      )
        return false;
      if (level !== "all" && game.levels?.name !== level) return false;
      if (location !== "all" && game.location?.name !== location) return false;
      if (status !== "all" && game.status !== status) return false;
      if (period === "custom")
        return (
          (!startDate || date >= new Date(`${startDate}T00:00:00`)) &&
          (!endDate || date <= new Date(`${endDate}T23:59:59`))
        );
      if (period === "season") return date.getFullYear() === now.getFullYear();
      return period === "all" || (date >= cutoff && date <= now);
    });
  }, [
    games,
    period,
    organization,
    team,
    level,
    location,
    status,
    startDate,
    endDate,
  ]);

  const operationalGames = visible.filter(
    (game) => !inactiveStatuses.has(game.status),
  );
  const detailGames = visible.filter((game) => {
    const state = gameState(game);
    if (detailFocus === "staffed") return state.open === 0;
    if (detailFocus === "open") return state.open > 0;
    if (detailFocus === "declines") return state.declined.length > 0;
    if (detailFocus === "changes") return state.changes > 0;
    return true;
  });
  const totals = operationalGames.reduce(
    (sum, game) => {
      const state = gameState(game);
      sum.slots += Number(game.officials_needed || 0);
      sum.filled += state.filled;
      sum.open += state.open;
      sum.declines += state.declined.length;
      sum.changes += state.changes;
      sum.fees += state.fees;
      sum.mileage += state.mileage;
      state.active.forEach((item) => {
        if (item.official_id) sum.officials.add(item.official_id);
      });
      if (!state.open) sum.fullyStaffed += 1;
      if (state.active.length > 0 && state.open > 0) sum.partiallyStaffed += 1;
      if (!state.active.length && state.open > 0) sum.unstaffed += 1;
      return sum;
    },
    {
      slots: 0,
      filled: 0,
      open: 0,
      declines: 0,
      changes: 0,
      fees: 0,
      mileage: 0,
      officials: new Set<string>(),
      fullyStaffed: 0,
      partiallyStaffed: 0,
      unstaffed: 0,
    },
  );
  const totalCost = totals.fees + totals.mileage;
  const gameStatuses = useMemo(() => {
    const rows = new Map<string, number>();
    visible.forEach((game) =>
      rows.set(game.status, (rows.get(game.status) || 0) + 1),
    );
    return [...rows.entries()].sort((a, b) => b[1] - a[1]);
  }, [visible]);

  const summaries = useMemo(() => {
    const rows = new Map<string, Summary>();
    const labelsFor = (game: Game) => {
      if (dimension === "team")
        return [...new Set([game.home?.name, game.away?.name].filter(Boolean))] as string[];
      if (dimension === "level") return [game.levels?.name || "Not specified"];
      if (dimension === "location")
        return [game.location?.name || "Not specified"];
      return [game.leagues?.name || "Not specified"];
    };
    visible.forEach((game) => {
      const state = gameState(game),
        eligible = !inactiveStatuses.has(game.status);
      labelsFor(game).forEach((label) => {
        const row = rows.get(label) || {
          games: new Set<string>(),
          slots: 0,
          filled: 0,
          declines: 0,
          changes: 0,
          officials: new Set<string>(),
          fees: 0,
          mileage: 0,
        };
        row.games.add(game.id);
        if (eligible) {
          row.slots += Number(game.officials_needed || 0);
          row.filled += state.filled;
          row.declines += state.declined.length;
          row.changes += state.changes;
          row.fees += state.fees;
          row.mileage += state.mileage;
          state.active.forEach((item) => {
            if (item.official_id) row.officials.add(item.official_id);
          });
        }
        rows.set(label, row);
      });
    });
    return [...rows.entries()].sort(
      (a, b) => b[1].games.size - a[1].games.size || a[0].localeCompare(b[0]),
    );
  }, [visible, assignmentsByGame, changesByGame, dimension]);

  const filterLabel = () =>
    [
      organization !== "all" ? organization : "All organizations",
      period === "season"
        ? `${new Date().getFullYear()} season`
        : period === "all"
          ? "All dates"
          : period === "custom"
            ? `${startDate || "Beginning"} to ${endDate || "Today"}`
            : `Last ${period} days`,
    ].join(" • ");
  const quote = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const exportCsv = () => {
    const headings = [
      "Date",
      "Game",
      "Paying Organization",
      "Level",
      "Home",
      "Away",
      "Location",
      "Status",
      "Positions Needed",
      "Positions Filled",
      "Open Positions",
      "Confirmed",
      "Declines",
      "Assignment Changes",
      ...(premium ? ["Game Fees", "Mileage Pay", "Total Cost"] : []),
    ];
    const detail = visible.map((game) => {
      const state = gameState(game);
      return [
        new Date(game.starts_at).toLocaleString(),
        game.game_number,
        game.leagues?.name,
        game.levels?.name,
        game.home?.name,
        game.away?.name,
        game.location?.name,
        titleCase(game.status),
        game.officials_needed,
        state.active.length,
        state.open,
        state.confirmed.length,
        state.declined.length,
        state.changes,
        ...(premium
          ? [state.fees.toFixed(2), state.mileage.toFixed(2), state.total.toFixed(2)]
          : []),
      ]
        .map(quote)
        .join(",");
    });
    const blob = new Blob([[headings.map(quote).join(","), ...detail].join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "refassign-organization-operations.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!premium) return;
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]),
      document = new jsPDF({ orientation: "landscape" });
    document.setTextColor(12, 30, 55);
    document.setFontSize(18);
    document.text("RefAssign Organization Operations Report", 14, 16);
    document.setFontSize(9);
    document.setTextColor(100, 116, 139);
    document.text(filterLabel(), 14, 23);
    document.setTextColor(15, 23, 42);
    document.text(
      `Games: ${visible.length}    Coverage: ${pct(totals.filled, totals.slots)}    Open positions: ${totals.open}    Officials used: ${totals.officials.size}    Total cost: ${money(totalCost)}`,
      14,
      31,
    );
    autoTable(document, {
      startY: 38,
      head: [[
        dimension === "organization" ? "Paying organization" : titleCase(dimension),
        "Games",
        "Coverage",
        "Officials",
        "Declines",
        "Changes",
        "Game fees",
        "Mileage",
        "Total",
      ]],
      body: summaries.map(([label, row]) => [
        label,
        row.games.size,
        pct(row.filled, row.slots),
        row.officials.size,
        row.declines,
        row.changes,
        money(row.fees),
        money(row.mileage),
        money(row.fees + row.mileage),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    autoTable(document, {
      head: [[
        "Date",
        "Game",
        "Organization / Level",
        "Teams",
        "Location",
        "Status",
        "Coverage",
        "Cost",
      ]],
      body: visible.map((game) => {
        const state = gameState(game);
        return [
          new Date(game.starts_at).toLocaleDateString(),
          game.game_number || "—",
          `${game.leagues?.name || "—"} / ${game.levels?.name || "—"}`,
          `${game.home?.name || "TBD"} vs ${game.away?.name || "TBD"}`,
          game.location?.name || "—",
          titleCase(game.status),
          `${state.active.length}/${game.officials_needed}`,
          money(state.total),
        ];
      }),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [12, 30, 55] },
    });
    addReportCopyright(document); document.save("refassign-organization-operations.pdf");
  };

  if (loading)
    return (
      <section className="card">
        <p>Loading organization operations…</p>
      </section>
    );
  return (
    <section className="card officialReports organizationOperationsReport">
      <div className="cardHead">
        <div>
          <h2>Organization Operations</h2>
          <p>
            Review game volume, staffing performance, assignment activity, and
            officiating costs by paying organization.
          </p>
        </div>
        <div className="headerActions">
          {premium && <span className="badge">Premium reporting</span>}
          <button className="secondary" disabled={!visible.length} onClick={exportCsv}>
            Export CSV
          </button>
          {premium && (
            <button className="secondary" disabled={!visible.length} onClick={exportPdf}>
              Export PDF
            </button>
          )}
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {!error && (
        <>
          <div className="reportFilters operationsFilters">
            <label>
              Reporting period
              <select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
                <option value="season">Current season</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="custom">Custom dates</option>
                <option value="all">All games</option>
              </select>
            </label>
            {period === "custom" && (
              <>
                <label>
                  Start date
                  <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label>
                  End date
                  <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </label>
              </>
            )}
            <label>
              Paying organization
              <select value={organization} onChange={(event) => setOrganization(event.target.value)}>
                <option value="all">All organizations</option>
                {options.organizations.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              Team
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="all">All teams</option>
                {options.teams.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="all">All levels</option>
                {options.levels.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              Location
              <select value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="all">All locations</option>
                {options.locations.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label>
              Game status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                {options.statuses.map((name) => <option key={name} value={name}>{titleCase(name)}</option>)}
              </select>
            </label>
          </div>
          <ReportSavedViews organizationId={organizationId} reportKey="operations" filters={{ period, organization, team, level, location, status, dimension, startDate, endDate }} onApply={(saved) => { if (saved.period) setPeriod(saved.period as Period); if (saved.organization) setOrganization(saved.organization); if (saved.team) setTeam(saved.team); if (saved.level) setLevel(saved.level); if (saved.location) setLocation(saved.location); if (saved.status) setStatus(saved.status); if (saved.dimension) setDimension(saved.dimension as Dimension); setStartDate(saved.startDate || ""); setEndDate(saved.endDate || ""); }} />

          <div className="reportMetrics operationsMetrics drilldownMetrics">
            <button type="button" onClick={() => drill("all")}><span>Games</span><b>{visible.length}</b></button>
            <button type="button" onClick={() => drill("all")}><span>Coverage rate</span><b>{pct(totals.filled, totals.slots)}</b></button>
            <button type="button" onClick={() => drill("staffed")}><span>Fully staffed</span><b>{totals.fullyStaffed}</b></button>
            <button type="button" onClick={() => drill("open")}><span>Open positions</span><b>{totals.open}</b></button>
            <button type="button" onClick={() => drill("all")}><span>Officials used</span><b>{totals.officials.size}</b></button>
            <button type="button" onClick={() => drill("declines")}><span>Declines</span><b>{totals.declines}</b></button>
            <button type="button" onClick={() => drill("changes")}><span>Assignment changes</span><b>{totals.changes}</b></button>
            {premium && <button type="button" className="premiumMetric" onClick={() => drill("all")}><span>Total expense</span><b>{money(totalCost)}</b></button>}
          </div>

          {!premium && (
            <div className="reportPremiumNotice">
              <b>Standard reporting</b>
              <span>
                Financial comparisons, expense graphics, and PDF export are
                available when Premium Reporting is enabled for this account.
              </span>
            </div>
          )}

          <div className="reportCharts">
            <article className="reportChart">
              <h4>Staffing condition</h4>
              <div className="operationsStatusGrid">
                <div><span>Fully staffed</span><b>{totals.fullyStaffed}</b></div>
                <div><span>Partially staffed</span><b>{totals.partiallyStaffed}</b></div>
                <div><span>Unstaffed</span><b>{totals.unstaffed}</b></div>
              </div>
            </article>
            <article className="reportChart">
              <h4>Games by status</h4>
              <div className="reportBars">
                {gameStatuses.map(([label, value]) => (
                  <div className="reportBarRow" key={label}>
                    <span>{titleCase(label)}</span>
                    <i><em style={{ width: `${(value / Math.max(1, ...gameStatuses.map((row) => row[1]))) * 100}%` }} /></i>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </article>
            {premium && (
              <article className="reportChart reportTrend operationsCostChart">
                <h4>
                  Cost by {dimension === "organization" ? "paying organization" : dimension}
                </h4>
                <div className="reportBars">
                  {summaries.slice(0, 10).map(([label, row]) => {
                    const total = row.fees + row.mileage,
                      max = Math.max(1, ...summaries.map((item) => item[1].fees + item[1].mileage));
                    return (
                      <div className="reportBarRow" key={label}>
                        <span title={label}>{label}</span>
                        <i><em style={{ width: `${(total / max) * 100}%` }} /></i>
                        <b>{money(total)}</b>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}
          </div>

          <div className="operationsBreakdownHead">
            <div>
              <h3>Operations breakdown</h3>
              <p>Change the grouping without changing the filters above.</p>
            </div>
            <label>
              Group by
              <select value={dimension} onChange={(event) => setDimension(event.target.value as Dimension)}>
                <option value="organization">Paying organization</option>
                <option value="team">Team</option>
                <option value="level">Level</option>
                <option value="location">Location</option>
              </select>
            </label>
          </div>
          <div className="tableWrap">
            <table className="officialReportTable operationsSummaryTable">
              <thead><tr>
                <th>{dimension === "organization" ? "Paying organization" : titleCase(dimension)}</th>
                <th>Games</th><th>Coverage</th><th>Officials</th><th>Declines</th><th>Changes</th>
                {premium && <><th>Game fees</th><th>Mileage</th><th>Total</th></>}
              </tr></thead>
              <tbody>
                {summaries.length ? summaries.map(([label, row]) => (
                  <tr key={label} className="drilldownRow" onClick={() => drill("all", label)}>
                    <td><b>{label}</b></td><td>{row.games.size}</td><td>{pct(row.filled, row.slots)}</td>
                    <td>{row.officials.size}</td><td>{row.declines}</td><td>{row.changes}</td>
                    {premium && <><td>{money(row.fees)}</td><td>{money(row.mileage)}</td><td><b>{money(row.fees + row.mileage)}</b></td></>}
                  </tr>
                )) : <tr><td colSpan={premium ? 9 : 6}>No games match these filters.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="drilldownDetailHead" id="operations-detail"><h3>Game operations detail{detailFocus !== "all" ? ` — ${detailFocus}` : ""}</h3>{detailFocus !== "all" ? <button type="button" className="tableButton" onClick={() => setDetailFocus("all")}>Clear drill-down</button> : null}</div>
          <div className="tableWrap">
            <table className="officialReportTable operationsDetailTable">
              <thead><tr>
                <th>Date</th><th>Game</th><th>Organization / Level</th><th>Location</th><th>Status</th>
                <th>Coverage</th><th>Confirmed</th><th>Declines</th><th>Changes</th>{premium && <th>Cost</th>}
              </tr></thead>
              <tbody>
                {detailGames.length ? detailGames.map((game) => {
                  const state = gameState(game);
                  return (
                    <tr key={game.id}>
                      <td>{new Date(game.starts_at).toLocaleDateString()}<small>{new Date(game.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></td>
                      <td><b>{game.game_number || "—"}</b><small>{game.home?.name || "TBD"} vs {game.away?.name || "TBD"}</small></td>
                      <td>{game.leagues?.name || "—"}<small>{game.levels?.name || "—"}</small></td>
                      <td>{game.location?.name || "—"}</td><td>{titleCase(game.status)}</td>
                      <td>{state.active.length}/{game.officials_needed}<small>{state.open ? `${state.open} open` : "Fully staffed"}</small></td>
                      <td>{state.confirmed.length}</td><td>{state.declined.length}</td><td>{state.changes}</td>
                      {premium && <td><b>{money(state.total)}</b><small>{money(state.fees)} fees + {money(state.mileage)} mileage</small></td>}
                    </tr>
                  );
                }) : <tr><td colSpan={premium ? 10 : 9}>No games match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
