"use client";

import { useEffect, useMemo, useState } from "react";

type Named = { id?: string; name: string } | null;
type Game = {
  id: string;
  game_number: string | null;
  status: string;
  sport_id: string;
  league_id: string | null;
  level_id: string | null;
  location_id: string | null;
  starts_at: string;
  duration_minutes: number;
  officials_needed: number;
  sports: Named;
  leagues: (NonNullable<Named> & { assignment_fill_target_days: number | null }) | null;
  levels: Named;
  home: Named;
  away: Named;
  location: (NonNullable<Named> & { city: string | null; state: string | null; latitude: number | null; longitude: number | null }) | null;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string;
  position_id: string;
  status: string;
  published_at: string | null;
  accept_by: string | null;
  responded_at: string | null;
  games: { starts_at: string; duration_minutes: number } | null;
};
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  sports: string[];
  active: boolean;
  max_games_per_day: number | null;
  home_latitude: number | null;
  home_longitude: number | null;
};
type Position = { id: string; sport_id: string; name: string; sort_order: number; required: boolean };
type Eligibility = { official_id: string; league_id?: string; level_id?: string };
type Block = { official_id: string; block_type: string; start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; location_id: string | null; team_id: string | null };
type Horizon = "7" | "14" | "30" | "60" | "all";
type RiskFilter = "all" | "critical" | "high" | "shortage" | "deadline";
type Candidate = { official: Official; acceptance: number; distance: number | null; weekLoad: number; score: number };
type Forecast = {
  game: Game;
  slots: Position[];
  assignments: Assignment[];
  filled: number;
  confirmed: number;
  proposed: number;
  open: number;
  openPositions: string[];
  candidates: Candidate[];
  available: number;
  acceptance: number;
  expectedShortage: number;
  risk: number;
  riskLabel: "Low" | "Moderate" | "High" | "Critical";
  deadlinePassed: boolean;
  daysAway: number;
  averageTravel: number | null;
};

const inactiveAssignments = new Set(["declined", "cancelled", "canceled"]);
const inactiveGames = new Set([
  "cancelled",
  "canceled",
  "rained_out",
  "suspended",
  "on_hold",
]);
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const pct = (value: number) => `${Math.round(value * 100)}%`;
const localDay = (value: string | Date) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
};
const overlaps = (startA: string, minutesA: number, startB: string, minutesB: number) => {
  const a = new Date(startA).getTime(), b = new Date(startB).getTime();
  return a < b + minutesB * 60000 && b < a + minutesA * 60000;
};
const distance = (a: number | null, b: number | null, c: number | null, d: number | null) => {
  if ([a, b, c, d].some((value) => value == null)) return null;
  const radius = 3958.7613, p = Math.PI / 180, dlat = (c! - a!) * p, dlon = (d! - b!) * p,
    q = Math.sin(dlat / 2) ** 2 + Math.cos(a! * p) * Math.cos(c! * p) * Math.sin(dlon / 2) ** 2;
  return radius * 2 * Math.asin(Math.sqrt(q));
};

