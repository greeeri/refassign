"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Named = { id: string; name: string };
type Sport = Named & { default_officials: number };
type Team = Named & { level_id: string | null; sport_id: string | null };
type Location = Named & { city: string | null; state: string | null };
type Game = {
  id: string;
  game_number: string;
  status: string;
  sport_id: string;
  league_id: string | null;
  level_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  location_id: string | null;
  starts_at: string;
  duration_minutes: number;
  officials_needed: number;
  notes: string | null;
  sports: { name: string } | null;
  leagues: { name: string } | null;
  levels: { name: string } | null;
  home: { name: string } | null;
  away: { name: string } | null;
  location: Location | null;
};
type Row = {
  row: number;
  game_number: string;
  sport: string;
  league: string;
  level: string;
  home_team: string;
  away_team: string;
  date: string;
  time: string;
  location: string;
  duration_minutes: number;
  officials_needed: number;
  notes: string;
  valid: boolean;
  issue: string;
  action: "add" | "update" | "skip" | "error";
  changes: string;
};
type Range = "all" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "custom";
const statusOptions = [
  ["active", "Active"],
  ["suspended", "Hold"],
  ["canceled", "Cancelled"],
  ["rained_out", "Rain Out"],
] as const;
function statusColors(value: string) {
  const status = value === "open" ? "active" : value;
  if (status === "canceled") return { background: "#fee2e2", color: "#172033" };
  if (status === "suspended") return { background: "#fef9c3", color: "#172033" };
  if (status === "rained_out") return { background: "#1e3a8a", color: "#fff" };
  return { background: "#fff", color: "#172033" };
}
const blank = {
  game_number: "",
  sport_id: "",
  league_id: "",
  level_id: "",
  home_team_id: "",
  away_team_id: "",
  location_id: "",
  date: "",
  time: "",
  duration_minutes: 110,
  officials_needed: 3,
  notes: "",
};
const req = [
  "game_number",
  "sport",
  "league",
  "level",
  "home_team",
  "away_team",
  "date",
  "time",
  "location",
  "duration_minutes",
  "officials_needed",
  "notes",
];
const pad = (n: number) => String(n).padStart(2, "0");
const norm = (s: string) => s.trim().toLowerCase();
function excelDateParts(value: number) {
  if (!Number.isFinite(value)) return null;
  const wholeDays = Math.floor(value);
  const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86_400_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}
