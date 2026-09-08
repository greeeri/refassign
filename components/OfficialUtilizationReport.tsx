"use client";

import { useEffect, useMemo, useState } from "react";

type Named = { name: string } | null;
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
  max_games_per_day: number | null;
};
type Game = {
  id: string;
  game_number: string | null;
  starts_at: string;
  status: string;
  leagues: Named;
  levels: Named;
  location: Named;
  home: Named;
  away: Named;
};
type Assignment = {
  id: string;
  official_id: string;
  status: string;
  assigned_at: string | null;
  published_at: string | null;
  responded_at: string | null;
  game_fee: number | null;
  mileage_miles: number | null;
  mileage_rate: number | null;
  payment_status: string | null;
  officials: Official | null;
  sport_positions: Named;
  games: Game;
};
type Replacement = {
  game_id: string | null;
  occurred_at: string;
  previous_official_id: string | null;
  new_official_id: string | null;
};
type Period = "30" | "90" | "season" | "custom" | "all";
type AlertFilter = "all" | "quiet" | "high" | "unanswered";
type Sort = "assignments" | "name" | "recent" | "acceptance" | "miles" | "compensation";
type OfficialRow = {
  official: Official;
  assignments: Assignment[];
  total: number;
  past7: number;
  past30: number;
  past90: number;
  weekday: number;
  weekend: number;
  proposed: number;
  accepted: number;
  confirmed: number;
  declined: number;
  acceptanceRate: number | null;
  confirmationRate: number | null;
  responseHours: number | null;
  replacements: number;
  maxDaily: number;
  positions: string[];
  levels: string[];
  latest: Date | null;
  longestGap: number;
  miles: number;
  compensation: number;
  quiet: boolean;
  high: boolean;
};

const activeAssignment = (item: Assignment) =>
  !["declined", "cancelled", "canceled"].includes(item.status);