export default function StaffingForecastReport({ organizationId }: { organizationId?: string }) {
  const [games, setGames] = useState<Game[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [officials, setOfficials] = useState<Official[]>([]),
    [positions, setPositions] = useState<Position[]>([]),
    [leagueEligibility, setLeagueEligibility] = useState<Eligibility[]>([]),
    [levelEligibility, setLevelEligibility] = useState<Eligibility[]>([]),
    [blocks, setBlocks] = useState<Block[]>([]),
    [reportingAccess, setReportingAccess] = useState<"standard" | "premium">("standard"),
    [horizon, setHorizon] = useState<Horizon>("30"),
    [organization, setOrganization] = useState("all"),
    [level, setLevel] = useState("all"),
    [location, setLocation] = useState("all"),
    [riskFilter, setRiskFilter] = useState<RiskFilter>("all"),
    [minimumCandidates, setMinimumCandidates] = useState(3),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/reports/forecast?organizationId=${encodeURIComponent(organizationId || "")}`, { cache: "no-store" }), result = await response.json();
        if (!response.ok) throw new Error(result.error || "Staffing forecast could not be loaded.");
        setGames(result.games || []);
        setAssignments(result.assignments || []);
        setOfficials(result.officials || []);
        setPositions(result.positions || []);
        setLeagueEligibility(result.leagueEligibility || []);
        setLevelEligibility(result.levelEligibility || []);
        setBlocks(result.blocks || []);
        setReportingAccess(result.reportingAccess === "premium" ? "premium" : "standard");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Staffing forecast could not be loaded.");
      }
      setLoading(false);
    })();
  }, []);

  const premium = reportingAccess === "premium", now = useMemo(() => new Date(), []);
  const options = useMemo(() => {
    const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
    return { organizations: unique(games.map((game) => game.leagues?.name)), levels: unique(games.map((game) => game.levels?.name)), locations: unique(games.map((game) => game.location?.name)) };
  }, [games]);

  const acceptanceByOfficial = useMemo(() => {
    const values = new Map<string, { offered: number; accepted: number }>();
    assignments.forEach((item) => {
      if (!item.published_at || !item.games || new Date(item.games.starts_at) >= now) return;
      const row = values.get(item.official_id) || { offered: 0, accepted: 0 };
      row.offered += 1;
      if (["accepted", "confirmed"].includes(item.status)) row.accepted += 1;
      values.set(item.official_id, row);
    });
    return values;
  }, [assignments, now]);

  const forecast = useMemo(() => {
    const activeAssignments = assignments.filter((item) => !inactiveAssignments.has(item.status));
    const qualifiedFor = (official: Official, game: Game) => {
      if (!official.sports.some((sport) => sport.toLowerCase() === game.sports?.name.toLowerCase())) return false;
      const leagues = leagueEligibility.filter((item) => item.official_id === official.id);
      if (game.league_id && leagues.length && !leagues.some((item) => item.league_id === game.league_id)) return false;
      const levels = levelEligibility.filter((item) => item.official_id === official.id);
      return !(game.level_id && levels.length && !levels.some((item) => item.level_id === game.level_id));
    };
    const blockedFor = (official: Official, game: Game) => {
      const start = new Date(game.starts_at).getTime(), end = start + (game.duration_minutes || 110) * 60000, day = localDay(game.starts_at);
      return blocks.some((block) => {
        if (block.official_id !== official.id) return false;
        if (block.starts_at && block.ends_at && new Date(block.starts_at).getTime() < end && new Date(block.ends_at).getTime() > start) return true;
        if (block.block_type === "date" && block.start_date && block.end_date && day >= block.start_date && day <= block.end_date) return true;
        if (block.block_type === "location" && block.location_id === game.location_id) return true;
        return block.block_type === "team" && Boolean(block.team_id) && [game.home?.id, game.away?.id].includes(block.team_id || undefined);
      });
    };
    const results = games
      .filter((game) => {
        if (inactiveGames.has(game.status)) return false;
        const days = (new Date(game.starts_at).getTime() - now.getTime()) / 86400000;
        if (horizon !== "all" && days > Number(horizon)) return false;
        return (organization === "all" || game.leagues?.name === organization) && (level === "all" || game.levels?.name === level) && (location === "all" || game.location?.name === location);
      })
      .map((game): Forecast => {
        const slots = positions.filter((item) => item.sport_id === game.sport_id).sort((a, b) => a.sort_order - b.sort_order).slice(0, Math.max(0, game.officials_needed)),
          gameAssignments = activeAssignments.filter((item) => item.game_id === game.id && slots.some((slot) => slot.id === item.position_id)),
          filledPositions = new Set(gameAssignments.map((item) => item.position_id)),
          openPositions = slots.filter((slot) => !filledPositions.has(slot.id)).map((slot) => slot.name),
          day = localDay(game.starts_at), weekStart = new Date(game.starts_at);
        weekStart.setDate(weekStart.getDate() - 7);
        const candidates = officials.filter((official) => {
          if (!qualifiedFor(official, game) || blockedFor(official, game) || gameAssignments.some((item) => item.official_id === official.id)) return false;
          const scheduled = activeAssignments.filter((item) => item.official_id === official.id && item.games);
          if (scheduled.some((item) => overlaps(game.starts_at, game.duration_minutes || 110, item.games!.starts_at, item.games!.duration_minutes || 110))) return false;
          return scheduled.filter((item) => localDay(item.games!.starts_at) === day).length < Number(official.max_games_per_day || 2);
        }).map((official) => {
          const history = acceptanceByOfficial.get(official.id), acceptance = history?.offered ? history.accepted / history.offered : 0.7,
            travel = distance(official.home_latitude, official.home_longitude, game.location?.latitude ?? null, game.location?.longitude ?? null),
            weekLoad = activeAssignments.filter((item) => item.official_id === official.id && item.games && new Date(item.games.starts_at) >= weekStart && new Date(item.games.starts_at) <= new Date(game.starts_at)).length,
            score = acceptance * 60 + Math.max(0, 25 - (travel ?? 25) / 4) + Math.max(0, 15 - weekLoad * 3);
          return { official, acceptance, distance: travel, weekLoad, score };
        }).sort((a, b) => b.score - a.score);
        const open = Math.max(0, slots.length - filledPositions.size), proposed = gameAssignments.filter((item) => item.status === "proposed").length,
          confirmed = gameAssignments.filter((item) => ["accepted", "confirmed"].includes(item.status)).length,
          avgAcceptance = candidates.length ? candidates.reduce((sum, item) => sum + item.acceptance, 0) / candidates.length : 0,
          daysAway = Math.max(0, Math.ceil((new Date(game.starts_at).getTime() - now.getTime()) / 86400000)),
          fillDays = Number(game.leagues?.assignment_fill_target_days || 7), deadlinePassed = open > 0 && daysAway <= fillDays,
          overdue = gameAssignments.some((item) => item.status === "proposed" && item.accept_by && new Date(item.accept_by) < now),
          candidatePressure = open > 0 && candidates.length < Math.max(open, minimumCandidates),
          risk = Math.min(100, Math.round((open / Math.max(1, slots.length)) * 45 + (deadlinePassed ? 20 : 0) + (daysAway <= 3 && open ? 10 : 0) + (overdue ? 20 : 0) + (candidatePressure ? 15 : 0) + (open && avgAcceptance < 0.6 ? 10 : 0))),
          riskLabel = risk >= 75 ? "Critical" : risk >= 50 ? "High" : risk >= 25 ? "Moderate" : "Low",
          travelValues = candidates.map((item) => item.distance).filter((value): value is number => value !== null);
        return { game, slots, assignments: gameAssignments, filled: filledPositions.size, confirmed, proposed, open, openPositions, candidates, available: candidates.length, acceptance: avgAcceptance, expectedShortage: Math.max(0, open - Math.floor(candidates.length * avgAcceptance)), risk, riskLabel, deadlinePassed, daysAway, averageTravel: travelValues.length ? travelValues.reduce((sum, value) => sum + value, 0) / travelValues.length : null };
      });
    return results.filter((row) => riskFilter === "all" || (riskFilter === "critical" && row.riskLabel === "Critical") || (riskFilter === "high" && ["High", "Critical"].includes(row.riskLabel)) || (riskFilter === "shortage" && row.open > 0) || (riskFilter === "deadline" && row.deadlinePassed)).sort((a, b) => premium ? b.risk - a.risk || new Date(a.game.starts_at).getTime() - new Date(b.game.starts_at).getTime() : new Date(a.game.starts_at).getTime() - new Date(b.game.starts_at).getTime());
  }, [games, assignments, officials, positions, leagueEligibility, levelEligibility, blocks, acceptanceByOfficial, horizon, organization, level, location, riskFilter, minimumCandidates, now, premium]);

  const totals = useMemo(() => ({ games: forecast.length, positions: forecast.reduce((sum, row) => sum + row.slots.length, 0), filled: forecast.reduce((sum, row) => sum + row.filled, 0), open: forecast.reduce((sum, row) => sum + row.open, 0), highRisk: forecast.filter((row) => ["High", "Critical"].includes(row.riskLabel)).length, deadlines: forecast.filter((row) => row.deadlinePassed).length, expected: forecast.reduce((sum, row) => sum + row.expectedShortage, 0) }), [forecast]);
  const riskGroups = useMemo(() => ["Critical", "High", "Moderate", "Low"].map((label) => [label, forecast.filter((row) => row.riskLabel === label).length] as const), [forecast]);
  const organizations = useMemo(() => {
    const values = new Map<string, { games: number; open: number; risk: number }>();
    forecast.forEach((row) => { const label = row.game.leagues?.name || "Not specified", value = values.get(label) || { games: 0, open: 0, risk: 0 }; value.games += 1; value.open += row.open; value.risk += row.risk; values.set(label, value); });
    return [...values.entries()].sort((a, b) => b[1].open - a[1].open);
  }, [forecast]);
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const exportCsv = () => {
    const headings = ["Date", "Game", "Paying Organization", "Level", "Location", "Status", "Positions", "Filled", "Confirmed", "Open", "Open Positions", "Available Officials", "Staffing Deadline", ...(premium ? ["Risk Score", "Risk", "Expected Shortage", "Average Candidate Acceptance", "Average Candidate Travel", "Suggested Officials"] : [])],
      body = forecast.map((row) => [new Date(row.game.starts_at).toLocaleString(), row.game.game_number, row.game.leagues?.name, row.game.levels?.name, row.game.location?.name, titleCase(row.game.status), row.slots.length, row.filled, row.confirmed, row.open, row.openPositions.join("; "), row.available, row.deadlinePassed ? "Passed" : "On track", ...(premium ? [row.risk, row.riskLabel, row.expectedShortage, pct(row.acceptance), row.averageTravel?.toFixed(1) || "", row.candidates.slice(0, 3).map((item) => `${item.official.first_name} ${item.official.last_name}`).join("; ")] : [])].map(quote).join(",")),
      blob = new Blob([[headings.map(quote).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "refassign-staffing-forecast.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!premium) return;
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]), document = new jsPDF({ orientation: "landscape" });
    document.setTextColor(12, 30, 55); document.setFontSize(18); document.text("RefAssign Staffing Forecast & Coverage Risk", 14, 16);
    document.setFontSize(9); document.setTextColor(100, 116, 139); document.text(`${horizon === "all" ? "All upcoming games" : `Next ${horizon} days`} • ${organization === "all" ? "All organizations" : organization}`, 14, 23);
    document.setTextColor(15, 23, 42); document.text(`Games: ${totals.games}    Coverage: ${totals.positions ? pct(totals.filled / totals.positions) : "—"}    Open positions: ${totals.open}    High-risk games: ${totals.highRisk}    Expected shortage: ${totals.expected}`, 14, 31);
    autoTable(document, { startY: 38, head: [["Date", "Game", "Organization / Level", "Coverage", "Available", "Deadline", "Risk", "Expected", "Suggested officials"]], body: forecast.map((row) => [new Date(row.game.starts_at).toLocaleDateString(), row.game.game_number || "—", `${row.game.leagues?.name || "—"} / ${row.game.levels?.name || "—"}`, `${row.filled}/${row.slots.length}`, row.available, row.deadlinePassed ? "Passed" : "On track", `${row.risk} ${row.riskLabel}`, row.expectedShortage, row.candidates.slice(0, 3).map((item) => `${item.official.first_name} ${item.official.last_name}`).join(", ") || "None"]), styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] } });
    document.save("refassign-staffing-forecast.pdf");
  };

  if (loading) return <section className="card"><p>Loading staffing forecast…</p></section>;
  return <section className="card officialReports staffingForecastReport">
    <div className="cardHead"><div><h2>Staffing Forecast &amp; Coverage Risk</h2><p>Find upcoming coverage shortages and response risks before they become game-day problems.</p></div><div className="headerActions">{premium && <span className="badge">Premium reporting</span>}<button className="secondary" disabled={!forecast.length} onClick={exportCsv}>Export CSV</button>{premium && <button className="secondary" disabled={!forecast.length} onClick={exportPdf}>Export PDF</button>}</div></div>
    {error && <div className="errorBox">{error}</div>}
    {!error && <>
      <div className="reportFilters operationsFilters"><label>Forecast window<select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}><option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="all">All upcoming games</option></select></label><label>Paying organization<select value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="all">All organizations</option>{options.organizations.map((name) => <option key={name}>{name}</option>)}</select></label><label>Level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">All levels</option>{options.levels.map((name) => <option key={name}>{name}</option>)}</select></label><label>Location<select value={location} onChange={(event) => setLocation(event.target.value)}><option value="all">All locations</option>{options.locations.map((name) => <option key={name}>{name}</option>)}</select></label><label>Attention needed<select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}><option value="all">All upcoming games</option>{premium && <option value="critical">Critical risk</option>}{premium && <option value="high">High or critical risk</option>}<option value="shortage">Open positions</option><option value="deadline">Staffing deadline passed</option></select></label></div>
      {premium && <div className="utilizationThresholds"><b>Forecast alerts</b><label>Warn below <input type="number" min="1" max="25" value={minimumCandidates} onChange={(event) => setMinimumCandidates(Math.max(1, Number(event.target.value) || 1))} /> qualified officials</label><span>Risk scores update immediately.</span></div>}
      <div className="reportMetrics operationsMetrics"><div><span>Upcoming games</span><b>{totals.games}</b></div><div><span>Coverage rate</span><b>{totals.positions ? pct(totals.filled / totals.positions) : "—"}</b></div><div><span>Open positions</span><b>{totals.open}</b></div><div><span>Deadline passed</span><b>{totals.deadlines}</b></div>{premium && <div className="premiumMetric"><span>High-risk games</span><b>{totals.highRisk}</b></div>}{premium && <div className="premiumMetric"><span>Expected shortage</span><b>{totals.expected}</b></div>}</div>
      {!premium && <div className="reportPremiumNotice"><b>Standard reporting</b><span>Risk scoring, predicted shortages, suggested officials, travel impact, adjustable alerts, graphics, and PDF export are available with Premium Reporting.</span></div>}
      {premium && <div className="reportCharts"><article className="reportChart"><h4>Games by risk level</h4><div className="reportBars">{riskGroups.map(([label, value]) => <div className={`reportBarRow forecastBar ${label.toLowerCase()}`} key={label}><span>{label}</span><i><em style={{ width: `${value / Math.max(1, ...riskGroups.map((item) => item[1])) * 100}%` }} /></i><b>{value}</b></div>)}</div></article><article className="reportChart"><h4>Open positions by organization</h4><div className="reportBars">{organizations.map(([label, value]) => <div className="reportBarRow" key={label}><span title={label}>{label}</span><i><em style={{ width: `${value.open / Math.max(1, ...organizations.map((item) => item[1].open)) * 100}%` }} /></i><b>{value.open}</b></div>)}{!organizations.length && <p>No games in this forecast.</p>}</div></article></div>}
      <div className="tableWrap"><table className="officialReportTable forecastTable"><thead><tr><th>Date / Game</th><th>Organization / Level</th><th>Location</th><th>Coverage</th><th>Open positions</th><th>Available officials</th><th>Response status</th><th>Staffing deadline</th>{premium && <><th>Coverage risk</th><th>Expected shortage</th><th>Travel impact</th><th>Suggested officials</th></>}</tr></thead><tbody>{forecast.map((row) => <tr key={row.game.id}><td><b>{new Date(row.game.starts_at).toLocaleDateString()}</b><small>{new Date(row.game.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} • Game #{row.game.game_number || "—"}</small><small>{row.game.home?.name || "TBD"} vs {row.game.away?.name || "TBD"}</small></td><td>{row.game.leagues?.name || "—"}<small>{row.game.levels?.name || "—"}</small></td><td>{row.game.location?.name || "—"}<small>{[row.game.location?.city, row.game.location?.state].filter(Boolean).join(", ")}</small></td><td><b>{row.filled}/{row.slots.length}</b><small>{row.confirmed} accepted or confirmed</small></td><td>{row.open || "—"}<small>{row.openPositions.join(", ") || "Fully staffed"}</small></td><td><b>{row.available}</b><small>{row.available < Math.max(row.open, minimumCandidates) ? "Limited pool" : "Adequate pool"}</small></td><td>{row.proposed ? `${row.proposed} awaiting` : "No pending offers"}</td><td><span className={`forecastStatus ${row.deadlinePassed ? "late" : "onTrack"}`}>{row.deadlinePassed ? "Past target" : "On track"}</span><small>{row.daysAway} days until game</small></td>{premium && <><td><span className={`forecastRisk ${row.riskLabel.toLowerCase()}`}>{row.risk} • {row.riskLabel}</span></td><td>{row.expectedShortage}</td><td>{row.averageTravel === null ? "Unavailable" : `${row.averageTravel.toFixed(1)} mi avg.`}</td><td>{row.candidates.slice(0, 3).map((item) => <small key={item.official.id}><b>{item.official.first_name} {item.official.last_name}</b> • {pct(item.acceptance)}{item.distance === null ? "" : ` • ${item.distance.toFixed(0)} mi`}</small>)}{!row.candidates.length && <small>No available match</small>}</td></>}</tr>)}{!forecast.length && <tr><td colSpan={premium ? 12 : 8}>No upcoming games match these filters.</td></tr>}</tbody></table></div>
      <p className="reportFootnote">Availability estimates use active officials, sport and league/level eligibility, blocks, schedule conflicts, and daily workload limits. Premium risk scores also consider staffing deadlines, response deadlines, candidate depth, and historical acceptance.</p>
    </>}
  </section>;
}