function dateVal(value: unknown) {
  if (typeof value === "number") {
    const parts = excelDateParts(value);
    return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : null;
  }
  let v = String(value || "").trim();
  let m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = v.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/);
  if (m) {
    const months: Record<string, number> = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12,
      },
      mo = months[m[2].toLowerCase()];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo && +m[1] >= 1 && +m[1] <= 31) return `${y}-${pad(mo)}-${pad(+m[1])}`;
  }
  return null;
}
function timeVal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
    return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
  }
  let v = String(value || "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(
      /\s+(?:CST|CDT|EST|EDT|MST|MDT|PST|PDT)(?:\s+(?:CST|CDT|EST|EDT|MST|MDT|PST|PDT))*\s*$/i,
      "",
    )
    .replace(/\b([AP])\.M\.?$/i, "$1M")
    .trim();
  let m = v.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*([AP]M)$/i);
  if (m) {
    let h = +m[1],
      mi = +(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    if (m[3].toUpperCase() === "PM" && h < 12) h += 12;
    if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
    return `${pad(h)}:${pad(mi)}`;
  }
  m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${pad(+m[1])}:${m[2]}`;
}
function startDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startWeek(d: Date) {
  const x = startDay(d),
    day = x.getDay();
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1));
  return x;
}
function inRange(g: Game, r: Range, customDate = "") {
  const t = new Date(g.starts_at);
  if (r === "all") return true;
  if (r === "custom") {
    if (!customDate) return false;
    const start = new Date(`${customDate}T00:00:00`),
      end = new Date(start);
    end.setDate(start.getDate() + 1);
    return t >= start && t < end;
  }
  const now = new Date(),
    today = startDay(now),
    tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const afterTomorrow = new Date(today);
  afterTomorrow.setDate(today.getDate() + 2);
  const week = startWeek(now),
    next = new Date(week);
  next.setDate(week.getDate() + 7);
  const afterNext = new Date(week);
  afterNext.setDate(week.getDate() + 14);
  if (r === "today") return t >= today && t < tomorrow;
  if (r === "tomorrow") return t >= tomorrow && t < afterTomorrow;
  if (r === "thisWeek") return t >= week && t < next;
  return t >= next && t < afterNext;
}
export default function GamesManagerV3() {
  const sb = useMemo(() => createClient(), []);
  const [games, setGames] = useState<Game[]>([]),
    [sports, setSports] = useState<Sport[]>([]),
    [leagues, setLeagues] = useState<Named[]>([]),
    [levels, setLevels] = useState<Named[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [locations, setLocations] = useState<Location[]>([]),
    [form, setForm] = useState(blank),
    [editing, setEditing] = useState<string | null>(null),
    [show, setShow] = useState(false),
    [showImport, setShowImport] = useState(false),
    [rows, setRows] = useState<Row[]>([]),
    [range, setRange] = useState<Range>("all"),
    [customDate, setCustomDate] = useState(""),
    [showCalendar, setShowCalendar] = useState(false),
    [busy, setBusy] = useState(false),
    [statusBusy, setStatusBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const [s, lg, lv, t, lo, g] = await Promise.all([
      sb
        .from("sports")
        .select("id,name,default_officials")
        .eq("active", true)
        .order("name"),
      sb.from("leagues").select("id,name").eq("active", true).order("name"),
      sb.from("levels").select("id,name").eq("active", true).order("name"),
      sb.from("teams").select("id,name,level_id,sport_id").order("name"),
      sb
        .from("locations")
        .select("id,name,city,state")
        .eq("active", true)
        .order("name"),
      sb
        .from("games")
        .select(
          "id,game_number,status,sport_id,league_id,level_id,home_team_id,away_team_id,location_id,starts_at,duration_minutes,officials_needed,notes,sports(name),leagues(name),levels(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(id,name,city,state)",
        )
        .order("starts_at"),
    ]);
    const e = s.error || lg.error || lv.error || t.error || lo.error || g.error;
    if (e) setError(e.message);
    else {
      setSports(s.data || []);
      setLeagues(lg.data || []);
      setLevels(lv.data || []);
      setTeams(t.data || []);
      setLocations(lo.data || []);
      setGames((g.data || []) as unknown as Game[]);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function changeStatus(id: string, status: string) {
    setStatusBusy(id);
    setError("");
    setMessage("");
    const { error: statusError } = await sb.rpc("set_game_status", {
      p_game_id: id,
      p_status: status,
    });
    if (statusError) setError(statusError.message);
    else {
      setGames((current) =>
        current.map((game) => (game.id === id ? { ...game, status } : game)),
      );
      setMessage("Game status updated.");
    }
    setStatusBusy("");
  }
  const filteredGames = games.filter((g) => inRange(g, range, customDate));
  const eligible = teams.filter(
    (t) => t.sport_id === form.sport_id && t.level_id === form.level_id,
  );
  function edit(g: Game) {
    const d = new Date(g.starts_at);
    setEditing(g.id);
    setForm({
      game_number: g.game_number,
      sport_id: g.sport_id,
      league_id: g.league_id || "",
      level_id: g.level_id || "",
      home_team_id: g.home_team_id || "",
      away_team_id: g.away_team_id || "",
      location_id: g.location_id || "",
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      duration_minutes: g.duration_minutes || 110,
      officials_needed: g.officials_needed,
      notes: g.notes || "",
    });
    setShow(true);
    setShowImport(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const lv = levels.find((x) => x.id === form.level_id);
    try {
      if (form.home_team_id === form.away_team_id)
        throw new Error("Home and away teams must be different.");
      const payload = {
        game_number: form.game_number.trim() || null,
        sport_id: form.sport_id,
        league_id: form.league_id,
        level_id: form.level_id,
        level: lv?.name || null,
        home_team_id: form.home_team_id,
        away_team_id: form.away_team_id,
        location_id: form.location_id,
        starts_at: new Date(`${form.date}T${form.time}:00`).toISOString(),
        duration_minutes: +form.duration_minutes || 110,
        officials_needed: +form.officials_needed,
        notes: form.notes.trim() || null,
      };
      const q = editing
        ? sb.from("games").update(payload).eq("id", editing)
        : sb.from("games").insert({ ...payload, status: "open" });
      const { error: e2 } = await q;
      if (e2) throw e2;
      setMessage(editing ? "Game updated." : "Game added.");
      setEditing(null);
      setForm(blank);
      setShow(false);
      await load();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save game");
    }
    setBusy(false);
  }
  async function exportGames() {
    const XLSX = await import("xlsx");
    const data = games.map((g) => {
      const d = new Date(g.starts_at);
      return {
        "Game Number": g.game_number,
        Sport: g.sports?.name || "",
        League: g.leagues?.name || "",
        Level: g.levels?.name || "",
        Home_Team: g.home?.name || "",
        Away_Team: g.away?.name || "",
        Date: d.toLocaleDateString("en-US"),
        Time: d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        Location: g.location?.name || "",
        Duration_Minutes: g.duration_minutes || 110,
        Officials_Needed: g.officials_needed,
        Notes: g.notes || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Games");
    XLSX.writeFile(wb, "refassign-games.xlsx");
  }
  function validate(raw: unknown[][]) {
    const h = raw[0].map((x) => norm(String(x)).replace(/\s+/g, "_"));
    const missing = req.filter((x) => !h.includes(x));
    if (missing.length)
      throw new Error(`Missing columns: ${missing.join(", ")}`);
    const validated: Row[] = raw.slice(1).map((r, i) => {
      const cell = (n: string) => r[h.indexOf(n)] ?? "",
        get = (n: string) => String(cell(n)).trim(),
        sport = get("sport"),
        league = get("league"),
        level = get("level"),
        home = get("home_team"),
        away = get("away_team"),
        location = get("location"),
        date = dateVal(cell("date")),
        time = timeVal(cell("time")),
        duration = Number(get("duration_minutes") || 110),
        officials = Number(get("officials_needed")),
        issues: string[] = [];
      if (!sports.some((x) => norm(x.name) === norm(sport)))
        issues.push("Sport not found");
      if (!leagues.some((x) => norm(x.name) === norm(league)))
        issues.push("League not found");
      if (!levels.some((x) => norm(x.name) === norm(level)))
        issues.push("Level not found");
      if (!locations.some((x) => norm(x.name) === norm(location)))
        issues.push("Location not found");
      if (!date) issues.push("Invalid date");
      if (!time) issues.push("Invalid time");
      if (home && away && norm(home) === norm(away))
        issues.push("Home and away teams must be different");
      if (!Number.isFinite(duration) || duration < 1)
        issues.push("Invalid duration");
      if (!Number.isFinite(officials) || officials < 1)
        issues.push("Invalid officials needed");
      return {
        row: i + 2,
        game_number: get("game_number").toUpperCase(),
        sport,
        league,
        level,
        home_team: home,
        away_team: away,
        date: date || "",
        time: time || "",
        location,
        duration_minutes: duration,
        officials_needed: officials,
        notes: get("notes"),
        valid: !issues.length,
        issue: issues.join("; "),
        action: issues.length ? "error" : "add",
        changes: issues.length ? issues.join("; ") : "New game",
      };
    });
    const schedulable = validated.map((row) => row.valid),
      addIssue = (row: Row, issue: string) => {
        row.valid = false;
        row.issue = row.issue ? `${row.issue}; ${issue}` : issue;
        row.action = "error";
        row.changes = row.issue;
      };
    for (let i = 0; i < validated.length; i++) {
      const a = validated[i];
      if (!schedulable[i]) continue;
      for (let j = i + 1; j < validated.length; j++) {
        const b = validated[j];
        if (!schedulable[j]) continue;
        if (
          a.game_number &&
          b.game_number &&
          norm(a.game_number) === norm(b.game_number)
        ) {
          addIssue(a, `Duplicate game number also appears on row ${b.row}`);
          addIssue(b, `Duplicate game number also appears on row ${a.row}`);
          continue;
        }
        const aStart = new Date(`${a.date}T${a.time}:00`).getTime(),
          bStart = new Date(`${b.date}T${b.time}:00`).getTime(),
          aEnd = aStart + a.duration_minutes * 60_000,
          bEnd = bStart + b.duration_minutes * 60_000;
        if (aStart >= bEnd || bStart >= aEnd) continue;
        const sameLocation = norm(a.location) === norm(b.location),
          teamKey = (row: Row, team: string) =>
            `${norm(row.sport)}|${norm(row.level)}|${norm(team)}`,
          aTeams = new Set([teamKey(a, a.home_team), teamKey(a, a.away_team)]),
          sharedTeam = [b.home_team, b.away_team].find((team) =>
            aTeams.has(teamKey(b, team)),
          );
        if (!sameLocation && !sharedTeam) continue;
        const reasons = [
            sameLocation ? `same location (${a.location})` : "",
            sharedTeam ? `same team (${sharedTeam})` : "",
          ]
            .filter(Boolean)
            .join(" and "),
          aMessage = `Conflicts with spreadsheet row ${b.row}, Game ${b.game_number || "NEW"} — ${reasons} at ${a.date} ${a.time}`,
          bMessage = `Conflicts with spreadsheet row ${a.row}, Game ${a.game_number || "NEW"} — ${reasons} at ${b.date} ${b.time}`;
        addIssue(a, aMessage);
        addIssue(b, bMessage);
      }
    }
    for (const row of validated) {
      if (!row.valid) continue;
      const existing = row.game_number
        ? games.find((game) => norm(game.game_number) === norm(row.game_number))
        : undefined;
      if (!existing) {
        row.action = "add";
        row.changes = "New game will be added";
        continue;
      }
      const currentDate = new Date(existing.starts_at),
        currentDateValue = `${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}`,
        currentTimeValue = `${pad(currentDate.getHours())}:${pad(currentDate.getMinutes())}`,
        changes: string[] = [],
        compare = (label: string, before: string | number, after: string | number) => {
          if (norm(String(before)) !== norm(String(after)))
            changes.push(`${label}: ${before || "blank"} → ${after || "blank"}`);
        };
      compare("Sport", existing.sports?.name || "", row.sport);
      compare("League", existing.leagues?.name || "", row.league);
      compare("Level", existing.levels?.name || "", row.level);
      compare("Home team", existing.home?.name || "", row.home_team);
      compare("Away team", existing.away?.name || "", row.away_team);
      compare("Date", currentDateValue, row.date);
      compare("Time", currentTimeValue, row.time);
      compare("Location", existing.location?.name || "", row.location);
      compare("Length", existing.duration_minutes || 110, row.duration_minutes);
      compare("Officials", existing.officials_needed, row.officials_needed);
      compare("Notes", existing.notes || "", row.notes);
      row.action = changes.length ? "update" : "skip";
      row.changes = changes.length ? changes.join(" • ") : "No changes detected";
    }
    return validated;
  }
  async function file(e: ChangeEvent<HTMLInputElement>) {
    setError("");
    setRows([]);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const XLSX = await import("xlsx"),
        wb = XLSX.read(await f.arrayBuffer(), { type: "array" }),
        raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
          defval: "",
          raw: true,
        }) as unknown[][];
      setRows(validate(raw));
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to read file");
    }
    e.target.value = "";
  }
  async function applyImport() {
    setBusy(true);
    setError("");
    let added = 0,
      updated = 0,
      skipped = rows.filter((row) => row.action === "skip").length;
    const importedByGameNumber = new Map(
        rows
          .filter((r) => r.valid && r.game_number)
          .map((r) => [norm(r.game_number), r]),
      ),
      applied = new Set<number>();
    const rowErrorMessage = (r: Row, detail: string) =>
      `Import stopped at spreadsheet row ${r.row} — Game ${r.game_number || "NEW"} — ${r.home_team || "TBD"} vs ${r.away_team || "TBD"} — ${r.date} ${r.time} — ${r.location || "No location"}. Reason: ${detail}`;
    const errorDetail = (value: unknown) =>
      value instanceof Error
        ? value.message
        : typeof value === "object" && value !== null && "message" in value
          ? String((value as { message: unknown }).message)
          : String(value);
    async function applyRow(r: Row, resolving = new Set<number>()) {
      if (r.action === "skip") return;
      if (applied.has(r.row)) return;
      if (resolving.has(r.row))
        throw new Error(
          rowErrorMessage(
            r,
            "The uploaded games contain a circular scheduling conflict that cannot be reordered automatically.",
          ),
        );
      const nextResolving = new Set(resolving).add(r.row);
      const s = sports.find((x) => norm(x.name) === norm(r.sport))!,
        lg = leagues.find((x) => norm(x.name) === norm(r.league))!,
        lv = levels.find((x) => norm(x.name) === norm(r.level))!,
        home = teams.find(
          (x) =>
            norm(x.name) === norm(r.home_team) &&
            x.sport_id === s.id &&
            x.level_id === lv.id,
        ),
        away = teams.find(
          (x) =>
            norm(x.name) === norm(r.away_team) &&
            x.sport_id === s.id &&
            x.level_id === lv.id,
        ),
        loc = locations.find((x) => norm(x.name) === norm(r.location))!;
      if (!home || !away)
        throw new Error(
          rowErrorMessage(
            r,
            "Team not found for the selected sport and level.",
          ),
        );
      const payload = {
          sport_id: s.id,
          league_id: lg.id,
          level_id: lv.id,
          level: lv.name,
          home_team_id: home.id,
          away_team_id: away.id,
          location_id: loc.id,
          starts_at: new Date(`${r.date}T${r.time}:00`).toISOString(),
          duration_minutes: r.duration_minutes || 110,
          officials_needed: r.officials_needed,
          notes: r.notes || null,
        },
        existing = r.game_number
          ? games.find((g) => norm(g.game_number) === norm(r.game_number))
          : null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { error: saveError } = existing
          ? await sb.from("games").update(payload).eq("id", existing.id)
          : await sb.from("games").insert({
              ...payload,
              game_number: r.game_number || null,
              status: "open",
            });
        if (!saveError) {
          applied.add(r.row);
          existing ? updated++ : added++;
          return;
        }
        const detail = errorDetail(saveError),
          blockingGame = detail.match(
            /conflict with Game #([^\s]+)\s+at/i,
          )?.[1],
          blockingRow = blockingGame
            ? importedByGameNumber.get(norm(blockingGame))
            : undefined;
        if (
          attempt === 0 &&
          blockingRow &&
          blockingRow.row !== r.row &&
          !applied.has(blockingRow.row)
        ) {
          await applyRow(blockingRow, nextResolving);
          continue;
        }
        throw new Error(rowErrorMessage(r, detail));
      }
    }
    try {
      for (const r of rows) {
        if (!r.valid) continue;
        await applyRow(r);
      }
      setMessage(
        `Import complete: ${updated} updated, ${added} added, ${skipped} unchanged and skipped.`,
      );
      setRows([]);
      await load();
    } catch (x) {
      const importError = x instanceof Error ? x.message : "Import failed";
      setError(importError);
      const rowNumber = Number(importError.match(/spreadsheet row (\d+)/i)?.[1] || 0) || null;
      const { data: userData } = await sb.auth.getUser();
      await sb.from("import_error_log").insert({
        import_type: "games",
        error_message: importError,
        row_number: rowNumber,
        created_by: userData.user?.id || null,
      });
    }
    setBusy(false);
  }
  function template() {
    const csv =
      "game_number,sport,league,level,home_team,away_team,date,time,location,duration_minutes,officials_needed,notes\n,Soccer,Approved League,U19,Approved Home Team,Approved Away Team,29-Aug-26,7:00 PM,Approved Location,110,3,Conference game\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "refassign-game-import-template.csv";
    a.click();
  }
  const filters: [Range, string][] = [
    ["all", "All Games"],
    ["today", "Today's Games"],
    ["tomorrow", "Tomorrow's Games"],
    ["thisWeek", "This Week"],
    ["nextWeek", "Next Week"],
  ];
  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Live Game Schedule</h2>
          <p>
            {filteredGames.length} shown • {games.length} total games • Default
            game length is 110 minutes
          </p>
        </div>
        <div className="headerActions">
          <button className="secondary" onClick={() => void exportGames()}>
            Export Games
          </button>
          <button
            className="secondary"
            onClick={() => {
              setShowImport(!showImport);
              setShow(false);
            }}
          >
            Import / Update
          </button>
          <button
            className="primary"
            onClick={() => {
              setEditing(null);
              setForm(blank);
              setShow(!show);
              setShowImport(false);
            }}
          >
            + Add Game
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          margin: "14px 0",
          alignItems: "center",
        }}
      >
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={range === key ? "primary" : "secondary"}
            onClick={() => {
              setRange(key);
              setShowCalendar(false);
            }}
          >
            {label} ({games.filter((g) => inRange(g, key, customDate)).length})
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCalendar(!showCalendar)}
          style={{
            background: "#111827",
            color: "#fff",
            border: "1px solid #111827",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          📅 Calendar
        </button>
        {showCalendar && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setRange("custom");
            }}
            style={{ width: "auto", minWidth: 160 }}
          />
        )}
        {range === "custom" && customDate && (
          <span style={{ fontWeight: 700 }}>
            {new Date(`${customDate}T00:00:00`).toLocaleDateString()} (
            {filteredGames.length})
          </span>
        )}
      </div>
      {show && (
        <form className="officialForm" onSubmit={save}>
          <label>
            Game Number <small>Optional for new games</small>
            <input
              value={form.game_number}
              onChange={(e) =>
                setForm({ ...form, game_number: e.target.value })
              }
            />
          </label>
          <label>
            Sport
            <select
              required
              value={form.sport_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  sport_id: e.target.value,
                  home_team_id: "",
                  away_team_id: "",
                })
              }
            >
              <option value="">Select</option>
              {sports.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            League
            <select
              required
              value={form.league_id}
              onChange={(e) => setForm({ ...form, league_id: e.target.value })}
            >
              <option value="">Select</option>
              {leagues.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Level
            <select
              required
              value={form.level_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  level_id: e.target.value,
                  home_team_id: "",
                  away_team_id: "",
                })
              }
            >
              <option value="">Select</option>
              {levels.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Home Team
            <select
              required
              value={form.home_team_id}
              onChange={(e) =>
                setForm({ ...form, home_team_id: e.target.value })
              }
            >
              <option value="">Select</option>
              {eligible.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Away Team
            <select
              required
              value={form.away_team_id}
              onChange={(e) =>
                setForm({ ...form, away_team_id: e.target.value })
              }
            >
              <option value="">Select</option>
              {eligible.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label>
            Time
            <input
              type="time"
              required
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </label>
          <label>
            Game Length (minutes)
            <input
              type="number"
              min="1"
              max="1440"
              required
              value={form.duration_minutes}
              onChange={(e) =>
                setForm({ ...form, duration_minutes: +e.target.value })
              }
            />
          </label>
          <label>
            Location
            <select
              required
              value={form.location_id}
              onChange={(e) =>
                setForm({ ...form, location_id: e.target.value })
              }
            >
              <option value="">Select</option>
              {locations.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Officials Needed
            <input
              type="number"
              min="1"
              max="20"
              value={form.officials_needed}
              onChange={(e) =>
                setForm({ ...form, officials_needed: +e.target.value })
              }
            />
          </label>
          <label>
            Notes
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <button className="primary" disabled={busy}>
            {editing ? "Update Game" : "Save Game"}
          </button>
        </form>
      )}
      {showImport && (
        <div className="importPanel">
          <div className="cardHead">
            <div>
              <h3>Import / Update Games</h3>
              <p>
                Duration_Minutes is included in exports and defaults to 110 for
                new games. Dates such as 29-Aug-26 and times containing timezone
                labels such as CDT or CST are supported.
              </p>
            </div>
            <button className="secondary" onClick={template}>
              Download Template
            </button>
          </div>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={file} />
          {rows.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  margin: "12px 0",
                }}
              >
                {(["add", "update", "skip", "error"] as const).map((action) => (
                  <span
                    key={action}
                    className={`badge ${action === "error" ? "red" : action === "skip" ? "" : "blue"}`}
                  >
                    {action === "add"
                      ? "Add"
                      : action === "update"
                        ? "Update"
                        : action === "skip"
                          ? "No Change"
                          : "Error"}{" "}
                    ({rows.filter((row) => row.action === action).length})
                  </span>
                ))}
              </div>
              {rows.some((r) => !r.valid) && (
                <div className="errorBox">
                  Import paused: {rows.filter((r) => !r.valid).length}{" "}
                  spreadsheet row(s) need correction. Review the Validation
                  column below, update the file, and upload it again.
                </div>
              )}
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Game #</th>
                      <th>Game</th>
                      <th>Date / Time</th>
                      <th>Length</th>
                      <th>Action</th>
                      <th>Proposed Changes</th>
                      <th>Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.game_number || "NEW"}</td>
                        <td>
                          {r.home_team} vs {r.away_team}
                        </td>
                        <td>
                          {r.date}
                          <small>{r.time}</small>
                        </td>
                        <td>{r.duration_minutes} min</td>
                        <td>
                          <b
                            style={{
                              color:
                                r.action === "error"
                                  ? "#dc2626"
                                  : r.action === "skip"
                                    ? "#64748b"
                                    : "#2563eb",
                            }}
                          >
                            {r.action === "add"
                              ? "ADD"
                              : r.action === "update"
                                ? "UPDATE"
                                : r.action === "skip"
                                  ? "SKIP"
                                  : "ERROR"}
                          </b>
                        </td>
                        <td style={{ minWidth: 260 }}>{r.changes}</td>
                        <td>{r.valid ? "Ready" : r.issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="primary"
                disabled={busy || rows.some((r) => !r.valid)}
                onClick={() => void applyImport()}
              >
                Apply Reviewed Import
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className="errorBox">{error}</div>}
      {message && <div className="loginMessage">{message}</div>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Game #</th>
              <th>Date</th>
              <th>Game</th>
              <th>League / Level</th>
              <th>Location</th>
              <th>Length</th>
              <th>Officials</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredGames.map((g) => {
              const d = new Date(g.starts_at);
              const row = statusColors(g.status);
              const rainOut = g.status === "rained_out";
              return (
                <tr
                  key={g.id}
                  style={{ background: row.background, color: row.color }}
                >
                  <td>
                    <b>{g.game_number}</b>
                  </td>
                  <td>
                    {d.toLocaleDateString()}
                    <small style={{ color: rainOut ? "#dbeafe" : undefined }}>
                      {d.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </td>
                  <td>
                    <b>
                      {g.home?.name || "TBD"} vs {g.away?.name || "TBD"}
                    </b>
                  </td>
                  <td>
                    {g.leagues?.name || "—"}
                    <small style={{ color: rainOut ? "#dbeafe" : undefined }}>
                      {g.levels?.name || ""}
                    </small>
                  </td>
                  <td>{g.location?.name || "TBD"}</td>
                  <td>{g.duration_minutes || 110} min</td>
                  <td>{g.officials_needed}</td>
                  <td>
                    <select
                      aria-label={`Status for ${g.game_number}`}
                      disabled={statusBusy === g.id}
                      value={g.status === "open" ? "active" : g.status}
                      onChange={(e) => void changeStatus(g.id, e.target.value)}
                      style={{
                        minWidth: 120,
                        background: rainOut ? "#eff6ff" : "#fff",
                        color: "#172033",
                      }}
                    >
                      {statusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="secondary" onClick={() => edit(g)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
