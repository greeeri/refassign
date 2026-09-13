"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

const COLUMNS = [
  ["USSF-ID", "ussf_id"],
  ["First name", "first_name"],
  ["Last name", "last_name"],
  ["DOB", "date_of_birth"],
  ["is a minor", "is_minor"],
  ["Gender", "gender"],
  ["Ethnicity", "ethnicity"],
  ["Email", "email"],
  ["Secondary email", "secondary_email"],
  ["Address", "home_address"],
  ["Apt/suite/unit", "address_unit"],
  ["City", "home_city"],
  ["State", "home_state"],
  ["Zip", "home_zip"],
  ["Country", "country"],
  ["Phone", "phone"],
  ["Mobile phone", "mobile_phone"],
  ["License", "license"],
  ["Status", "license_status"],
  ["Issue date", "license_issue_date"],
  ["Expiration date", "license_expiration_date"],
  ["Issuer", "license_issuer"],
  ["Curriculum", "curriculum"],
  ["Background screening", "background_screening"],
  [
    "Background screening expiration date",
    "background_screening_expiration_date",
  ],
  ["SafeSport", "safesport"],
  ["SafeSport expiration date", "safesport_expiration_date"],
  ["Intro to Player Safety", "intro_player_safety"],
  [
    "Intro to Player Safety expiration date",
    "intro_player_safety_expiration_date",
  ],
  ["Safe Soccer", "safe_soccer"],
  ["Safe Soccer expiration date", "safe_soccer_expiration_date"],
  ["Provisional Status", "provisional_status"],
  ["Referee years exp", "referee_years_experience"],
  ["Sport(s)", "sports"],
  ["Home area", "home_area"],
  ["Certification level", "certification_level"],
  ["College license level", "college_license_level"],
  ["High school license level", "high_school_license_level"],
  ["US Soccer license level", "us_soccer_license_level"],
  ["Active in organization", "organization_active"],
  ["Max games per day", "max_games_per_day"],
  ["Eligible leagues", "eligible_leagues"],
  ["Eligible levels", "eligible_levels"],
  ["General rank", "general_rank"],
  ["REF rank", "ref_rank"],
  ["AR1 rank", "ar1_rank"],
  ["AR2 rank", "ar2_rank"],
  ["Fourth official rank", "fourth_rank"],
  ["Mentor certified", "mentor_certified"],
  ["Internal notes", "notes"],
] as const;
type Key = (typeof COLUMNS)[number][1];
type Official = { id: string } & Record<
  Exclude<Key, "ussf_id">,
  string | number | boolean | null
>;
type Row = Record<Key, string> & {
  row: number;
  id: string;
  action: "Add" | "Update";
  valid: boolean;
  issue: string;
};
const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
const aliases: Record<string, Key> = Object.fromEntries(
  COLUMNS.flatMap(([label, key]) => [
    [normalize(label), key],
    [normalize(key), key],
  ]),
) as Record<string, Key>;
const esc = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const dateValue = (value: unknown) => (value ? String(value).slice(0, 10) : "");
const booleanValue = (value: string) =>
  ["true", "yes", "1", "y"].includes(value.trim().toLowerCase());
const booleanValid = (value: string) =>
  !value.trim() ||
  ["true", "false", "yes", "no", "1", "0", "y", "n"].includes(
    value.trim().toLowerCase(),
  );
