"use client";

import { addReportCopyright } from "../lib/pdfCopyright";

import { useEffect, useMemo, useState } from "react";

type Named = { name: string } | null;
type Organization = { id: string; name: string } | null;
type Game = {
  id: string;
  game_number: string | null;
  status: string;
  starts_at: string;
  officials_needed: number;
  leagues: Organization;
  levels: Named;
  location: Named;
  home: Named;
  away: Named;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string;
  status: string;
  game_fee: number | null;
  mileage_miles: number | null;
  mileage_rate: number | null;
  payment_status: "unpaid" | "approved" | "paid" | "void";
  paid_at: string | null;
  officials: { id: string; first_name: string; last_name: string } | null;
  sport_positions: Named;
  games: Game;
};
type Period = "30" | "90" | "year" | "season" | "custom" | "all";
type Horizon = "30" | "60" | "90" | "season" | "all";
type Assumption = { fee: number; mileage: number; budget: number };
type Projection = { game: Game; assigned: number; open: number; committed: number; estimated: number; total: number; exception: string };

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const assignmentFee = (row: Assignment) => row.payment_status === "void" ? 0 : Number(row.game_fee || 0);
const mileagePay = (row: Assignment) => row.payment_status === "void" ? 0 : Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0);
const totalCost = (row: Assignment) => assignmentFee(row) + mileagePay(row);
const officialName = (row: Assignment) => `${row.officials?.first_name || ""} ${row.officials?.last_name || ""}`.trim() || "Unknown official";
const activeGame = (status: string) => !["cancelled", "canceled", "rained_out", "suspended", "on_hold"].includes(status);
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function FinancialForecastReport({ organizationId }: { organizationId?: string }) {
  const [actual, setActual] = useState<Assignment[]>([]),
    [forecastAssignments, setForecastAssignments] = useState<Assignment[]>([]),
    [futureGames, setFutureGames] = useState<Game[]>([]),
    [reportingAccess, setReportingAccess] = useState<"standard" | "premium">("standard"),
    [period, setPeriod] = useState<Period>("season"),
    [horizon, setHorizon] = useState<Horizon>("90"),
    [organization, setOrganization] = useState("all"),
    [level, setLevel] = useState("all"),
    [paymentStatus, setPaymentStatus] = useState("all"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [warningPercent, setWarningPercent] = useState(90),
    [assumptions, setAssumptions] = useState<Record<string, Assumption>>({}),
    [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/reports/financial-forecast?organizationId=${encodeURIComponent(organizationId || "")}`, { cache: "no-store" }), result = await response.json();
        if (!response.ok) throw new Error(result.error || "Financial forecasting could not be loaded.");
        setActual(result.actualAssignments || []);
        setForecastAssignments(result.forecastAssignments || []);
        setFutureGames(result.futureGames || []);
        setReportingAccess(result.reportingAccess === "premium" ? "premium" : "standard");
        try {
          const stored = window.localStorage.getItem("refassign-financial-planning");
          if (stored) {
            const parsed = JSON.parse(stored);
            setAssumptions(parsed.assumptions || {});
            setWarningPercent(Number(parsed.warningPercent || 90));
          }
        } catch {}
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Financial forecasting could not be loaded.");
      }
      setLoading(false);
    })();
  }, []);
  const premium = reportingAccess === "premium", now = useMemo(() => new Date(), []);
  const organizations = useMemo(() => {
    const values = new Map<string, string>();
    [...actual.map((row) => row.games), ...futureGames].forEach((game) => { if (game?.leagues?.id) values.set(game.leagues.id, game.leagues.name); });
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [actual, futureGames]);
  const levels = useMemo(() => [...new Set([...actual.map((row) => row.games?.levels?.name), ...futureGames.map((game) => game.levels?.name)].filter(Boolean) as string[])].sort(), [actual, futureGames]);

  const visibleActual = useMemo(() => {
    const cutoff = new Date(now);
    if (period === "30") cutoff.setDate(cutoff.getDate() - 30);
    if (period === "90") cutoff.setDate(cutoff.getDate() - 90);
    if (period === "year") cutoff.setFullYear(cutoff.getFullYear() - 1);
    return actual.filter((row) => {
      const date = new Date(row.games.starts_at);
      if (organization !== "all" && row.games.leagues?.id !== organization) return false;
      if (level !== "all" && row.games.levels?.name !== level) return false;
      if (paymentStatus !== "all" && row.payment_status !== paymentStatus) return false;
      if (period === "custom") return (!startDate || date >= new Date(`${startDate}T00:00:00`)) && (!endDate || date <= new Date(`${endDate}T23:59:59`));
      if (period === "season") return date.getFullYear() === now.getFullYear();
      return period === "all" || date >= cutoff;
    });
  }, [actual, organization, level, paymentStatus, period, startDate, endDate, now]);

  const historicalRates = useMemo(() => {
    const rates = new Map<string, { count: number; fee: number; mileage: number }>();
    actual.filter((row) => row.payment_status !== "void").forEach((row) => {
      const organizationId = row.games.leagues?.id || "none", levelName = row.games.levels?.name || "none", keys = [`${organizationId}:${levelName}`, `${organizationId}:all`, "all:all"];
      keys.forEach((key) => { const value = rates.get(key) || { count: 0, fee: 0, mileage: 0 }; value.count += 1; value.fee += assignmentFee(row); value.mileage += mileagePay(row); rates.set(key, value); });
    });
    return rates;
  }, [actual]);
  const assumedRate = (game: Game) => {
    const organizationId = game.leagues?.id || "none", configured = assumptions[organizationId], specific = historicalRates.get(`${organizationId}:${game.levels?.name || "none"}`), organizationRate = historicalRates.get(`${organizationId}:all`), global = historicalRates.get("all:all"), base = specific?.count ? specific : organizationRate?.count ? organizationRate : global;
    return { fee: configured?.fee || (base?.count ? base.fee / base.count : 0), mileage: configured?.mileage || (base?.count ? base.mileage / base.count : 0) };
  };

  const projections = useMemo(() => {
    const cutoff = new Date(now);
    if (horizon !== "all" && horizon !== "season") cutoff.setDate(cutoff.getDate() + Number(horizon));
    if (horizon === "season") cutoff.setFullYear(now.getFullYear(), 11, 31);
    const rows = futureGames.filter((game) => activeGame(game.status) && (horizon === "all" || new Date(game.starts_at) <= cutoff) && (organization === "all" || game.leagues?.id === organization) && (level === "all" || game.levels?.name === level)).map((game): Projection => {
      const assignments = forecastAssignments.filter((row) => row.game_id === game.id), assigned = Math.min(game.officials_needed, new Set(assignments.map((row) => row.official_id)).size), open = Math.max(0, game.officials_needed - assigned), rate = assumedRate(game), fallback = rate.fee + rate.mileage,
        committed = assignments.slice(0, game.officials_needed).reduce((sum, row) => { const direct = totalCost(row); return sum + (direct > 0 ? direct : fallback); }, 0), estimated = open * fallback, total = committed + estimated;
      return { game, assigned, open, committed, estimated, total, exception: !fallback ? "Planning rate needed" : "" };
    });
    const average = rows.length ? rows.reduce((sum, row) => sum + row.total, 0) / rows.length : 0;
    return rows.map((row) => ({ ...row, exception: row.exception || (average > 0 && row.total > average * 1.5 ? "Above forecast average" : "") })).sort((a, b) => new Date(a.game.starts_at).getTime() - new Date(b.game.starts_at).getTime());
  }, [futureGames, forecastAssignments, assumptions, historicalRates, horizon, organization, level, now]);

  const actualTotals = useMemo(() => visibleActual.reduce((sum, row) => { const fee = assignmentFee(row), mileage = mileagePay(row), total = fee + mileage; sum.fees += fee; sum.mileage += mileage; sum.total += total; if (row.payment_status === "paid") sum.paid += total; if (["unpaid", "approved"].includes(row.payment_status)) sum.outstanding += total; return sum; }, { fees: 0, mileage: 0, total: 0, paid: 0, outstanding: 0 }), [visibleActual]);
  const projectedTotal = projections.reduce((sum, row) => sum + row.total, 0);
  const summaries = useMemo(() => organizations.filter(([id]) => organization === "all" || id === organization).map(([id, name]) => {
    const rows = visibleActual.filter((row) => row.games.leagues?.id === id), forecast = projections.filter((row) => row.game.leagues?.id === id), actualCost = rows.reduce((sum, row) => sum + totalCost(row), 0), projected = forecast.reduce((sum, row) => sum + row.total, 0), budget = assumptions[id]?.budget || 0, combined = actualCost + projected, used = budget ? combined / budget : 0;
    return { id, name, assignments: rows.length, actual: actualCost, paid: rows.filter((row) => row.payment_status === "paid").reduce((sum, row) => sum + totalCost(row), 0), outstanding: rows.filter((row) => ["unpaid", "approved"].includes(row.payment_status)).reduce((sum, row) => sum + totalCost(row), 0), games: forecast.length, projected, budget, combined, used };
  }), [organizations, visibleActual, projections, assumptions, organization]);
  const months = useMemo(() => Array.from({ length: 6 }, (_, offset) => { const month = new Date(now.getFullYear(), now.getMonth() + offset, 1), next = new Date(month.getFullYear(), month.getMonth() + 1, 1); return { label: month.toLocaleDateString("en-US", { month: "short" }), actual: visibleActual.filter((row) => new Date(row.games.starts_at) >= month && new Date(row.games.starts_at) < next).reduce((sum, row) => sum + totalCost(row), 0), projected: projections.filter((row) => new Date(row.game.starts_at) >= month && new Date(row.game.starts_at) < next).reduce((sum, row) => sum + row.total, 0) }; }), [visibleActual, projections, now]);
  const setAssumption = (id: string, field: keyof Assumption, value: number) => { setSaved(false); setAssumptions((current) => ({ ...current, [id]: { fee: current[id]?.fee || 0, mileage: current[id]?.mileage || 0, budget: current[id]?.budget || 0, [field]: Math.max(0, value || 0) } })); };
  const savePlanning = () => { window.localStorage.setItem("refassign-financial-planning", JSON.stringify({ assumptions, warningPercent })); setSaved(true); };
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const exportCsv = () => {
    const headings = ["Type", "Date", "Game", "Paying Organization", "Level", "Official / Coverage", "Game Fees", "Mileage", "Total", "Payment / Exception"], actualRows = visibleActual.map((row) => ["Actual", new Date(row.games.starts_at).toLocaleDateString(), row.games.game_number, row.games.leagues?.name, row.games.levels?.name, officialName(row), assignmentFee(row).toFixed(2), mileagePay(row).toFixed(2), totalCost(row).toFixed(2), row.payment_status]), forecastRows = premium ? projections.map((row) => ["Forecast", new Date(row.game.starts_at).toLocaleDateString(), row.game.game_number, row.game.leagues?.name, row.game.levels?.name, `${row.assigned}/${row.game.officials_needed} assigned`, row.committed.toFixed(2), row.estimated.toFixed(2), row.total.toFixed(2), row.exception]) : [], body = [...actualRows, ...forecastRows].map((row) => row.map(quote).join(",")), blob = new Blob([[headings.map(quote).join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "refassign-financial-forecast.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!premium) return;
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]), document = new jsPDF({ orientation: "landscape" });
    document.setTextColor(12, 30, 55); document.setFontSize(18); document.text("RefAssign Financial & Budget Forecast", 14, 16); document.setFontSize(9); document.setTextColor(100, 116, 139); document.text(`${organization === "all" ? "All paying organizations" : organizations.find(([id]) => id === organization)?.[1] || "Organization"} • ${horizon === "all" ? "All upcoming games" : `${horizon === "season" ? "Current season" : `Next ${horizon} days`}`}`, 14, 23); document.setTextColor(15, 23, 42); document.text(`Recorded: ${money(actualTotals.total)}    Paid: ${money(actualTotals.paid)}    Outstanding: ${money(actualTotals.outstanding)}    Projected: ${money(projectedTotal)}`, 14, 31);
    autoTable(document, { startY: 38, head: [["Paying organization", "Actual", "Paid", "Outstanding", "Future games", "Projected", "Budget", "Budget used"]], body: summaries.map((row) => [row.name, money(row.actual), money(row.paid), money(row.outstanding), row.games, money(row.projected), row.budget ? money(row.budget) : "Not set", row.budget ? `${Math.round(row.used * 100)}%` : "—"]), styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] } });
    autoTable(document, { head: [["Date", "Game", "Organization / Level", "Coverage", "Committed", "Open estimate", "Forecast", "Exception"]], body: projections.map((row) => [new Date(row.game.starts_at).toLocaleDateString(), row.game.game_number || "—", `${row.game.leagues?.name || "—"} / ${row.game.levels?.name || "—"}`, `${row.assigned}/${row.game.officials_needed}`, money(row.committed), money(row.estimated), money(row.total), row.exception || "—"]), styles: { fontSize: 7 }, headStyles: { fillColor: [12, 30, 55] } }); addReportCopyright(document); document.save("refassign-financial-forecast.pdf");
  };

  if (loading) return <section className="card"><p>Loading financial forecast…</p></section>;
  return <section className="card officialReports financialForecastReport"><div className="cardHead"><div><h2>Financial &amp; Budget Forecasting</h2><p>Track recorded officiating expenses and forecast future costs by paying organization.</p></div><div className="headerActions">{premium && <span className="badge">Premium reporting</span>}<button className="secondary" disabled={!visibleActual.length && !projections.length} onClick={exportCsv}>Export CSV</button>{premium && <button className="secondary" disabled={!projections.length && !visibleActual.length} onClick={exportPdf}>Export PDF</button>}</div></div>{error && <div className="errorBox">{error}</div>}{!error && <>
    <div className="reportFilters operationsFilters"><label>Recorded expense period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="season">Current season</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="year">Last 12 months</option><option value="custom">Custom dates</option><option value="all">All dates</option></select></label>{period === "custom" && <><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></>}<label>Paying organization<select value={organization} onChange={(event) => setOrganization(event.target.value)}><option value="all">All organizations</option>{organizations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">All levels</option>{levels.map((name) => <option key={name}>{name}</option>)}</select></label><label>Payment status<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="all">All statuses</option><option value="unpaid">Unpaid</option><option value="approved">Approved</option><option value="paid">Paid</option><option value="void">Void</option></select></label>{premium && <label>Forecast window<select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option><option value="season">Current season</option><option value="all">All upcoming games</option></select></label>}</div>
    <div className="reportMetrics operationsMetrics"><div><span>Recorded expenses</span><b>{money(actualTotals.total)}</b></div><div><span>Game fees</span><b>{money(actualTotals.fees)}</b></div><div><span>Mileage</span><b>{money(actualTotals.mileage)}</b></div><div><span>Paid</span><b>{money(actualTotals.paid)}</b></div><div><span>Outstanding</span><b>{money(actualTotals.outstanding)}</b></div>{premium && <div className="premiumMetric"><span>Projected expenses</span><b>{money(projectedTotal)}</b></div>}{premium && <div className="premiumMetric"><span>Cost exceptions</span><b>{projections.filter((row) => row.exception).length}</b></div>}</div>
    {!premium && <div className="reportPremiumNotice"><b>Standard reporting</b><span>Upcoming projections, organization budgets, planning rates, cost trends, exception warnings, and PDF export are available with Premium Reporting.</span></div>}
    {premium && <><div className="financialPlanningHead"><div><h3>Organization planning assumptions</h3><p>Enter different expected costs and budgets for each paying organization. Saved values stay on this device.</p></div><div className="headerActions"><label>Warn at <input type="number" min="1" max="100" value={warningPercent} onChange={(event) => { setSaved(false); setWarningPercent(Math.min(100, Math.max(1, Number(event.target.value) || 1))); }} />% of budget</label><button className="secondary" onClick={savePlanning}>{saved ? "Saved" : "Save assumptions"}</button></div></div><div className="tableWrap"><table className="officialReportTable financialAssumptionsTable"><thead><tr><th>Paying organization</th><th>Expected fee / official</th><th>Expected mileage / official</th><th>Forecast budget</th></tr></thead><tbody>{organizations.map(([id, name]) => { const current = assumptions[id] || { fee: 0, mileage: 0, budget: 0 }, historical = historicalRates.get(`${id}:all`); return <tr key={id}><td><b>{name}</b><small>{historical?.count ? `Historical average ${money((historical.fee + historical.mileage) / historical.count)} per assignment` : "No recorded cost history yet"}</small></td>{(["fee", "mileage", "budget"] as const).map((field) => <td key={field}><span className="currencyInput">$<input type="number" min="0" step="0.01" value={current[field] || ""} placeholder="0.00" onChange={(event) => setAssumption(id, field, Number(event.target.value))} /></span></td>)}</tr>; })}</tbody></table></div>
      <div className="reportCharts"><article className="reportChart"><h4>Actual and projected by month</h4><div className="financialTrend">{months.map((month) => { const max = Math.max(1, ...months.flatMap((item) => [item.actual, item.projected])); return <div key={month.label}><span>{month.label}</span><div><i className="actual" style={{ width: `${month.actual / max * 100}%` }} /><i className="projected" style={{ width: `${month.projected / max * 100}%` }} /></div><b>{money(month.actual + month.projected)}</b></div>; })}</div><div className="financialLegend"><span><i className="actual" /> Recorded</span><span><i className="projected" /> Projected</span></div></article><article className="reportChart"><h4>Organization budget position</h4><div className="reportBars">{summaries.map((row) => <div className={`reportBarRow budgetBar ${row.budget && row.used >= warningPercent / 100 ? "warning" : ""}`} key={row.id}><span title={row.name}>{row.name}</span><i><em style={{ width: `${row.budget ? Math.min(100, row.used * 100) : 0}%` }} /></i><b>{row.budget ? `${Math.round(row.used * 100)}%` : "—"}</b></div>)}</div></article></div>
    </>}
    <h3>Cost by paying organization</h3><div className="tableWrap"><table className="officialReportTable financialSummaryTable"><thead><tr><th>Paying organization</th><th>Assignments</th><th>Actual</th><th>Paid</th><th>Outstanding</th>{premium && <><th>Future games</th><th>Projected</th><th>Budget</th><th>Budget position</th></>}</tr></thead><tbody>{summaries.map((row) => <tr key={row.id}><td><b>{row.name}</b></td><td>{row.assignments}</td><td>{money(row.actual)}</td><td>{money(row.paid)}</td><td>{money(row.outstanding)}</td>{premium && <><td>{row.games}</td><td><b>{money(row.projected)}</b></td><td>{row.budget ? money(row.budget) : "Not set"}</td><td>{row.budget ? <span className={`budgetStatus ${row.used >= 1 ? "over" : row.used >= warningPercent / 100 ? "warning" : "onTrack"}`}>{Math.round(row.used * 100)}% used</span> : "—"}</td></>}</tr>)}</tbody></table></div>
    {premium && <><h3>Upcoming game forecast</h3><div className="tableWrap"><table className="officialReportTable financialForecastTable"><thead><tr><th>Date / Game</th><th>Organization / Level</th><th>Coverage</th><th>Committed assignments</th><th>Open-position estimate</th><th>Total forecast</th><th>Exception</th></tr></thead><tbody>{projections.map((row) => <tr key={row.game.id}><td><b>{new Date(row.game.starts_at).toLocaleDateString()}</b><small>{row.game.game_number || "—"} • {row.game.home?.name || "TBD"} vs {row.game.away?.name || "TBD"}</small></td><td>{row.game.leagues?.name || "—"}<small>{row.game.levels?.name || "—"}</small></td><td>{row.assigned}/{row.game.officials_needed}<small>{row.open} open</small></td><td>{money(row.committed)}</td><td>{money(row.estimated)}</td><td><b>{money(row.total)}</b></td><td>{row.exception ? <span className="budgetStatus warning">{row.exception}</span> : <span className="budgetStatus onTrack">Within range</span>}</td></tr>)}{!projections.length && <tr><td colSpan={7}>No upcoming games match these filters.</td></tr>}</tbody></table></div></>}
    <h3>Recorded expense detail</h3><div className="tableWrap"><table className="officialReportTable financialDetailTable"><thead><tr><th>Date / Game</th><th>Paying organization</th><th>Official / Position</th><th>Game fee</th><th>Mileage</th><th>Total</th><th>Payment</th></tr></thead><tbody>{visibleActual.map((row) => <tr key={row.id}><td>{new Date(row.games.starts_at).toLocaleDateString()}<small>{row.games.game_number || "—"}</small></td><td>{row.games.leagues?.name || "—"}<small>{row.games.levels?.name || "—"}</small></td><td><b>{officialName(row)}</b><small>{row.sport_positions?.name || "Official"}</small></td><td>{money(assignmentFee(row))}</td><td>{money(mileagePay(row))}</td><td><b>{money(totalCost(row))}</b></td><td>{titleCase(row.payment_status)}</td></tr>)}{!visibleActual.length && <tr><td colSpan={7}>No recorded expenses match these filters.</td></tr>}</tbody></table></div>
    <p className="reportFootnote">Forecasts use recorded organization and level averages unless a premium planning rate is entered. Unfilled positions are estimated at the selected organization’s per-official planning rate.</p>
  </>}</section>;
}
