"use client";

import { useEffect, useMemo, useState } from "react";
import ReportSavedViews from "./ReportSavedViews";
import type { ReportActionTarget } from "../lib/reportActions";

type Named = { name: string } | null;
type PaymentStatus = "unpaid" | "approved" | "paid" | "void";
type Row = {
  id: string;
  status: string;
  game_fee: number;
  mileage_miles: number;
  mileage_rate: number;
  payment_status: PaymentStatus;
  paid_at: string | null;
  officials: { id: string; first_name: string; last_name: string } | null;
  sport_positions: Named;
  games: {
    id: string;
    game_number: string | null;
    starts_at: string;
    leagues: { id: string; name: string } | null;
    levels: Named;
    location: Named;
    home: Named;
    away: Named;
  } | null;
};
type Period = "30" | "90" | "year" | "all" | "custom";
type DetailFocus = "all" | "paid" | "outstanding";
const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const officialName = (row: Row) =>
  `${row.officials?.first_name || ""} ${row.officials?.last_name || ""}`.trim() ||
  "Unknown official";
const fee = (row: Row) =>
  row.payment_status === "void" ? 0 : Number(row.game_fee || 0);
const mileagePay = (row: Row) =>
  row.payment_status === "void"
    ? 0
    : Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0);

export default function PayrollPaymentReport({ organizationId, onOpenAction }: { organizationId?: string; onOpenAction?: (target: ReportActionTarget) => void }) {
  const [rows, setRows] = useState<Row[]>([]),
    [period, setPeriod] = useState<Period>("90"),
    [league, setLeague] = useState("all"),
    [official, setOfficial] = useState("all"),
    [status, setStatus] = useState("all"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [detailFocus, setDetailFocus] = useState<DetailFocus>("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const drill = (focus: DetailFocus, kind?: "league" | "official", value?: string) => {
    if (kind === "league" && value) setLeague(value);
    if (kind === "official" && value) {
      const match = officials.find(([, name]) => name === value);
      if (match) setOfficial(match[0]);
    }
    setDetailFocus(focus);
    window.setTimeout(() => document.getElementById("payroll-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/reports/payroll?organizationId=${encodeURIComponent(organizationId || "")}`, {
          cache: "no-store",
        }),
        result = await response.json();
      if (!response.ok)
        setError(result.error || "Payroll reporting could not be loaded.");
      else setRows(result.assignments || []);
      setLoading(false);
    })();
  }, []);
  const leagues = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => row.games?.leagues?.name)
            .filter(Boolean) as string[],
        ),
      ].sort(),
    [rows],
  );
  const officials = useMemo(
    () =>
      [
        ...new Map(
          rows
            .filter((row) => row.officials)
            .map((row) => [row.officials!.id, officialName(row)]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  );
  const visible = useMemo(() => {
    const now = new Date(),
      cutoff = new Date(now);
    if (period === "30") cutoff.setDate(now.getDate() - 30);
    if (period === "90") cutoff.setDate(now.getDate() - 90);
    if (period === "year") cutoff.setFullYear(now.getFullYear() - 1);
    return rows
      .filter((row) => {
        const date = new Date(row.games?.starts_at || 0);
        if (league !== "all" && row.games?.leagues?.name !== league)
          return false;
        if (official !== "all" && row.officials?.id !== official) return false;
        if (status !== "all" && row.payment_status !== status) return false;
        if (period === "custom")
          return (
            (!startDate || date >= new Date(`${startDate}T00:00:00`)) &&
            (!endDate || date <= new Date(`${endDate}T23:59:59`))
          );
        return period === "all" || date >= cutoff;
      })
      .sort(
        (a, b) =>
          new Date(b.games?.starts_at || 0).getTime() -
          new Date(a.games?.starts_at || 0).getTime(),
      );
  }, [rows, period, league, official, status, startDate, endDate]);
  const totals = visible.reduce(
    (sum, row) => {
      const gameFee = fee(row),
        travel = mileagePay(row),
        total = gameFee + travel;
      sum.fees += gameFee;
      sum.mileage += travel;
      sum.total += total;
      if (row.payment_status === "paid") sum.paid += total;
      if (["unpaid", "approved"].includes(row.payment_status))
        sum.outstanding += total;
      return sum;
    },
    { fees: 0, mileage: 0, total: 0, paid: 0, outstanding: 0 },
  );
  const detailRows = visible.filter((row) => detailFocus === "all" || (detailFocus === "paid" ? row.payment_status === "paid" : ["unpaid", "approved"].includes(row.payment_status)));
  const summaries = useMemo(() => {
    const by = (key: (row: Row) => string) => {
      const map = new Map<
        string,
        {
          assignments: number;
          fees: number;
          mileage: number;
          total: number;
          paid: number;
          outstanding: number;
        }
      >();
      visible.forEach((row) => {
        const label = key(row),
          current = map.get(label) || {
            assignments: 0,
            fees: 0,
            mileage: 0,
            total: 0,
            paid: 0,
            outstanding: 0,
          },
          gameFee = fee(row),
          travel = mileagePay(row),
          total = gameFee + travel;
        current.assignments++;
        current.fees += gameFee;
        current.mileage += travel;
        current.total += total;
        if (row.payment_status === "paid") current.paid += total;
        if (["unpaid", "approved"].includes(row.payment_status))
          current.outstanding += total;
        map.set(label, current);
      });
      return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
    };
    return {
      leagues: by((row) => row.games?.leagues?.name || "Not specified"),
      officials: by(officialName),
    };
  }, [visible]);
  const csv = () => {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const detail = visible.map((row) =>
      [
        row.games?.starts_at
          ? new Date(row.games.starts_at).toLocaleDateString()
          : "",
        row.games?.game_number,
        row.games?.leagues?.name,
        officialName(row),
        row.sport_positions?.name,
        fee(row).toFixed(2),
        Number(row.mileage_miles || 0).toFixed(1),
        Number(row.mileage_rate || 0).toFixed(3),
        mileagePay(row).toFixed(2),
        (fee(row) + mileagePay(row)).toFixed(2),
        row.payment_status,
        row.paid_at ? new Date(row.paid_at).toLocaleDateString() : "",
      ]
        .map(quote)
        .join(","),
    );
    const blob = new Blob(
        [
          [
            "Date,Game,Organization,Official,Position,Game Fee,Miles,Rate,Mileage Pay,Total,Payment Status,Paid Date",
            ...detail,
          ].join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "refassign-payroll-payment-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const SummaryTable = ({
    title,
    data,
    kind,
  }: {
    title: string;
    data: typeof summaries.leagues;
    kind: "league" | "official";
  }) => (
    <div>
      <h3>{title}</h3>
      <div className="tableWrap">
        <table className="officialReportTable">
          <thead>
            <tr>
              <th>
                {title.includes("organization") ? "Organization" : "Official"}
              </th>
              <th>Assignments</th>
              <th>Game fees</th>
              <th>Mileage</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {data.map(([label, row]) => (
              <tr key={label} className="drilldownRow" onClick={() => drill("all", kind, label)}>
                <td>
                  <b>{label}</b>
                </td>
                <td>{row.assignments}</td>
                <td>{money(row.fees)}</td>
                <td>{money(row.mileage)}</td>
                <td>
                  <b>{money(row.total)}</b>
                </td>
                <td>{money(row.paid)}</td>
                <td>{money(row.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  if (loading)
    return (
      <section className="card">
        <p>Loading payroll reporting…</p>
      </section>
    );
  return (
    <section className="card officialReports">
      <div className="cardHead">
        <div>
          <h2>Payroll & Payment Report</h2>
          <p>
            Review officiating costs and payment progress by organization and
            official.
          </p>
        </div>
        <div className="headerActions">
          <span className="badge">Premium reporting</span>
          <button
            className="secondary"
            disabled={!visible.length}
            onClick={csv}
          >
            Export CSV
          </button>
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {!error && (
        <>
          <div className="reportFilters">
            <label>
              Reporting period
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
              >
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="year">Last 12 months</option>
                <option value="custom">Custom dates</option>
                <option value="all">All assignments</option>
              </select>
            </label>
            {period === "custom" && (
              <>
                <label>
                  Start date
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Organization
              <select
                value={league}
                onChange={(e) => setLeague(e.target.value)}
              >
                <option value="all">All organizations</option>
                {leagues.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Official
              <select
                value={official}
                onChange={(e) => setOfficial(e.target.value)}
              >
                <option value="all">All officials</option>
                {officials.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payment status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="void">Void</option>
              </select>
            </label>
          </div>
          <ReportSavedViews organizationId={organizationId} reportKey="payroll" filters={{ period, league, official, status, startDate, endDate }} onApply={(saved) => { if (saved.period) setPeriod(saved.period as Period); if (saved.league) setLeague(saved.league); if (saved.official) setOfficial(saved.official); if (saved.status) setStatus(saved.status); setStartDate(saved.startDate || ""); setEndDate(saved.endDate || ""); }} />
          <div className="reportMetrics drilldownMetrics">
            <button type="button" onClick={() => drill("all")}>
              <span>Assignments</span>
              <b>{visible.length}</b>
            </button>
            <button type="button" onClick={() => drill("all")}>
              <span>Game fees</span>
              <b>{money(totals.fees)}</b>
            </button>
            <button type="button" onClick={() => drill("all")}>
              <span>Mileage reimbursement</span>
              <b>{money(totals.mileage)}</b>
            </button>
            <button type="button" onClick={() => drill("all")}>
              <span>Total expense</span>
              <b>{money(totals.total)}</b>
            </button>
            <button type="button" onClick={() => drill("paid")}>
              <span>Paid</span>
              <b>{money(totals.paid)}</b>
            </button>
            <button type="button" onClick={() => drill("outstanding")}>
              <span>Outstanding</span>
              <b>{money(totals.outstanding)}</b>
            </button>
          </div>
          <div className="reportCharts">
            <article className="reportChart">
              <h4>Cost by paying organization</h4>
              <div className="reportBars">
                {summaries.leagues.slice(0, 8).map(([label, row]) => {
                  const max = Math.max(
                    1,
                    ...summaries.leagues.map((item) => item[1].total),
                  );
                  return (
                    <div className="reportBarRow" key={label}>
                      <span title={label}>{label}</span>
                      <i>
                        <em style={{ width: `${(row.total / max) * 100}%` }} />
                      </i>
                      <b>{money(row.total)}</b>
                    </div>
                  );
                })}
              </div>
            </article>
            <article className="reportChart">
              <h4>Payment progress</h4>
              <div className="positionChart">
                <div
                  className="positionDonut"
                  style={{
                    background: totals.total
                      ? `conic-gradient(#16a34a 0 ${(totals.paid / totals.total) * 100}%, #f59e0b ${(totals.paid / totals.total) * 100}% 100%)`
                      : "#e2e8f0",
                  }}
                >
                  <span>
                    <b>
                      {totals.total
                        ? Math.round((totals.paid / totals.total) * 100)
                        : 0}
                      %
                    </b>
                    paid
                  </span>
                </div>
                <div className="positionLegend">
                  <div>
                    <i style={{ background: "#16a34a" }} />
                    <span>Paid</span>
                    <b>{money(totals.paid)}</b>
                  </div>
                  <div>
                    <i style={{ background: "#f59e0b" }} />
                    <span>Outstanding</span>
                    <b>{money(totals.outstanding)}</b>
                  </div>
                </div>
              </div>
            </article>
          </div>
          <SummaryTable
            title="Compensation by paying organization"
            data={summaries.leagues}
            kind="league"
          />
          <SummaryTable
            title="Compensation by official"
            data={summaries.officials}
            kind="official"
          />
          <div className="drilldownDetailHead" id="payroll-detail"><h3>Payroll detail{detailFocus !== "all" ? ` — ${detailFocus}` : ""}</h3>{detailFocus !== "all" || league !== "all" || official !== "all" ? <button type="button" className="tableButton" onClick={() => { setDetailFocus("all"); setLeague("all"); setOfficial("all"); }}>Clear drill-down</button> : null}</div>
          <div className="tableWrap"><table className="officialReportTable"><thead><tr><th>Date</th><th>Game</th><th>Official</th><th>Position</th><th>Organization</th><th>Game fee</th><th>Mileage</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{detailRows.length ? detailRows.map((row) => <tr key={row.id}><td>{row.games?.starts_at ? new Date(row.games.starts_at).toLocaleDateString() : "—"}</td><td>#{row.games?.game_number || "—"}</td><td><button type="button" className="reportTextAction" onClick={() => row.officials?.id && onOpenAction?.({ section: "Officials", officialId: row.officials.id })}>{officialName(row)}</button></td><td>{row.sport_positions?.name || "—"}</td><td>{row.games?.leagues?.name || "—"}</td><td>{money(fee(row))}</td><td>{money(mileagePay(row))}</td><td><b>{money(fee(row) + mileagePay(row))}</b></td><td>{row.payment_status}</td><td><button type="button" className="tableButton reportActionButton" onClick={() => onOpenAction?.({ section: "Payroll", assignmentId: row.id })}>Open payroll</button></td></tr>) : <tr><td colSpan={10}>No payroll records match this drill-down.</td></tr>}</tbody></table></div>
        </>
      )}
    </section>
  );
}
