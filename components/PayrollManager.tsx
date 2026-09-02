"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type PayrollRow = {
  id: string;
  game_fee: number;
  mileage_miles: number;
  mileage_rate: number;
  payment_status: "unpaid" | "approved" | "paid" | "void";
  paid_at: string | null;
  payroll_notes: string | null;
  officials: { first_name: string; last_name: string } | null;
  sport_positions: { name: string } | null;
  games: {
    game_number: string;
    starts_at: string;
    home: { name: string } | null;
    away: { name: string } | null;
    location: { name: string } | null;
  } | null;
};

type PayrollExportRow = {
  Date: string;
  "Game Number": string;
  Game: string;
  Location: string;
  Official: string;
  Position: string;
  "Game Fee": number;
  "Mileage Miles": number;
  "Mileage Rate": number;
  "Mileage Reimbursement": number;
  "Payroll Total": number;
  "Payment Status": string;
  "Paid Date": string;
  Notes: string;
};

const statuses = [
  ["unpaid", "Unpaid"],
  ["approved", "Approved"],
  ["paid", "Paid"],
  ["void", "Void"],
] as const;

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function PayrollManager() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("assignments")
      .select(
        "id,game_fee,mileage_miles,mileage_rate,payment_status,paid_at,payroll_notes,officials(first_name,last_name),sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name))",
      )
      .not("official_id", "is", null)
      .neq("status", "declined")
      .order("assigned_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setRows((data || []) as unknown as PayrollRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function patch(id: string, values: Partial<PayrollRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...values } : row)),
    );
  }

  function total(row: PayrollRow) {
    if (row.payment_status === "void") return 0;
    return (
      Number(row.game_fee || 0) +
      Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0)
    );
  }

  const visible = rows.filter((row) => {
    const date = row.games?.starts_at?.slice(0, 7);
    return (
      (!month || date === month) &&
      (statusFilter === "all" || row.payment_status === statusFilter)
    );
  });
  const selectedRows = visible.filter((row) => selected.includes(row.id));
  const totals = visible.reduce(
    (sum, row) => ({
      fees:
        sum.fees +
        (row.payment_status === "void" ? 0 : Number(row.game_fee || 0)),
      mileage:
        sum.mileage +
        (row.payment_status === "void"
          ? 0
          : Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0)),
      total: sum.total + total(row),
    }),
    { fees: 0, mileage: 0, total: 0 },
  );

  async function save(row: PayrollRow) {
    setSaving(row.id);
    setError("");
    setNotice("");
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
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
    };
    const { error: saveError } = await supabase
      .from("assignments")
      .update(payload)
      .eq("id", row.id);
    if (saveError) setError(saveError.message);
    else {
      setNotice("Payroll record saved.");
      await load();
    }
    setSaving("");
  }

  async function bulkStatus(status: PayrollRow["payment_status"]) {
    if (!selected.length) return;
    setSaving("bulk");
    setError("");
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("assignments")
      .update({
        payment_status: status,
        paid_at: status === "paid" ? now : null,
        payroll_updated_at: now,
        payroll_updated_by: userData.user?.id || null,
      })
      .in("id", selected);
    if (updateError) setError(updateError.message);
    else {
      setNotice(`${selected.length} payroll records marked ${status}.`);
      setSelected([]);
      await load();
    }
    setSaving("");
  }

  async function exportPayroll() {
    const exportRows = selectedRows.length ? selectedRows : visible;
    if (!exportRows.length) {
      setError("There are no payroll records to export.");
      return;
    }
    const XLSX = await import("xlsx");
    const data: PayrollExportRow[] = exportRows.map((row) => ({
      Date: row.games
        ? new Date(row.games.starts_at).toLocaleDateString("en-US")
        : "",
      "Game Number": row.games?.game_number || "",
      Game: `${row.games?.home?.name || "TBD"} vs ${row.games?.away?.name || "TBD"}`,
      Location: row.games?.location?.name || "",
      Official:
        `${row.officials?.first_name || ""} ${row.officials?.last_name || ""}`.trim(),
      Position: row.sport_positions?.name || "Official",
      "Game Fee": Number(row.game_fee || 0),
      "Mileage Miles": Number(row.mileage_miles || 0),
      "Mileage Rate": Number(row.mileage_rate || 0),
      "Mileage Reimbursement":
        Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0),
      "Payroll Total": total(row),
      "Payment Status": row.payment_status,
      "Paid Date": row.paid_at
        ? new Date(row.paid_at).toLocaleDateString("en-US")
        : "",
      Notes: row.payroll_notes || "",
    }));
    data.push({
      Date: "TOTAL",
      "Game Number": "",
      Game: "",
      Location: "",
      Official: "",
      Position: "",
      "Game Fee": data.reduce((sum, row) => sum + Number(row["Game Fee"]), 0),
      "Mileage Miles": data.reduce(
        (sum, row) => sum + Number(row["Mileage Miles"]),
        0,
      ),
      "Mileage Rate": 0,
      "Mileage Reimbursement": data.reduce(
        (sum, row) => sum + Number(row["Mileage Reimbursement"]),
        0,
      ),
      "Payroll Total": data.reduce(
        (sum, row) => sum + Number(row["Payroll Total"]),
        0,
      ),
      "Payment Status": "",
      "Paid Date": "",
      Notes: "",
    });
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet["!cols"] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 32 },
      { wch: 24 },
      { wch: 24 },
      { wch: 20 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 22 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 28 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Payroll");
    XLSX.writeFile(workbook, `refassign-payroll-${month || "all"}.xlsx`);
  }

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Payroll & Game Fees</h2>
          <p>
            Track position fees, mileage reimbursement, and payment status for
            every assignment.
          </p>
        </div>
        <button
          className="primary"
          type="button"
          onClick={() => void exportPayroll()}
        >
          Export {selectedRows.length ? "Selected" : "Payroll"}
        </button>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      <div className="formGrid payrollFilters">
        <label>
          Game Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
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
          <button
            className="secondary"
            disabled={saving === "bulk"}
            onClick={() => setSelected([])}
          >
            Clear
          </button>
        </div>
      )}
      {loading ? (
        <p>Loading payroll…</p>
      ) : (
        <div className="tableWrap">
          <table className="payrollTable">
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
                <th>Game / Official</th>
                <th>Position</th>
                <th>Game Fee</th>
                <th>Miles</th>
                <th>Rate</th>
                <th>Mileage Pay</th>
                <th>Total</th>
                <th>Status</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? (
                visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select payroll record for ${row.officials?.first_name || "official"}`}
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
                      <b>
                        {row.games?.home?.name || "TBD"} vs{" "}
                        {row.games?.away?.name || "TBD"}
                      </b>
                      <small>
                        {row.games
                          ? new Date(row.games.starts_at).toLocaleString()
                          : ""}{" "}
                        • {row.games?.game_number}
                      </small>
                      <small>
                        {row.officials?.first_name} {row.officials?.last_name}
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
                      <input
                        aria-label="Mileage miles"
                        type="number"
                        min="0"
                        step="0.1"
                        value={row.mileage_miles}
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
                        value={row.mileage_rate}
                        onChange={(event) =>
                          patch(row.id, {
                            mileage_rate: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      {money(
                        Number(row.mileage_miles || 0) *
                          Number(row.mileage_rate || 0),
                      )}
                    </td>
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
                              .value as PayrollRow["payment_status"],
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
                ))
              ) : (
                <tr>
                  <td colSpan={11}>No payroll records match these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