const listValue = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : String(value ?? "");
const splitList = (value: string) =>
  value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function normalizeDate(value: string) {
  const input = value.trim();
  if (!input) return "";
  const isoMatch = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const usMatch = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (isoMatch) {
    [, year, month, day] = isoMatch.map(Number);
  } else if (usMatch) {
    month = Number(usMatch[1]);
    day = Number(usMatch[2]);
    year = Number(usMatch[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
  } else if (/^\d+(\.\d+)?$/.test(input)) {
    const serial = Number(input);
    if (serial < 1 || serial > 2958465) return null;
    const date = new Date(
      Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000,
    );
    return date.toISOString().slice(0, 10);
  } else {
    const timestamp = Date.parse(input);
    if (Number.isNaN(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function OfficialsRosterManager({
  organizationId,
}: {
  organizationId?: string;
}) {
  const supabase = useMemo(() => createClient(), []),
    [allowed, setAllowed] = useState(false),
    [officials, setOfficials] = useState<Official[]>([]),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [importing, setImporting] = useState(false);
  async function load() {
    setError("");
    if (!organizationId) {
      setAllowed(false);
      setOfficials([]);
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: memberships }, { data: isSuperAdmin }] = await Promise.all([
      supabase
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", u.user.id),
      supabase.rpc("is_super_admin"),
    ]);
    const ok =
      Boolean(isSuperAdmin) ||
      (memberships || []).some((m) =>
        ["owner", "admin", "assignor"].includes(m.role),
      );
    setAllowed(ok);
    if (!ok) return;
    const allOfficials: Official[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const result = await supabase
        .rpc("get_organization_official_directory", {
          p_organization_id: organizationId,
        })
        .range(from, from + pageSize - 1);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const page = (result.data || []) as Official[];
      allOfficials.push(...page);
      if (page.length < pageSize) break;
    }
    setOfficials(allOfficials);
  }
  useEffect(() => {
    void load();
  }, [organizationId]);
  function downloadCSV(filename: string, lines: string[]) {
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], {
        type: "text/csv;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function downloadTemplate() {
    downloadCSV("refassign-referee-upload-template.csv", [
      COLUMNS.map(([label]) => esc(label)).join(","),
    ]);
  }
  function downloadCurrent() {
    const head = COLUMNS.map(([label]) => esc(label)).join(","),
      lines = officials.map((o) =>
        COLUMNS.map(([, key]) =>
          esc(
            key === "ussf_id"
              ? o.id
              : key === "date_of_birth" || key.includes("date")
                ? dateValue(o[key])
                : key === "sports"
                  ? listValue(o[key])
                  : o[key],
          ),
        ).join(","),
      );
    downloadCSV("refassign-current-referee-roster.csv", [head, ...lines]);
  }
  function validate(raw: string[][]): Row[] {
    if (!raw.length) throw new Error("Import file is empty.");
    const header = raw[0].map((cell) => aliases[normalize(String(cell))]);
    const missing = COLUMNS.filter(([, key]) => !header.includes(key)).map(
      ([label]) => label,
    );
    if (missing.length)
      throw new Error(`Missing column(s): ${missing.join(", ")}`);
    return raw.slice(1).map((values, index) => {
      const record = Object.fromEntries(
          COLUMNS.map(([, key]) => [
            key,
            String(values[header.indexOf(key)] ?? "").trim(),
          ]),
        ) as Record<Key, string>,
        issues: string[] = [];
      if (!record.first_name) issues.push("First name is required");
      if (!record.last_name) issues.push("Last name is required");
      if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email))
        issues.push("Email is invalid");
      if (
        record.secondary_email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.secondary_email)
      )
        issues.push("Secondary email is invalid");
      for (const key of [
        "is_minor",
        "organization_active",
        "mentor_certified",
      ] as Key[]) {
        if (!booleanValid(record[key]))
          issues.push(
            `${COLUMNS.find(([, k]) => k === key)?.[0]} must be true or false`,
          );
      }
      for (const [, key] of COLUMNS.filter(
        ([, key]) => key === "date_of_birth" || key.includes("date"),
      )) {
        const normalizedDate = normalizeDate(record[key]);
        if (normalizedDate === null)
          issues.push(
            `${COLUMNS.find(([, k]) => k === key)?.[0]} is not a valid date`,
          );
        else record[key] = normalizedDate;
      }
      if (
        record.referee_years_experience &&
        (!Number.isInteger(Number(record.referee_years_experience)) ||
          Number(record.referee_years_experience) < 0)
      )
        issues.push("Referee years exp must be zero or greater");
      if (
        record.max_games_per_day &&
        (!Number.isInteger(Number(record.max_games_per_day)) ||
          Number(record.max_games_per_day) < 1)
      )
        issues.push("Max games per day must be a whole number of at least 1");
      for (const key of [
        "general_rank",
        "ref_rank",
        "ar1_rank",
        "ar2_rank",
        "fourth_rank",
      ] as Key[]) {
        if (
          record[key] &&
          (Number(record[key]) < 1 ||
            Number(record[key]) > 10 ||
            !Number.isFinite(Number(record[key])))
        )
          issues.push(
            `${COLUMNS.find(([, k]) => k === key)?.[0]} must be between 1.0 and 10.0`,
          );
      }
      const id =
        record.ussf_id && officials.some((o) => o.id === record.ussf_id)
          ? record.ussf_id
          : officials.find(
              (o) =>
                String(o.email || "").toLowerCase() ===
                record.email.toLowerCase(),
            )?.id || "";
      return {
        ...record,
        row: index + 2,
        id,
        action: id ? "Update" : "Add",
        valid: !issues.length,
        issue: issues.join("; "),
      };
    });
  }
  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setRows([]);
    setMessage("");
    setError("");
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      let raw: string[][] | null = null;
      try {
        const XLSX = await import("xlsx"),
          workbook = XLSX.read(buffer, { type: "array", cellDates: true }),
          sheet = workbook.Sheets[workbook.SheetNames[0]];
        raw = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
          dateNF: "yyyy-mm-dd",
        }) as string[][];
      } catch {}
      if (!raw?.length) raw = parseCSV(new TextDecoder("utf-8").decode(buffer));
      setRows(validate(raw));
    } catch (x) {
      setError(
        x instanceof Error ? x.message : "Unable to read referee profile file.",
      );
    } finally {
      event.target.value = "";
    }
  }
  async function applyImport() {
    if (!organizationId || !rows.length || rows.some((r) => !r.valid)) return;
    setImporting(true);
    setError("");
    let added = 0,
      updated = 0;
    try {
      for (const row of rows) {
        const nullable = (key: Key) => row[key] || null,
          num = (key: Key) => (row[key] ? Number(row[key]) : null);
        const { data, error: rowError } = await supabase.rpc(
          "upsert_my_referee_profile_row",
          {
            p_organization_id: organizationId,
            p_ussf_id: nullable("ussf_id"),
            p_first_name: row.first_name,
            p_last_name: row.last_name,
            p_date_of_birth: nullable("date_of_birth"),
            p_is_minor: booleanValue(row.is_minor),
            p_gender: nullable("gender"),
            p_ethnicity: nullable("ethnicity"),
            p_email: nullable("email"),
            p_secondary_email: nullable("secondary_email"),
            p_address: nullable("home_address"),
            p_address_unit: nullable("address_unit"),
            p_city: nullable("home_city"),
            p_state: nullable("home_state"),
            p_zip: nullable("home_zip"),
            p_country: nullable("country"),
            p_phone: nullable("phone"),
            p_mobile_phone: nullable("mobile_phone"),
            p_license: nullable("license"),
            p_status: nullable("license_status"),
            p_issue_date: nullable("license_issue_date"),
            p_expiration_date: nullable("license_expiration_date"),
            p_issuer: nullable("license_issuer"),
            p_curriculum: nullable("curriculum"),
            p_background_screening: nullable("background_screening"),
            p_background_screening_expiration_date: nullable(
              "background_screening_expiration_date",
            ),
            p_safesport: nullable("safesport"),
            p_safesport_expiration_date: nullable("safesport_expiration_date"),
            p_intro_player_safety: nullable("intro_player_safety"),
            p_intro_player_safety_expiration_date: nullable(
              "intro_player_safety_expiration_date",
            ),
            p_safe_soccer: nullable("safe_soccer"),
            p_safe_soccer_expiration_date: nullable(
              "safe_soccer_expiration_date",
            ),
            p_provisional_status: nullable("provisional_status"),
            p_referee_years_experience: num("referee_years_experience"),
            p_sports: splitList(row.sports),
            p_home_area: nullable("home_area"),
            p_certification_level: nullable("certification_level"),
            p_college_license_level: nullable("college_license_level"),
            p_high_school_license_level: nullable("high_school_license_level"),
            p_us_soccer_license_level: nullable("us_soccer_license_level"),
            p_organization_active: row.organization_active.trim()
              ? booleanValue(row.organization_active)
              : true,
            p_max_games_per_day: num("max_games_per_day"),
            p_eligible_leagues: splitList(row.eligible_leagues),
            p_eligible_levels: splitList(row.eligible_levels),
            p_general_rank: num("general_rank"),
            p_ref_rank: num("ref_rank"),
            p_ar1_rank: num("ar1_rank"),
            p_ar2_rank: num("ar2_rank"),
            p_fourth_rank: num("fourth_rank"),
            p_mentor_certified: booleanValue(row.mentor_certified),
            p_notes: nullable("notes"),
          },
        );
        if (rowError)
          throw new Error(
            `Row ${row.row} (${row.first_name} ${row.last_name}): ${rowError.message}`,
          );
        const result = Array.isArray(data) ? data[0] : data;
        if (result?.result_action === "Add") added++;
        else updated++;
      }
      setMessage(`Import complete: ${updated} updated, ${added} added.`);
      setRows([]);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Roster import failed");
    } finally {
      setImporting(false);
    }
  }
  if (!allowed)
    return (
      <section className="card">
        <h2>Roster Import / Export</h2>
        <p>
          Only Administrators and Assignors can use the master roster uploader.
        </p>
      </section>
    );
  const invalid = rows.filter((row) => !row.valid).length;
  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Referee Profile Import / Export</h2>
          <p>
            Download the current roster to update existing officials, or
            download a blank template to add officials.
          </p>
        </div>
      </div>
      <div className="headerActions">
        <button type="button" className="secondary" onClick={downloadCurrent}>
          Download Current Roster ({officials.length})
        </button>
        <button type="button" className="secondary" onClick={downloadTemplate}>
          Download Blank Upload Template
        </button>
      </div>
      <label>
        <b>Upload completed roster or template</b>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
      </label>
      <p>
        <small>
          USSF-ID is the existing RefAssign referee ID. Keep it when updating an
          official; leave it blank when adding a new official. All{" "}
          {COLUMNS.length} columns must remain in the exported order. Dates use
          YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY, and Excel date values are accepted.
          Rankings belong only to the signed-in assignor.
        </small>
      </p>
      {error && <div className="errorBox">{error}</div>}
      {message && <div className="loginMessage">{message}</div>}
      {rows.length > 0 && (
        <>
          <p>
            {rows.length} rows •{" "}
            {rows.filter((r) => r.action === "Update").length} updates •{" "}
            {rows.filter((r) => r.action === "Add").length} additions •{" "}
            {invalid} errors
          </p>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Action</th>
                  <th>USSF-ID</th>
                  <th>Referee</th>
                  <th>Email</th>
                  <th>License</th>
                  <th>Status</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.action}</td>
                    <td>{row.ussf_id || "New"}</td>
                    <td>
                      <b>
                        {row.first_name} {row.last_name}
                      </b>
                    </td>
                    <td>{row.email}</td>
                    <td>{row.license}</td>
                    <td>{row.license_status}</td>
                    <td>
                      <span className={`badge ${row.valid ? "green" : "red"}`}>
                        {row.valid ? "Ready" : row.issue}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary"
            disabled={importing || invalid > 0}
            onClick={() => void applyImport()}
          >
            {importing ? "Updating Referees…" : "Apply Referee Changes"}
          </button>
        </>
      )}
    </section>
  );
}
