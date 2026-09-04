"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type PaymentStatus = "unpaid" | "approved" | "paid" | "void";
type MileagePlan = "one_way" | "round_trip" | "actual" | "none";
type Period = "all" | "past" | "week" | "future";
type SortKey =
  | "date"
  | "game"
  | "location"
  | "official"
  | "position"
  | "fee"
  | "defaultMileage"
  | "miles"
  | "rate"
  | "total"
  | "status";
type PayrollRow = {
  id: string;
  status: string;
  game_fee: number;
  mileage_miles: number;
  mileage_rate: number;
  payment_status: PaymentStatus;
  paid_at: string | null;
  payroll_notes: string | null;
  officials: {
    id: string;
    first_name: string;
    last_name: string;
    home_latitude: number | null;
    home_longitude: number | null;
  } | null;
  sport_positions: { name: string } | null;
  games: {
    game_number: string;
    starts_at: string;
    leagues: { mileage_plan: MileagePlan } | null;
    home: { name: string } | null;
    away: { name: string } | null;
    location: {
      name: string;
      latitude: number | null;
      longitude: number | null;
    } | null;
  } | null;
};
type WeekdayOrigin = {
  official_id: string;
  weekday: number;
  use_home: boolean;
  alternate_label: string | null;
  alternate_latitude: number | null;
  alternate_longitude: number | null;
};
type ImportRow = {
  spreadsheetRow: number;
  assignmentId: string;
  label: string;
  gameFee: number;
  mileageMiles: number;
  mileageRate: number;
  paymentStatus: PaymentStatus;
  notes: string;
};

const statuses: ReadonlyArray<[PaymentStatus, string]> = [
  ["unpaid", "Unpaid"],
  ["approved", "Approved"],
  ["paid", "Paid"],
  ["void", "Void"],
];
const mileagePlanLabels: Record<MileagePlan, string> = {
  one_way: "One-way mileage",
  round_trip: "Round-trip mileage",
  actual: "Actual driving distance",
  none: "No mileage paid",
};
const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const officialName = (row: PayrollRow) =>
  `${row.officials?.first_name || ""} ${row.officials?.last_name || ""}`.trim();
const gameName = (row: PayrollRow) =>
  `${row.games?.home?.name || "TBD"} vs ${row.games?.away?.name || "TBD"}`;

function milesBetween(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
) {
  if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return null;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(Number(lat2) - Number(lat1));
  const dLon = radians(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(Number(lat1))) *
      Math.cos(radians(Number(lat2))) *
      Math.sin(dLon / 2) ** 2;
  return (
    Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) /
    10
  );
}

function mileagePlanFor(row: PayrollRow): MileagePlan {
  return row.games?.leagues?.mileage_plan || "round_trip";
}

function calculatedMileage(row: PayrollRow, origins: WeekdayOrigin[]) {
  const plan = mileagePlanFor(row);
  if (plan === "none") return 0;
  if (plan === "actual") return null;
  const weekday = new Date(row.games?.starts_at || 0).getDay();
  const origin = origins.find(
    (item) => item.official_id === row.officials?.id && item.weekday === weekday,
  );
  const useAlternate = Boolean(origin && !origin.use_home);
  const oneWay = milesBetween(
    useAlternate
      ? origin!.alternate_latitude
      : (row.officials?.home_latitude ?? null),
    useAlternate
      ? origin!.alternate_longitude
      : (row.officials?.home_longitude ?? null),
    row.games?.location?.latitude ?? null,
    row.games?.location?.longitude ?? null,
  );
  if (oneWay == null) return null;
  return plan === "round_trip" ? Math.round(oneWay * 2 * 10) / 10 : oneWay;
}

function weekBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function normalizedRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value,
    ]),
  );
}

