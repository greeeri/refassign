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
  stripe_payment_status: string;
  stripe_payment_ready: boolean;
  officials: {
    id: string;
    first_name: string;
    last_name: string;
    home_latitude: number | null;
    home_longitude: number | null;
  } | null;
  sport_positions: { name: string } | null;
  games: {
    id: string;
    game_number: string;
    starts_at: string;
    bill_to_id: string | null;
    bill_to: { name: string } | null;
    leagues: { id: string; name: string; mileage_plan: MileagePlan } | null;
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
type BillTo = { id: string; name: string };
type PayrollBatch = { id:string;batch_number:number;status:string;payroll_subtotal_cents:number;stripe_processing_cost_cents:number;stripe_processing_cost_actual_cents:number|null;refassign_fee_cents:number;total_funding_cents:number;funding_method:string|null;stripe_checkout_session_id:string|null;funding_failure_message:string|null;created_at:string;paid_at:string|null;leagues:{name:string}|null;items:Array<{id:string;official_name_snapshot:string;total_cents:number;transfer:{status:string;stripe_transfer_id:string|null;failure_message:string|null;paid_at:string|null}|null}> };

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
    (item) =>
      item.official_id === row.officials?.id && item.weekday === weekday,
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

export default function PayrollManager({
  organizationId,
  focusAssignmentId,
}: {
  organizationId?: string;
  focusAssignmentId?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const geocodeBackfillOrganization = useRef("");
  const handledReportFocus = useRef("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [billTos, setBillTos] = useState<BillTo[]>([]);
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [canManageBillTos, setCanManageBillTos] = useState(false);
  const [newBillToName, setNewBillToName] = useState("");
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
      const query = organizationId
        ? `?organizationId=${encodeURIComponent(organizationId)}`
        : "";
      const [response, billToResponse, batchResponse] = await Promise.all([
        fetch(`/api/payroll${query}`, { cache: "no-store" }),
        fetch(`/api/bill-tos${query}`, { cache: "no-store" }),
        fetch(`/api/payroll/batches${query}`, { cache: "no-store" }),
      ]);
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
      if (billToResponse.ok) {
        const billToResult = (await billToResponse.json()) as {
          billTos?: BillTo[];
          canManageBillTos?: boolean;
        };
        setBillTos(billToResult.billTos || []);
        setCanManageBillTos(Boolean(billToResult.canManageBillTos));
      }
      if (batchResponse.ok) {
        const batchResult = await batchResponse.json() as { batches?: PayrollBatch[] };
        const loadedBatches=batchResult.batches||[];
        setBatches(loadedBatches);
        const pending=loadedBatches.find(batch=>batch.status==="funding"&&batch.stripe_checkout_session_id);
        if(pending?.stripe_checkout_session_id){const confirmation=await fetch(`/api/payroll/confirm${query}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:pending.stripe_checkout_session_id})}),confirmed=await confirmation.json() as {settled?:boolean;paidCount?:number;error?:string};if(confirmation.ok&&confirmed.settled){setNotice(`Batch ${pending.batch_number} settled and ${confirmed.paidCount||0} official${confirmed.paidCount===1?" was":"s were"} paid.`);window.setTimeout(()=>void load(),0);}else if(!confirmation.ok)setError(confirmed.error||"Payroll funding could not be confirmed.");}
      }
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
    if (
      !organizationId ||
      geocodeBackfillOrganization.current === organizationId
    )
      return;
    geocodeBackfillOrganization.current = organizationId;
    void (async () => {
      await load();
      try {
        const query = organizationId
          ? `?organizationId=${encodeURIComponent(organizationId)}`
          : "";
        const response = await fetch(`/api/geocode/backfill${query}`, {
          method: "POST",
        });
        const result = (await response.json()) as {
          updated?: number;
          failed?: number;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Address backfill failed.");
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
  }, [organizationId]);
  useEffect(() => {
    if (
      !focusAssignmentId ||
      handledReportFocus.current === focusAssignmentId ||
      !rows.some((row) => row.id === focusAssignmentId)
    )
      return;
    handledReportFocus.current = focusAssignmentId;
    setPeriod("all");
    setStatusFilter("all");
    setSelected([focusAssignmentId]);
    window.setTimeout(
      () =>
        document
          .getElementById(`payroll-row-${focusAssignmentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }, [focusAssignmentId, rows]);
  useEffect(() => {
    if (!organizationId) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("payroll") !== "success" || !sessionId) return;
    void (async () => {
      setSaving("stripe-payroll");
      const response = await fetch(`/api/payroll/confirm?organizationId=${encodeURIComponent(organizationId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const result = await response.json() as { settled?: boolean; paidCount?: number; error?: string };
      if (!response.ok) setError(result.error || "Payroll funding could not be confirmed.");
      else if (result.settled) setNotice(`League funding settled and ${result.paidCount || 0} official${result.paidCount === 1 ? " was" : "s were"} paid.`);
      else setNotice("League funding is pending. Officials will be paid automatically after Stripe settles it.");
      window.history.replaceState({}, "", window.location.pathname);
      await load();
      setSaving("");
    })();
  }, [organizationId]);

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
    const response = await fetch(
      `/api/payroll?organizationId=${encodeURIComponent(organizationId || "")}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: row.id,
          billToId: row.games?.bill_to_id || null,
          gameFee: Number(row.game_fee || 0),
          mileageMiles: Number(row.mileage_miles || 0),
          mileageRate: Number(row.mileage_rate || 0),
          paymentStatus: row.payment_status,
          payrollNotes: row.payroll_notes?.trim() || null,
        }),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      setError(result.error || "Payroll record could not be saved.");
    else {
      setNotice("Payroll record saved.");
      await load();
    }
    setSaving("");
  }

  function patchGameBillTo(gameId: string, billToId: string) {
    setRows((current) =>
      current.map((row) =>
        row.games?.id === gameId
          ? {
              ...row,
              games: {
                ...row.games,
                bill_to_id: billToId || null,
                bill_to: billToId
                  ? {
                      name:
                        billTos.find((billTo) => billTo.id === billToId)
                          ?.name || "",
                    }
                  : null,
              },
            }
          : row,
      ),
    );
  }

  async function addBillTo() {
    const name = newBillToName.trim();
    if (!name || !organizationId) return;
    setSaving("bill-to");
    setError("");
    const response = await fetch(
      `/api/bill-tos?organizationId=${encodeURIComponent(organizationId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    const result = (await response.json()) as {
      billTo?: BillTo;
      error?: string;
    };
    if (!response.ok || !result.billTo)
      setError(result.error || "Bill To could not be added.");
    else {
      setBillTos((current) =>
        [...current, result.billTo!].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setNewBillToName("");
      setNotice(`${result.billTo.name} added to Bill To options.`);
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

  async function processStripePayroll() {
    if (!selectedRows.length || !organizationId) return;
    if (selectedRows.some((row) => row.payment_status !== "approved")) {
      return setError("Mark every selected payroll record Approved before sending it through Stripe.");
    }
    const leagueIds = new Set(selectedRows.map((row) => row.games?.leagues?.id).filter(Boolean));
    if (leagueIds.size !== 1) return setError("Select payroll records from one league at a time.");
    setSaving("stripe-payroll");
    setError("");
    setNotice("");
    const response = await fetch(`/api/payroll/process?organizationId=${encodeURIComponent(organizationId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentIds: selectedRows.map((row) => row.id) }),
    });
    const result = await response.json() as { error?: string; url?: string; paid?: boolean; batchNumber?: number };
    if (!response.ok) setError(result.error || "Stripe payroll could not be processed.");
    else if (result.url) window.location.assign(result.url);
    else {
      setNotice(result.paid ? "This payroll batch was already paid." : `Payroll funding started for batch ${result.batchNumber}.`);
      setSelected([]);
      await load();
    }
    setSaving("");
  }

  async function retryPayrollBatch(batchId: string) {
    if (!organizationId) return;
    setSaving(`retry-${batchId}`);setError("");
    const response=await fetch(`/api/payroll/batches?organizationId=${encodeURIComponent(organizationId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batchId})});
    const result=await response.json() as {error?:string};
    if(!response.ok)setError(result.error||"Payroll retry failed.");else{setNotice("The remaining official transfers were completed.");await load();}
    setSaving("");
  }

  function downloadReconciliation(batch: PayrollBatch) {
    const headings=["Batch","League","Status","Official","Official Amount","Transfer Status","Stripe Transfer ID","Payroll Subtotal","RefAssign Fee","Estimated Stripe Fee","Actual Stripe Fee","League Funding","Paid At"];
    const quote=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
    const rows=batch.items.map(item=>[batch.batch_number,batch.leagues?.name||"",batch.status,item.official_name_snapshot,(item.total_cents/100).toFixed(2),item.transfer?.status||"pending",item.transfer?.stripe_transfer_id||"",(batch.payroll_subtotal_cents/100).toFixed(2),(batch.refassign_fee_cents/100).toFixed(2),(batch.stripe_processing_cost_cents/100).toFixed(2),batch.stripe_processing_cost_actual_cents==null?"":(batch.stripe_processing_cost_actual_cents/100).toFixed(2),(batch.total_funding_cents/100).toFixed(2),batch.paid_at||""]);
    const blob=new Blob([[headings,...rows].map(row=>row.map(quote).join(",")).join("\n")],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`payroll-batch-${batch.batch_number}-reconciliation.csv`;link.click();URL.revokeObjectURL(url);
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
      League: row.games?.leagues?.name || "",
      Game: gameName(row),
      Location: row.games?.location?.name || "",
      "Bill To": row.games?.bill_to?.name || "",
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
      { wch: 20 },
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
          organization_id: organizationId,
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
      {canManageBillTos && (
        <div className="formGrid payrollFilters">
          <label>
            Add Bill To
            <span style={{ display: "flex", gap: 8 }}>
              <input
                value={newBillToName}
                placeholder="Organization or customer name"
                onChange={(event) => setNewBillToName(event.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={saving === "bill-to" || !newBillToName.trim()}
                onClick={() => void addBillTo()}
              >
                {saving === "bill-to" ? "Adding…" : "Add"}
              </button>
            </span>
          </label>
        </div>
      )}
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
        <div>
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
            Mark Paid Outside Stripe
          </button>
          <button
            className="success"
            disabled={saving === "stripe-payroll" || selectedRows.some((row) => row.payment_status !== "approved")}
            onClick={() => void processStripePayroll()}
          >
            {saving === "stripe-payroll" ? "Opening Stripe Checkout…" : "Fund & Pay with Stripe"}
          </button>
          <button className="secondary" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
        {error && <div className="errorBox" style={{ marginTop: 8 }}>{error}</div>}
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
                      visible.some((row) => row.stripe_payment_ready) &&
                      visible.filter((row) => row.stripe_payment_ready).every((row) => selected.includes(row.id))
                    }
                    onChange={() =>
                      setSelected(
                        visible.filter((row) => row.stripe_payment_ready).every((row) => selected.includes(row.id))
                          ? selected.filter(
                              (id) => !visible.some((row) => row.id === id),
                            )
                          : Array.from(
                              new Set([
                                ...selected,
                                ...visible.filter((row) => row.stripe_payment_ready).map((row) => row.id),
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
                <th>Bill To</th>
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
                    <tr
                      id={`payroll-row-${row.id}`}
                      className={
                        focusAssignmentId === row.id
                          ? "reportActionFocus"
                          : undefined
                      }
                      key={row.id}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select payroll record for ${officialName(row)}`}
                          checked={selected.includes(row.id)}
                          disabled={!row.stripe_payment_ready}
                          title={!row.stripe_payment_ready ? "Official must complete Stripe payment setup before payroll." : undefined}
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
                        <small>{row.stripe_payment_ready ? "Stripe ready" : `Stripe: ${row.stripe_payment_status.replaceAll("_", " ")}`}</small>
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
                      <td>
                        <select
                          aria-label={`Bill To for game ${row.games?.game_number || ""}`}
                          value={row.games?.bill_to_id || ""}
                          onChange={(event) =>
                            row.games &&
                            patchGameBillTo(row.games.id, event.target.value)
                          }
                        >
                          <option value="">Not selected</option>
                          {billTos.map((billTo) => (
                            <option key={billTo.id} value={billTo.id}>
                              {billTo.name}
                            </option>
                          ))}
                        </select>
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
                  <td colSpan={16}>
                    No accepted payroll records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="payrollBatchHistory">
        <div className="cardHead"><div><h3>Stripe Payroll History</h3><p>League funding, Stripe costs, and official transfer reconciliation.</p></div></div>
        {batches.length===0?<p>No Stripe payroll batches yet.</p>:batches.map(batch=><details key={batch.id} className="registrationReview"><summary><b>Batch {batch.batch_number}</b> · {batch.leagues?.name||"League"} · <span className={`badge ${batch.status==="paid"?"green":batch.status.includes("failed")||batch.status==="returned"?"red":"yellow"}`}>{batch.status.replaceAll("_"," ")}</span> · ${(batch.total_funding_cents/100).toFixed(2)}</summary><div className="tableWrap"><table><thead><tr><th>Official</th><th>Amount</th><th>Transfer</th><th>Stripe ID</th></tr></thead><tbody>{batch.items.map(item=><tr key={item.id}><td>{item.official_name_snapshot}</td><td>{money(item.total_cents/100)}</td><td>{item.transfer?.status||"pending"}</td><td><small>{item.transfer?.stripe_transfer_id||item.transfer?.failure_message||"—"}</small></td></tr>)}</tbody></table></div><p>Payroll {money(batch.payroll_subtotal_cents/100)} · RefAssign fee {money(batch.refassign_fee_cents/100)} · Estimated Stripe cost {money(batch.stripe_processing_cost_cents/100)} · Actual Stripe cost {batch.stripe_processing_cost_actual_cents==null?"Pending":money(batch.stripe_processing_cost_actual_cents/100)}</p>{batch.funding_failure_message&&<div className="errorBox">{batch.funding_failure_message}</div>}<div className="headerActions"><button className="secondary" onClick={()=>downloadReconciliation(batch)}>Download Reconciliation</button>{["partially_paid","on_hold"].includes(batch.status)&&!/(returned|refund|dispute)/i.test(batch.funding_failure_message||"")&&<button className="primary" disabled={saving===`retry-${batch.id}`} onClick={()=>void retryPayrollBatch(batch.id)}>{saving===`retry-${batch.id}`?"Retrying…":"Retry Failed Transfers"}</button>}</div></details>)}
      </div>
    </section>
  );
}