const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const hours = (value: number | null) => {
  if (value === null) return "—";
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(value < 10 ? 1 : 0)} hr`;
};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const dateInPastDays = (date: Date, days: number, now: Date) => {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff && date <= now;
};

export default function OfficialUtilizationReport({ organizationId }: { organizationId?: string }) {
  const [officials, setOfficials] = useState<Official[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [replacements, setReplacements] = useState<Replacement[]>([]),
    [reportingAccess, setReportingAccess] = useState<"standard" | "premium">("standard"),
    [period, setPeriod] = useState<Period>("season"),
    [organization, setOrganization] = useState("all"),
    [level, setLevel] = useState("all"),
    [position, setPosition] = useState("all"),
    [location, setLocation] = useState("all"),
    [alert, setAlert] = useState<AlertFilter>("all"),
    [sort, setSort] = useState<Sort>("assignments"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [quietDays, setQuietDays] = useState(30),
    [weeklyLimit, setWeeklyLimit] = useState(6),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/reports/utilization?organizationId=${encodeURIComponent(organizationId || "")}`, { cache: "no-store" }),
          result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Official utilization could not be loaded.");
        setOfficials(result.officials || []);
        setAssignments(result.assignments || []);
        setReplacements(result.replacements || []);
        setReportingAccess(result.reportingAccess === "premium" ? "premium" : "standard");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Official utilization could not be loaded.");
      }
      setLoading(false);
    })();
  }, []);

  const premium = reportingAccess === "premium";
  const options = useMemo(() => {
    const unique = (values: (string | null | undefined)[]) =>
      [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
    return {
      organizations: unique(assignments.map((item) => item.games?.leagues?.name)),
      levels: unique(assignments.map((item) => item.games?.levels?.name)),
      positions: unique(assignments.map((item) => item.sport_positions?.name)),
      locations: unique(assignments.map((item) => item.games?.location?.name)),
    };
  }, [assignments]);

  const selectedAssignments = useMemo(() => {
    const now = new Date(), cutoff = new Date(now);
    if (period === "30") cutoff.setDate(cutoff.getDate() - 30);
    if (period === "90") cutoff.setDate(cutoff.getDate() - 90);
    return assignments.filter((item) => {
      if (!item.games?.starts_at) return false;
      const date = new Date(item.games.starts_at);
      if (organization !== "all" && item.games.leagues?.name !== organization) return false;
      if (level !== "all" && item.games.levels?.name !== level) return false;
      if (position !== "all" && item.sport_positions?.name !== position) return false;
      if (location !== "all" && item.games.location?.name !== location) return false;
      if (period === "custom")
        return (!startDate || date >= new Date(`${startDate}T00:00:00`)) &&
          (!endDate || date <= new Date(`${endDate}T23:59:59`));
      if (period === "season") return date.getFullYear() === now.getFullYear();
      return period === "all" || (date >= cutoff && date <= now);
    });
  }, [assignments, period, organization, level, position, location, startDate, endDate]);

  const rows = useMemo(() => {
    const now = new Date(),
      filteredByDimension = [organization, level, position, location].some((value) => value !== "all"),
      byOfficial = new Map<string, Assignment[]>(),
      selectedGameIds = new Set(selectedAssignments.map((item) => item.games.id));
    selectedAssignments.forEach((item) =>
      byOfficial.set(item.official_id, [...(byOfficial.get(item.official_id) || []), item]),
    );
    const result: OfficialRow[] = officials
      .filter((official) => !filteredByDimension || byOfficial.has(official.id))
      .map((official) => {
        const all = byOfficial.get(official.id) || [],
          active = all.filter(activeAssignment),
          pastActive = active.filter((item) => new Date(item.games.starts_at) <= now),
          offered = all.filter((item) => Boolean(item.published_at) || ["proposed", "accepted", "confirmed", "declined"].includes(item.status)),
          acceptedCount = all.filter((item) => ["accepted", "confirmed"].includes(item.status)).length,
          confirmed = all.filter((item) => item.status === "confirmed").length,
          responseTimes = all
            .filter((item) => item.published_at && item.responded_at)
            .map((item) => (new Date(item.responded_at!).getTime() - new Date(item.published_at!).getTime()) / 3600000)
            .filter((value) => value >= 0),
          dayCounts = new Map<string, number>();
        active.forEach((item) => {
          const key = dayKey(new Date(item.games.starts_at));
          dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
        });
        const dates = pastActive.map((item) => new Date(item.games.starts_at)).sort((a, b) => a.getTime() - b.getTime()),
          gaps = dates.slice(1).map((date, index) => Math.round((date.getTime() - dates[index].getTime()) / 86400000)),
          latest = dates.at(-1) || null,
          past7 = pastActive.filter((item) => dateInPastDays(new Date(item.games.starts_at), 7, now)).length,
          miles = active.reduce((sum, item) => sum + Number(item.mileage_miles || 0), 0),
          compensation = active
            .filter((item) => item.payment_status !== "void")
            .reduce((sum, item) => sum + Number(item.game_fee || 0) + Number(item.mileage_miles || 0) * Number(item.mileage_rate || 0), 0);
        return {
          official,
          assignments: active,
          total: active.length,
          past7,
          past30: pastActive.filter((item) => dateInPastDays(new Date(item.games.starts_at), 30, now)).length,
          past90: pastActive.filter((item) => dateInPastDays(new Date(item.games.starts_at), 90, now)).length,
          weekday: active.filter((item) => ![0, 6].includes(new Date(item.games.starts_at).getDay())).length,
          weekend: active.filter((item) => [0, 6].includes(new Date(item.games.starts_at).getDay())).length,
          proposed: all.filter((item) => item.status === "proposed").length,
          accepted: all.filter((item) => item.status === "accepted").length,
          confirmed,
          declined: all.filter((item) => item.status === "declined").length,
          acceptanceRate: offered.length ? acceptedCount / offered.length : null,
          confirmationRate: offered.length ? confirmed / offered.length : null,
          responseHours: responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : null,
          replacements: replacements.filter((event) => selectedGameIds.has(event.game_id || "") &&
            (event.previous_official_id === official.id || event.new_official_id === official.id)).length,
          maxDaily: Math.max(0, ...dayCounts.values()),
          positions: [...new Set(active.map((item) => item.sport_positions?.name).filter(Boolean) as string[])],
          levels: [...new Set(active.map((item) => item.games.levels?.name).filter(Boolean) as string[])],
          latest,
          longestGap: Math.max(0, ...gaps),
          miles,
          compensation,
          quiet: !latest || (now.getTime() - latest.getTime()) / 86400000 > quietDays,
          high: past7 >= weeklyLimit || Math.max(0, ...dayCounts.values()) > Number(official.max_games_per_day || Infinity),
        };
      });
    return result
      .filter((row) => alert === "all" || (alert === "quiet" && row.quiet) || (alert === "high" && row.high) || (alert === "unanswered" && row.proposed > 0))
      .sort((a, b) => {
        if (sort === "name") return `${a.official.last_name}${a.official.first_name}`.localeCompare(`${b.official.last_name}${b.official.first_name}`);
        if (sort === "recent") return (b.latest?.getTime() || 0) - (a.latest?.getTime() || 0);
        if (sort === "acceptance") return (b.acceptanceRate ?? -1) - (a.acceptanceRate ?? -1);
        if (sort === "miles") return b.miles - a.miles;
        if (sort === "compensation") return b.compensation - a.compensation;
        return b.total - a.total || a.official.last_name.localeCompare(b.official.last_name);
      });
  }, [officials, selectedAssignments, replacements, organization, level, position, location, quietDays, weeklyLimit, alert, sort]);

  const totals = useMemo(() => ({
    assignments: rows.reduce((sum, row) => sum + row.total, 0),
    activeOfficials: rows.filter((row) => row.total > 0).length,
    quietOfficials: rows.filter((row) => row.quiet).length,
    highOfficials: rows.filter((row) => row.high).length,
    unanswered: rows.reduce((sum, row) => sum + row.proposed, 0),
    miles: rows.reduce((sum, row) => sum + row.miles, 0),
    compensation: rows.reduce((sum, row) => sum + row.compensation, 0),
  }), [rows]);

  const distribution = useMemo(() => {
    const values: [string, number][] = [["No assignments", 0], ["1–2", 0], ["3–5", 0], ["6+", 0]];
    rows.forEach((row) => {
      const index = row.total === 0 ? 0 : row.total <= 2 ? 1 : row.total <= 5 ? 2 : 3;
      values[index][1] += 1;
    });
    return values;
  }, [rows]);

  const trend = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, offset) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1),
        next = new Date(month.getFullYear(), month.getMonth() + 1, 1),
        count = assignments.filter((item) => activeAssignment(item) && new Date(item.games.starts_at) >= month && new Date(item.games.starts_at) < next).length;
      return { label: month.toLocaleDateString("en-US", { month: "short" }), count };
    });
  }, [assignments]);

  const periodLabel = () => period === "season" ? `${new Date().getFullYear()} season` : period === "all" ? "All dates" : period === "custom" ? `${startDate || "Beginning"} to ${endDate || "Today"}` : `Last ${period} days`;
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const exportCsv = () => {
    const headings = ["Official", "Active", "Assignments", "Last 7 Days", "Last 30 Days", "Last 90 Days", "Weekday", "Weekend", "Proposed", "Accepted", "Confirmed", "Declined", "Acceptance Rate", "Confirmation Rate", "Average Response", "Assignment Changes", "Max Daily Load", "Daily Limit", "Positions", "Levels", "Most Recent", "Longest Gap Days", ...(premium ? ["Miles", "Average Miles", "Compensation"] : [])],
      body = rows.map((row) => [
        `${row.official.first_name} ${row.official.last_name}`, row.official.active ? "Yes" : "No", row.total, row.past7, row.past30, row.past90, row.weekday, row.weekend, row.proposed, row.accepted, row.confirmed, row.declined, percent(row.acceptanceRate), percent(row.confirmationRate), hours(row.responseHours), row.replacements, row.maxDaily, row.official.max_games_per_day ?? "", row.positions.join("; "), row.levels.join("; "), row.latest?.toLocaleDateString() || "", row.longestGap, ...(premium ? [row.miles.toFixed(1), row.total ? (row.miles / row.total).toFixed(1) : "0.0", row.compensation.toFixed(2)] : []),
      ].map(quote).join(",")),
      blob = new Blob([[headings.map(quote).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }),
      url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "refassign-official-utilization.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!premium) return;
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]),
      document = new jsPDF({ orientation: "landscape" });
    document.setTextColor(12, 30, 55);
    document.setFontSize(18);
    document.text("RefAssign Official Utilization Report", 14, 16);
    document.setFontSize(9);
    document.setTextColor(100, 116, 139);
    document.text(`${periodLabel()} • ${organization === "all" ? "All organizations" : organization}`, 14, 23);
    document.setTextColor(15, 23, 42);
    document.text(`Officials: ${rows.length}    Assignments: ${totals.assignments}    No recent assignments: ${totals.quietOfficials}    High workload: ${totals.highOfficials}    Miles: ${totals.miles.toFixed(1)}    Compensation: ${money(totals.compensation)}`, 14, 31);
    autoTable(document, {
      startY: 38,
      head: [["Official", "Assignments", "7 / 30 / 90 days", "Acceptance", "Avg response", "Changes", "Max/day", "Latest", "Miles", "Compensation"]],
      body: rows.map((row) => [`${row.official.first_name} ${row.official.last_name}`, row.total, `${row.past7} / ${row.past30} / ${row.past90}`, percent(row.acceptanceRate), hours(row.responseHours), row.replacements, `${row.maxDaily} / ${row.official.max_games_per_day ?? "—"}`, row.latest?.toLocaleDateString() || "None", row.miles.toFixed(1), money(row.compensation)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    document.save("refassign-official-utilization.pdf");
  };

  if (loading) return <section className="card"><p>Loading official utilization…</p></section>;
  return (
    <section className="card officialReports utilizationReport">
      <div className="cardHead">
        <div>
          <h2>Official Utilization &amp; Assignment Distribution</h2>
          <p>Compare workload, response reliability, travel, and compensation across your officiating roster.</p>
        </div>
        <div className="headerActions">
          {premium && <span className="badge">Premium reporting</span>}
          <button className="secondary" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>
          {premium && <button className="secondary" disabled={!rows.length} onClick={exportPdf}>Export PDF</button>}
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {!error && <>
        <div className="reportFilters operationsFilters">
          <label>Reporting period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="season">Current season</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom dates</option><option value="all">All assignments</option></select></label>
          {period === "custom" && <><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></>}
          <label>Paying organization<select value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="all">All organizations</option>{options.organizations.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">All levels</option>{options.levels.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="all">All positions</option>{options.positions.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Location<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">All locations</option>{options.locations.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>Roster alert<select value={alert} onChange={(event) => setAlert(event.target.value as AlertFilter)}><option value="all">All officials</option><option value="quiet">No recent assignments</option><option value="high">High workload</option><option value="unanswered">Unanswered offers</option></select></label>
          <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="assignments">Most assignments</option><option value="name">Official name</option><option value="recent">Most recent game</option><option value="acceptance">Acceptance rate</option>{premium && <option value="miles">Most miles</option>}{premium && <option value="compensation">Highest compensation</option>}</select></label>
        </div>

        {premium && <div className="utilizationThresholds"><b>Workload alerts</b><label>No assignment after <input type="number" min="1" max="365" value={quietDays} onChange={(event) => setQuietDays(Math.max(1, Number(event.target.value) || 1))} /> days</label><label>High weekly workload <input type="number" min="1" max="50" value={weeklyLimit} onChange={(event) => setWeeklyLimit(Math.max(1, Number(event.target.value) || 1))} /> games</label></div>}

        <div className="reportMetrics operationsMetrics utilizationMetrics">
          <div><span>Officials shown</span><b>{rows.length}</b></div><div><span>Assignments</span><b>{totals.assignments}</b></div><div><span>Active officials</span><b>{totals.activeOfficials}</b></div><div><span>No recent assignments</span><b>{totals.quietOfficials}</b></div><div><span>High workload</span><b>{totals.highOfficials}</b></div><div><span>Unanswered offers</span><b>{totals.unanswered}</b></div>{premium && <div className="premiumMetric"><span>Total miles</span><b>{totals.miles.toFixed(1)}</b></div>}{premium && <div className="premiumMetric"><span>Compensation</span><b>{money(totals.compensation)}</b></div>}
        </div>

        {!premium && <div className="reportPremiumNotice"><b>Standard reporting</b><span>Travel and compensation totals, trend graphics, adjustable workload alerts, and PDF export are available when Premium Reporting is enabled for this account.</span></div>}

        {premium && <div className="reportCharts utilizationCharts">
          <article className="reportChart"><h4>Assignment distribution</h4><div className="reportBars">{distribution.map(([label, value]) => <div className="reportBarRow" key={label}><span>{label}</span><i><em style={{ width: `${value / Math.max(1, ...distribution.map((item) => item[1])) * 100}%` }} /></i><b>{value}</b></div>)}</div></article>
          <article className="reportChart"><h4>Six-month assignment trend</h4><div className="reportBars">{trend.map((item) => <div className="reportBarRow" key={item.label}><span>{item.label}</span><i><em style={{ width: `${item.count / Math.max(1, ...trend.map((month) => month.count)) * 100}%` }} /></i><b>{item.count}</b></div>)}</div></article>
        </div>}

        <div className="utilizationLegend"><span><i className="quiet" /> No assignment in {quietDays}+ days</span><span><i className="high" /> High weekly or daily workload</span></div>
        <div className="tableWrap">
          <table className="officialReportTable utilizationTable"><thead><tr><th>Official</th><th>Alerts</th><th>Assignments</th><th>7 / 30 / 90 days</th><th>Weekday / Weekend</th><th>Offer status</th><th>Acceptance / Confirmation</th><th>Avg. response</th><th>Changes</th><th>Max / day</th><th>Positions / Levels</th><th>Most recent</th><th>Longest gap</th>{premium && <><th>Miles</th><th>Avg. travel</th><th>Compensation</th></>}</tr></thead><tbody>
            {rows.map((row) => <tr key={row.official.id}><td><b>{row.official.first_name} {row.official.last_name}</b><small>{row.official.active ? "Active" : "Inactive"}</small></td><td><div className="utilizationAlerts">{row.quiet && <span className="quiet">No recent</span>}{row.high && <span className="high">High load</span>}{row.proposed > 0 && <span>Unanswered</span>}{!row.quiet && !row.high && !row.proposed && <span className="clear">Clear</span>}</div></td><td>{row.total}</td><td>{row.past7} / {row.past30} / {row.past90}</td><td>{row.weekday} / {row.weekend}</td><td><small>Proposed {row.proposed}</small><small>Accepted {row.accepted}</small><small>Confirmed {row.confirmed}</small><small>Declined {row.declined}</small></td><td>{percent(row.acceptanceRate)} / {percent(row.confirmationRate)}</td><td>{hours(row.responseHours)}</td><td>{row.replacements}</td><td>{row.maxDaily} / {row.official.max_games_per_day ?? "—"}</td><td><small>{row.positions.join(", ") || "No positions"}</small><small>{row.levels.join(", ") || "No levels"}</small></td><td>{row.latest?.toLocaleDateString() || "None"}</td><td>{row.longestGap ? `${row.longestGap} days` : "—"}</td>{premium && <><td>{row.miles.toFixed(1)}</td><td>{row.total ? `${(row.miles / row.total).toFixed(1)} mi` : "—"}</td><td>{money(row.compensation)}</td></>}</tr>)}
            {!rows.length && <tr><td colSpan={premium ? 16 : 13}>No officials match these filters.</td></tr>}
          </tbody></table>
        </div>
      </>}
    </section>
  );
}