export default function PayrollManager() {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const geocodeBackfillStarted = useRef(false);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [weekdayOrigins, setWeekdayOrigins] = useState<WeekdayOrigin[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    { key: "date", direction: "asc" },
  );
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFile, setImportFile] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/payroll", { cache: "no-store" });
      const result = (await response.json()) as {
        assignments?: PayrollRow[];
        weekdayOrigins?: WeekdayOrigin[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Payroll could not be loaded.");
      const origins = result.weekdayOrigins || [];
      const loadedRows = result.assignments || [];
      setRows(
        loadedRows.map((row) => {
          const automaticMiles = calculatedMileage(row, origins);
          return automaticMiles == null
            ? row
            : { ...row, mileage_miles: automaticMiles };
        }),
      );
      setWeekdayOrigins(origins);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Payroll could not be loaded.",
      );
    }
    setLoading(false);
  }
  useEffect(() => {
    if (geocodeBackfillStarted.current) return;
    geocodeBackfillStarted.current = true;
    void (async () => {
      await load();
      try {
        const response = await fetch("/api/geocode/backfill", { method: "POST" });
        const result = (await response.json()) as {
          updated?: number;
          failed?: number;
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "Address backfill failed.");
        if (result.updated) {
          setNotice(
            `${result.updated} saved address${result.updated === 1 ? " was" : "es were"} located automatically. Mileage has been recalculated.`,
          );
          await load();
        }
        if (result.failed)
          setError(
            `${result.failed} address${result.failed === 1 ? " could" : "es could"} not be located. Check those street addresses, cities, and states.`,
          );
      } catch (backfillError) {
        setError(
          backfillError instanceof Error
            ? backfillError.message
            : "Existing addresses could not be located automatically.",
        );
      }
    })();
  }, []);

  const mileagePlan = mileagePlanFor;
  const originFor = (row: PayrollRow) => {
    const weekday = new Date(row.games?.starts_at || 0).getDay();
    return weekdayOrigins.find(
      (origin) =>
        origin.official_id === row.officials?.id && origin.weekday === weekday,
    );
  };
  const originLabel = (row: PayrollRow) => {
    const origin = originFor(row);
    return origin && !origin.use_home
      ? origin.alternate_label || "Different location"
      : "Home address";
  };
  const defaultMileage = (row: PayrollRow) =>
    calculatedMileage(row, weekdayOrigins);
  const mileagePay = (row: PayrollRow) =>
    mileagePlan(row) === "none"
      ? 0
      : Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0);
  const total = (row: PayrollRow) =>
    row.payment_status === "void"
      ? 0
      : Number(row.game_fee || 0) + mileagePay(row);
  const patch = (id: string, values: Partial<PayrollRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...values } : row)),
    );

  function sortValue(row: PayrollRow, key: SortKey): string | number {
    if (key === "date") return row.games?.starts_at || "";
    if (key === "game") return gameName(row);
    if (key === "location") return row.games?.location?.name || "";
    if (key === "official") return officialName(row);
    if (key === "position") return row.sport_positions?.name || "";
    if (key === "fee") return Number(row.game_fee || 0);
    if (key === "defaultMileage")
      return defaultMileage(row) ?? Number.MAX_SAFE_INTEGER;
    if (key === "miles") return Number(row.mileage_miles || 0);
    if (key === "rate") return Number(row.mileage_rate || 0);
    if (key === "total") return total(row);
    return row.payment_status;
  }
  function changeSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }
  const sortLabel = (label: string, key: SortKey) =>
    `${label}${sort.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}`;

  const visible = rows
    .filter((row) => {
      const gameDate = new Date(row.games?.starts_at || 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { start, end } = weekBounds();
      const periodMatch =
        period === "all" ||
        (period === "past" && gameDate < today) ||
        (period === "week" && gameDate >= start && gameDate < end) ||
        (period === "future" && gameDate >= end);
      return (
        periodMatch &&
        (statusFilter === "all" || row.payment_status === statusFilter)
      );
    })
    .sort((a, b) => {
      const first = sortValue(a, sort.key),
        second = sortValue(b, sort.key);
      const result =
        typeof first === "number" && typeof second === "number"
          ? first - second
          : String(first).localeCompare(String(second), undefined, {
              numeric: true,
            });
      return sort.direction === "asc" ? result : -result;
    });
  const selectedRows = visible.filter((row) => selected.includes(row.id));
  const totals = visible.reduce(
    (sum, row) => ({
      fees:
        sum.fees +
        (row.payment_status === "void" ? 0 : Number(row.game_fee || 0)),
      mileage:
        sum.mileage + (row.payment_status === "void" ? 0 : mileagePay(row)),
      total: sum.total + total(row),
    }),
    { fees: 0, mileage: 0, total: 0 },
  );

  async function save(row: PayrollRow) {
    setSaving(row.id);
    setError("");
    setNotice("");
    const { data: userData } = await supabase.auth.getUser();
    const { error: saveError } = await supabase
      .from("assignments")
      .update({
        game_fee: Number(row.game_fee || 0),
        mileage_miles: Number(row.mileage_miles || 0),
        mileage_rate: Number(row.mileage_rate || 0),
        payment_status: row.payment_status,
        paid_at:
          row.payment_status === "paid"
            ? row.paid_at || new Date().toISOString()
            : null,
        payroll_notes: row.payroll_notes?.trim() || null,
        payroll_updated_at: new Date().toISOString(),
        payroll_updated_by: userData.user?.id || null,
      })
      .eq("id", row.id);
    if (saveError) setError(saveError.message);
    else {
      setNotice("Payroll record saved.");
      await load();
    }
    setSaving("");
  }

  async function bulkStatus(paymentStatus: PaymentStatus) {
    if (!selected.length) return;
    setSaving("bulk");
    setError("");
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("assignments")
      .update({
        payment_status: paymentStatus,
        paid_at: paymentStatus === "paid" ? now : null,
        payroll_updated_at: now,
        payroll_updated_by: userData.user?.id || null,
      })
      .in("id", selected);
    if (updateError) setError(updateError.message);
    else {
      setNotice(`${selected.length} payroll records marked ${paymentStatus}.`);
      setSelected([]);
      await load();
    }
    setSaving("");
  }

  async function exportPayroll() {
    const exportRows = selectedRows.length ? selectedRows : visible;
    if (!exportRows.length)
      return setError("There are no payroll records to export.");
    const XLSX = await import("xlsx");
    const data = exportRows.map((row) => ({
      "Assignment ID": row.id,
      Date: row.games
        ? new Date(row.games.starts_at).toLocaleDateString("en-US")
        : "",
      "Game Number": row.games?.game_number || "",
      Game: gameName(row),
      Location: row.games?.location?.name || "",
      Official: officialName(row),
      Position: row.sport_positions?.name || "Official",
      "Game Fee": Number(row.game_fee || 0),
      "Mileage Plan": mileagePlanLabels[mileagePlan(row)],
      "Mileage Origin": originLabel(row),
      "Default Mileage": defaultMileage(row) ?? "",
      "Mileage Miles": Number(row.mileage_miles || 0),
      "Mileage Rate": Number(row.mileage_rate || 0),
      "Mileage Reimbursement": mileagePay(row),
      "Payroll Total": total(row),
      "Payment Status": row.payment_status,
      Notes: row.payroll_notes || "",
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = [
      { wch: 38 },
      { wch: 12 },
      { wch: 16 },
      { wch: 32 },
      { wch: 24 },
      { wch: 24 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Payroll");
    XLSX.writeFile(workbook, `refassign-payroll-${period}.xlsx`);
  }

  async function selectImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setImportRows([]);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]],
        { defval: "" },
      );
      if (!records.length)
        throw new Error("The payroll spreadsheet has no data rows.");
      const preview = records.map((raw, index) => {
        const record = normalizedRecord(raw),
          assignmentId = String(record.assignment_id || "").trim(),
          gameNumber = String(record.game_number || "").trim(),
          official = String(record.official || "").trim(),
          position = String(record.position || "").trim();
        const matches = assignmentId
          ? rows.filter((row) => row.id === assignmentId)
          : rows.filter(
              (row) =>
                row.games?.game_number.toLowerCase() ===
                  gameNumber.toLowerCase() &&
                officialName(row).toLowerCase() === official.toLowerCase() &&
                (row.sport_positions?.name || "Official").toLowerCase() ===
                  position.toLowerCase(),
            );
        if (matches.length !== 1)
          throw new Error(
            `Spreadsheet row ${index + 2}: ${matches.length ? "multiple assignments matched" : "no accepted assignment matched"}. Include a valid Assignment ID, or an exact Game Number, Official, and Position.`,
          );
        const numberValue = (key: string, fallback: number) => {
          const rawValue = record[key];
          if (rawValue === "" || rawValue == null) return fallback;
          const value = Number(rawValue);
          if (!Number.isFinite(value) || value < 0)
            throw new Error(
              `Spreadsheet row ${index + 2}: ${key.replaceAll("_", " ")} must be zero or greater.`,
            );
          return value;
        };
        const paymentStatus = String(
          record.payment_status || matches[0].payment_status,
        ).toLowerCase();
        if (!statuses.some(([value]) => value === paymentStatus))
          throw new Error(
            `Spreadsheet row ${index + 2}: Payment Status must be Unpaid, Approved, Paid, or Void.`,
          );
        return {
          spreadsheetRow: index + 2,
          assignmentId: matches[0].id,
          label: `${matches[0].games?.game_number} — ${officialName(matches[0])} — ${matches[0].sport_positions?.name || "Official"}`,
          gameFee: numberValue("game_fee", Number(matches[0].game_fee || 0)),
          mileageMiles: numberValue(
            "mileage_miles",
            Number(matches[0].mileage_miles || 0),
          ),
          mileageRate: numberValue(
            "mileage_rate",
            Number(matches[0].mileage_rate || 0),
          ),
          paymentStatus: paymentStatus as PaymentStatus,
          notes: String(record.notes ?? matches[0].payroll_notes ?? "").trim(),
        };
      });
      const duplicate = preview.find(
        (row, index) =>
          preview.findIndex(
            (other) => other.assignmentId === row.assignmentId,
          ) !== index,
      );
      if (duplicate)
        throw new Error(
          `Spreadsheet row ${duplicate.spreadsheetRow}: duplicate assignment in import.`,
        );
      setImportRows(preview);
      setImportFile(file.name);
      setNotice(
        `${preview.length} payroll rows validated. Review the preview, then apply the import.`,
      );
    } catch (importError) {
      setImportFile("");
      setError(
        importError instanceof Error
          ? importError.message
          : "Payroll import failed.",
      );
    }
  }

  async function applyImport() {
    if (!importRows.length) return;
    setSaving("import");
    setError("");
    const { data, error: importError } = await supabase.rpc(
      "import_payroll_rows",
      {
        p_rows: importRows.map((row) => ({
          assignment_id: row.assignmentId,
          spreadsheet_row: row.spreadsheetRow,
          game_fee: row.gameFee,
          mileage_miles: row.mileageMiles,
          mileage_rate: row.mileageRate,
          payment_status: row.paymentStatus,
          payroll_notes: row.notes || null,
        })),
      },
    );
    if (importError) setError(importError.message);
    else {
      setNotice(
        `${Number(data || importRows.length)} payroll records imported from ${importFile}.`,
      );
      setImportRows([]);
      setImportFile("");
      await load();
    }
    setSaving("");
  }

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Payroll & Game Fees</h2>
          <p>
            Accepted officials, game fees, mileage reimbursement, and payment
            status.
          </p>
        </div>
        <div className="headerActions">
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={selectImport}
          />
          <button
            className="secondary"
            onClick={() => fileInput.current?.click()}
          >
            Import Payroll
          </button>
          <button className="primary" onClick={() => void exportPayroll()}>
            Export {selectedRows.length ? "Selected" : "Payroll"}
          </button>
        </div>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      <div className="payrollSlicers" aria-label="Game date filters">
        {(["all", "past", "week", "future"] as Period[]).map((value) => (
          <button
            key={value}
            className={period === value ? "active" : ""}
            onClick={() => setPeriod(value)}
          >
            {value === "all"
              ? "All Games"
              : value === "past"
                ? "Past Games"
                : value === "week"
                  ? "This Week"
                  : "Future"}
          </button>
        ))}
      </div>
      <div className="formGrid payrollFilters">
        <label>
          Payment Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All Statuses</option>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="metrics payrollMetrics">
        <div className="metric">
          <i />
          <strong>{money(totals.fees)}</strong>
          <span>Game fees</span>
        </div>
        <div className="metric">
          <i />
          <strong>{money(totals.mileage)}</strong>
          <span>Mileage reimbursement</span>
        </div>
        <div className="metric">
          <i />
          <strong>{money(totals.total)}</strong>
          <span>Payroll total</span>
        </div>
        <div className="metric">
          <i />
          <strong>
            {visible.filter((row) => row.payment_status === "unpaid").length}
          </strong>
          <span>Unpaid assignments</span>
        </div>
      </div>
      {importRows.length > 0 && (
        <div className="payrollImportPreview">
          <div className="cardHead">
            <div>
              <h3>Import Preview</h3>
              <p>{importFile} — no changes have been applied.</p>
            </div>
            <div className="headerActions">
              <button
                className="secondary"
                onClick={() => {
                  setImportRows([]);
                  setImportFile("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={saving === "import"}
                onClick={() => void applyImport()}
              >
                {saving === "import"
                  ? "Importing…"
                  : `Apply ${importRows.length} Rows`}
              </button>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Assignment</th>
                  <th>Fee</th>
                  <th>Miles</th>
                  <th>Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {importRows.map((row) => (
                  <tr key={row.assignmentId}>
                    <td>{row.spreadsheetRow}</td>
                    <td>{row.label}</td>
                    <td>{money(row.gameFee)}</td>
                    <td>{row.mileageMiles}</td>
                    <td>{money(row.mileageRate)}</td>
                    <td>{row.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="payrollBulk">
          <b>{selected.length} selected</b>
          <button
            className="secondary"
            disabled={saving === "bulk"}
            onClick={() => void bulkStatus("approved")}
          >
            Mark Approved
          </button>
          <button
            className="success"
            disabled={saving === "bulk"}
            onClick={() => void bulkStatus("paid")}
          >
            Mark Paid
          </button>
          <button className="secondary" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}
      {loading ? (
        <p>Loading payroll…</p>
      ) : (
        <div className="tableWrap">
          <table className="payrollTable">
            <colgroup>
              <col className="payrollSelectCol" />
              <col className="payrollDateCol" />
              <col className="payrollGameCol" />
              <col className="payrollLocationCol" />
              <col className="payrollOfficialCol" />
              <col className="payrollPositionCol" />
              <col className="payrollFeeCol" />
              <col className="payrollDefaultMilesCol" />
              <col className="payrollMilesCol" />
              <col className="payrollRateCol" />
              <col className="payrollMileagePayCol" />
              <col className="payrollTotalCol" />
              <col className="payrollStatusCol" />
              <col className="payrollNotesCol" />
              <col className="payrollActionCol" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible payroll records"
                    checked={
                      visible.length > 0 &&
                      visible.every((row) => selected.includes(row.id))
                    }
                    onChange={() =>
                      setSelected(
                        visible.every((row) => selected.includes(row.id))
                          ? selected.filter(
                              (id) => !visible.some((row) => row.id === id),
                            )
                          : Array.from(
                              new Set([
                                ...selected,
                                ...visible.map((row) => row.id),
                              ]),
                            ),
                      )
                    }
                  />
                </th>
                {(
                  [
                    ["date", "Date"],
                    ["game", "Game"],
                    ["location", "Location"],
                    ["official", "Accepted Official"],
                    ["position", "Position"],
                    ["fee", "Game Fee"],
                    ["defaultMileage", "Default Mileage"],
                    ["miles", "Paid Miles"],
                    ["rate", "Rate"],
                  ] as Array<[SortKey, string]>
                ).map(([key, label]) => (
                  <th key={key}>
                    <button onClick={() => changeSort(key)}>
                      {sortLabel(label, key)}
                    </button>
                  </th>
                ))}
                <th>Mileage Pay</th>
                <th>
                  <button onClick={() => changeSort("total")}>
                    {sortLabel("Total", "total")}
                  </button>
                </th>
                <th>
                  <button onClick={() => changeSort("status")}>
                    {sortLabel("Status", "status")}
                  </button>
                </th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((row) => {
                  const suggestedMiles = defaultMileage(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select payroll record for ${officialName(row)}`}
                          checked={selected.includes(row.id)}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(row.id)
                                ? current.filter((id) => id !== row.id)
                                : [...current, row.id],
                            )
                          }
                        />
                      </td>
                      <td>
                        {row.games
                          ? new Date(row.games.starts_at).toLocaleDateString(
                              "en-US",
                            )
                          : ""}
                      </td>
                      <td>
                        <b>{gameName(row)}</b>
                        <small>{row.games?.game_number}</small>
                      </td>
                      <td>{row.games?.location?.name || "TBD"}</td>
                      <td>
                        <b>{officialName(row)}</b>
                        <small>
                          {row.status === "confirmed"
                            ? "Confirmed"
                            : "Accepted"}
                        </small>
                      </td>
                      <td>{row.sport_positions?.name || "Official"}</td>
                      <td>
                        <input
                          aria-label="Game fee"
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.game_fee}
                          onChange={(event) =>
                            patch(row.id, {
                              game_fee: Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        {mileagePlan(row) === "none" ? (
                          <span title="This league does not pay mileage">
                            No mileage paid
                          </span>
                        ) : mileagePlan(row) === "actual" ? (
                          <span title="Enter the official's actual driving distance in Paid Miles">
                            Actual miles • {originLabel(row)}
                          </span>
                        ) : suggestedMiles == null ? (
                          <span title="Add coordinates to the official home and venue">
                            Unavailable
                          </span>
                        ) : (
                          <>
                            <b>{suggestedMiles} mi</b>
                            <small>
                              {originLabel(row)} •{" "}
                              {mileagePlan(row) === "round_trip"
                                ? "Round trip"
                                : "One way"}
                            </small>
                            <button
                              className="linkButton"
                              onClick={() =>
                                patch(row.id, { mileage_miles: suggestedMiles })
                              }
                            >
                              Use Default
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        <input
                          aria-label="Mileage miles"
                          type="number"
                          min="0"
                          step="0.1"
                          disabled={mileagePlan(row) === "none"}
                          value={
                            mileagePlan(row) === "none" ? 0 : row.mileage_miles
                          }
                          onChange={(event) =>
                            patch(row.id, {
                              mileage_miles: Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label="Mileage rate"
                          type="number"
                          min="0"
                          step="0.001"
                          disabled={mileagePlan(row) === "none"}
                          value={row.mileage_rate}
                          onChange={(event) =>
                            patch(row.id, {
                              mileage_rate: Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td>{money(mileagePay(row))}</td>
                      <td>
                        <b>{money(total(row))}</b>
                      </td>
                      <td>
                        <select
                          aria-label="Payment status"
                          value={row.payment_status}
                          onChange={(event) =>
                            patch(row.id, {
                              payment_status: event.target
                                .value as PaymentStatus,
                            })
                          }
                        >
                          {statuses.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label="Payroll notes"
                          value={row.payroll_notes || ""}
                          onChange={(event) =>
                            patch(row.id, { payroll_notes: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="primary"
                          disabled={saving === row.id}
                          onClick={() => void save(row)}
                        >
                          {saving === row.id ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={15}>
                    No accepted payroll records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
