"use client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { announceUndoAvailable } from "./UndoCenter";
import { resolveImportTeam } from "../lib/game-import-team";
import { eventLocalToIso, eventTimeParts, formatEventDate, formatEventTime } from "../lib/event-time";
type Named = { id: string; name: string };
type BillTo = Named;
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
  time_tbd: boolean;
  field_tbd: boolean;
  duration_minutes: number;
  officials_needed: number;
  notes: string | null;
  bill_to_id: string | null;
  archived_at: string | null;
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
  bill_to: string;
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
  if (status === "suspended")
    return { background: "#fef9c3", color: "#172033" };
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
  time_tbd: false,
  field_tbd: false,
  duration_minutes: 110,
  officials_needed: 3,
  notes: "",
  bill_to_id: "",
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
const locationKey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "");
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
function describeGameConflict(
  games: Game[],
  candidate: {
    home_team_id: string;
    away_team_id: string;
    location_id: string;
    starts_at: string;
    duration_minutes: number;
  },
  editingId: string | null,
) {
  const start = new Date(candidate.starts_at);
  const end = new Date(start.getTime() + candidate.duration_minutes * 60_000);
  const teamIds = [candidate.home_team_id, candidate.away_team_id].filter(
    Boolean,
  );

  for (const game of games) {
    if (
      game.id === editingId ||
      ["cancelled", "canceled"].includes(game.status)
    )
      continue;
    const gameStart = new Date(game.starts_at);
    const gameEnd = new Date(
      gameStart.getTime() + (game.duration_minutes || 110) * 60_000,
    );
    if (gameStart >= end || gameEnd <= start) continue;

    const conflictingTeams = [game.home_team_id, game.away_team_id].filter(
      (id): id is string => Boolean(id && teamIds.includes(id)),
    );
    const sameLocation = Boolean(
      candidate.location_id && game.location_id === candidate.location_id,
    );
    if (!conflictingTeams.length && !sameLocation) continue;

    const teamNames = conflictingTeams.map(
      (id) =>
        teamsForConflict(game, id) ||
        (id === candidate.home_team_id ? "home team" : "away team"),
    );
    const reasons = [
      teamNames.length
        ? `${teamNames.join(" and ")} ${teamNames.length === 1 ? "is" : "are"} already scheduled`
        : "",
      sameLocation
        ? `${game.location?.name || "This location"} is already in use`
        : "",
    ].filter(Boolean);
    const date = gameStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const time = (value: Date) =>
      value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const matchup = [game.home?.name, game.away?.name]
      .filter(Boolean)
      .join(" vs. ");
    return `Schedule conflict: ${reasons.join("; ")}. Conflicting game: #${game.game_number || "unassigned"}${matchup ? ` — ${matchup}` : ""}, ${date}, ${time(gameStart)}–${time(gameEnd)}${game.location?.name ? ` at ${game.location.name}` : ""}.`;
  }
  return null;
}
function teamsForConflict(game: Game, teamId: string) {
  if (game.home_team_id === teamId) return game.home?.name || null;
  if (game.away_team_id === teamId) return game.away?.name || null;
  return null;
}
export default function GamesManagerV3({
  organizationId,
}: {
  organizationId?: string;
}) {
  const sb = useMemo(() => createClient(), []);
  const [games, setGames] = useState<Game[]>([]),
    [sports, setSports] = useState<Sport[]>([]),
    [leagues, setLeagues] = useState<Named[]>([]),
    [levels, setLevels] = useState<Named[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [locations, setLocations] = useState<Location[]>([]),
    [billTos, setBillTos] = useState<BillTo[]>([]),
    [canManageBillTos, setCanManageBillTos] = useState(false),
    [newBillToName, setNewBillToName] = useState(""),
    [form, setForm] = useState(blank),
    [editing, setEditing] = useState<string | null>(null),
    [show, setShow] = useState(false),
    [showImport, setShowImport] = useState(false),
    [rows, setRows] = useState<Row[]>([]),
    [importFileName, setImportFileName] = useState(""),
    [importValidated, setImportValidated] = useState(false),
    [importApproved, setImportApproved] = useState(false),
    [validationBusy, setValidationBusy] = useState(false),
    [range, setRange] = useState<Range>("all"),
    [leagueFilter, setLeagueFilter] = useState("all"),
    [levelFilter, setLevelFilter] = useState("all"),
    [venueFilter, setVenueFilter] = useState("all"),
    [dateFrom, setDateFrom] = useState(""),
    [dateTo, setDateTo] = useState(""),
    [timeFrom, setTimeFrom] = useState(""),
    [timeTo, setTimeTo] = useState(""),
    [customDate, setCustomDate] = useState(""),
    [showCalendar, setShowCalendar] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [selectedGames, setSelectedGames] = useState<string[]>([]),
    [managementBusy, setManagementBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [statusBusy, setStatusBusy] = useState(""),
    [pendingStatus, setPendingStatus] = useState<{
      gameId: string;
      status: string;
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const locationRequest = organizationId
      ? sb.rpc("get_organization_locations", {
          p_organization_id: organizationId,
        })
      : sb
          .from("locations")
          .select("id,name,city,state")
          .eq("active", true)
          .order("name");

    const gamesQuery = sb
      .from("games")
      .select(
        "id,game_number,status,sport_id,league_id,level_id,home_team_id,away_team_id,location_id,bill_to_id,archived_at,starts_at,time_tbd,field_tbd,duration_minutes,officials_needed,notes,sports(name),leagues(name),levels(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(id,name,city,state)",
      )
      .order("starts_at");
    const visibleGamesQuery = showArchived
      ? gamesQuery.not("archived_at", "is", null)
      : gamesQuery.is("archived_at", null);
    const [s, lg, lv, t, lo, g, billToResponse] = await Promise.all([
      sb
        .from("sports")
        .select("id,name,default_officials")
        .eq("active", true)
        .order("name"),
      sb.from("leagues").select("id,name").eq("active", true).order("name"),
      sb.from("levels").select("id,name").eq("active", true).order("name"),
      sb.from("teams").select("id,name,level_id,sport_id").order("name"),
      locationRequest,
      organizationId
        ? visibleGamesQuery.eq("organization_id", organizationId)
        : visibleGamesQuery,
      organizationId
        ? fetch(
            `/api/bill-tos?organizationId=${encodeURIComponent(organizationId)}`,
            {
              cache: "no-store",
            },
          )
        : Promise.resolve(null),
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
      setSelectedGames([]);
      if (billToResponse?.ok) {
        const billToResult = (await billToResponse.json()) as {
          billTos?: BillTo[];
          canManageBillTos?: boolean;
        };
        setBillTos(billToResult.billTos || []);
        setCanManageBillTos(Boolean(billToResult.canManageBillTos));
      }
    }
  }
  useEffect(() => {
    void load();
  }, [organizationId, showArchived]);
  function requestStatusChange(gameId: string, status: string) {
    if (["canceled", "rained_out"].includes(status)) {
      setPendingStatus({ gameId, status });
      return;
    }
    void changeStatus(gameId, status);
  }
  async function changeStatus(id: string, status: string) {
    setPendingStatus(null);
    setStatusBusy(id);
    setError("");
    setMessage("");
    const response = await fetch(
      `/api/games/status?organizationId=${encodeURIComponent(organizationId || "")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: id, status }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      sent?: number;
      failed?: number;
    };
    if (!response.ok)
      setError(result.error || "Game status could not be updated.");
    else {
      setGames((current) =>
        current.map((game) => (game.id === id ? { ...game, status } : game)),
      );
      const notification = ["canceled", "rained_out"].includes(status)
        ? ` ${result.sent || 0} official notification${result.sent === 1 ? "" : "s"} sent${result.failed ? `; ${result.failed} failed` : ""}.`
        : "";
      setMessage(`Game status updated.${notification}`);
      announceUndoAvailable();
    }
    setStatusBusy("");
  }
  async function manageGames(action: "archive" | "restore" | "delete", ids: string[]) {
    if (!ids.length) {
      setError("Select at least one game first.");
      return;
    }
    if (!organizationId) {
      setError("Select an organization before managing games.");
      return;
    }
    if (
      action === "delete" &&
      !window.confirm(
        `Permanently delete ${ids.length} game${ids.length === 1 ? "" : "s"}? Assignments, reports, crew messages, updates, and other related records will also be deleted. This cannot be undone.`,
      )
    ) return;
    setManagementBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(
      `/api/games/manage?organizationId=${encodeURIComponent(organizationId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, gameIds: ids }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(result.error || "Games could not be updated.");
    else {
      const past = action === "archive" ? "archived" : action === "restore" ? "restored" : "deleted";
      setMessage(`${ids.length} game${ids.length === 1 ? "" : "s"} ${past}.`);
      await load();
    }
    setManagementBusy(false);
  }
  const leagueGames = games.filter(
    (game) => leagueFilter === "all" || game.league_id === leagueFilter,
  );
  const filteredGames = leagueGames.filter((game) => {
    if (!inRange(game, range, customDate)) return false;
    if (levelFilter !== "all" && game.level_id !== levelFilter) return false;
    if (venueFilter !== "all" && game.location_id !== venueFilter) return false;
    const { date: localDate, time: localTime } = eventTimeParts(game.starts_at, game.location);
    if (dateFrom && localDate < dateFrom) return false;
    if (dateTo && localDate > dateTo) return false;
    if (!game.time_tbd && timeFrom && localTime < timeFrom) return false;
    if (!game.time_tbd && timeTo && localTime > timeTo) return false;
    return true;
  });
  const eligible = teams.filter(
    (t) => t.sport_id === form.sport_id && t.level_id === form.level_id,
  );
  function edit(g: Game) {
    const eventTime = eventTimeParts(g.starts_at, g.location);
    setEditing(g.id);
    setForm({
      game_number: g.game_number,
      sport_id: g.sport_id,
      league_id: g.league_id || "",
      level_id: g.level_id || "",
      home_team_id: g.home_team_id || "",
      away_team_id: g.away_team_id || "",
      location_id: g.location_id || "",
      bill_to_id: g.bill_to_id || "",
      date: eventTime.date,
      time: eventTime.time,
      time_tbd: g.time_tbd,
      field_tbd: g.field_tbd,
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
        ...(organizationId ? { organization_id: organizationId } : {}),
        game_number: form.game_number.trim() || null,
        sport_id: form.sport_id,
        league_id: form.league_id,
        level_id: form.level_id,
        level: lv?.name || null,
        home_team_id: form.home_team_id,
        away_team_id: form.away_team_id,
        location_id: form.location_id,
        bill_to_id: form.bill_to_id || null,
        starts_at: eventLocalToIso(form.date, form.time_tbd ? "00:00" : form.time, locations.find((location) => location.id === form.location_id)),
        time_tbd: form.time_tbd,
        field_tbd: form.field_tbd,
        duration_minutes: +form.duration_minutes || 110,
        officials_needed: +form.officials_needed,
        notes: form.notes.trim() || null,
      };
      const q = editing
        ? sb.from("games").update(payload).eq("id", editing)
        : sb.from("games").insert({ ...payload, status: "active" });
      const { error: e2 } = await q;
      if (e2) {
        const databaseMessage = [e2.message, e2.details, e2.hint]
          .filter(Boolean)
          .join(" ");
        const isScheduleConflict =
          e2.code === "23514" ||
          /double-book|overlap|conflict/i.test(databaseMessage);
        const isDuplicateLeagueGameNumber =
          e2.code === "23505" &&
          /games_active_league_game_number_unique/i.test(databaseMessage);
        const detailedConflict = isScheduleConflict
          ? describeGameConflict(games, payload, editing)
          : null;
        throw new Error(
          detailedConflict ||
            (isDuplicateLeagueGameNumber
              ? "That game number is already in use for this league. A different league may use the same number."
              : databaseMessage) ||
            "Unable to save game",
        );
      }
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
    const data = filteredGames.map((g) => {
      return {
        "Game Number": g.game_number,
        Sport: g.sports?.name || "",
        League: g.leagues?.name || "",
        Level: g.levels?.name || "",
        Home_Team: g.home?.name || "",
        Away_Team: g.away?.name || "",
        Date: formatEventDate(g.starts_at, g.location),
        Time: g.time_tbd ? "TBD" : formatEventTime(g.starts_at, g.location),
        Location: g.field_tbd ? "Field TBD" : g.location?.name || "",
        Duration_Minutes: g.duration_minutes || 110,
        Officials_Needed: g.officials_needed,
        Bill_To:
          billTos.find((billTo) => billTo.id === g.bill_to_id)?.name || "",
        Notes: g.notes || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Games");
    XLSX.writeFile(wb, "refassign-filtered-games.xlsx");
  }
  function validate(raw: unknown[][], availableLocations = locations) {
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
        suppliedBillTo = get("bill_to"),
        billTo =
          billTos.find((x) => norm(x.name) === norm(suppliedBillTo))?.name || "",
        date = dateVal(cell("date")),
        time = timeVal(cell("time")),
        duration = Number(get("duration_minutes") || 110),
        officials = Number(get("officials_needed")),
        issues: string[] = [],
        sportMatch = sports.find((x) => norm(x.name) === norm(sport)),
        levelMatch = levels.find((x) => norm(x.name) === norm(level));
      if (!sportMatch) issues.push("Sport not found");
      if (!leagues.some((x) => norm(x.name) === norm(league)))
        issues.push("League not found");
      if (!levelMatch) issues.push("Level not found");
      if (
        !availableLocations.some(
          (x) => locationKey(x.name) === locationKey(location),
        )
      )
        issues.push("Location not found");
      if (!date) issues.push("Invalid date");
      if (!time) issues.push("Invalid time");
      if (
        home &&
        sportMatch &&
        levelMatch &&
        !resolveImportTeam(teams, home, sportMatch.id, levelMatch.id)
      )
        issues.push("Home team not found for the selected sport");
      if (
        away &&
        sportMatch &&
        levelMatch &&
        !resolveImportTeam(teams, away, sportMatch.id, levelMatch.id)
      )
        issues.push("Away team not found for the selected sport");
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
        bill_to: billTo,
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
          norm(a.league) === norm(b.league) &&
          norm(a.game_number) === norm(b.game_number)
        ) {
          addIssue(
            a,
            `Duplicate game number for ${a.league} also appears on row ${b.row}`,
          );
          addIssue(
            b,
            `Duplicate game number for ${b.league} also appears on row ${a.row}`,
          );
          continue;
        }
        const aStart = new Date(`${a.date}T${a.time}:00`).getTime(),
          bStart = new Date(`${b.date}T${b.time}:00`).getTime(),
          aEnd = aStart + a.duration_minutes * 60_000,
          bEnd = bStart + b.duration_minutes * 60_000;
        if (aStart >= bEnd || bStart >= aEnd) continue;
        const sameLocation =
            locationKey(a.location) === locationKey(b.location),
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
      const rowLeague = leagues.find(
        (league) => norm(league.name) === norm(row.league),
      );
      const existing = row.game_number
        ? games.find(
            (game) =>
              game.league_id === rowLeague?.id &&
              norm(game.game_number) === norm(row.game_number),
          )
        : undefined;
      if (!existing) {
        row.action = "add";
        row.changes = "New game will be added";
        continue;
      }
      const currentEventTime = eventTimeParts(existing.starts_at, existing.location),
        currentDateValue = currentEventTime.date,
        currentTimeValue = currentEventTime.time,
        changes: string[] = [],
        compare = (
          label: string,
          before: string | number,
          after: string | number,
        ) => {
          if (norm(String(before)) !== norm(String(after)))
            changes.push(
              `${label}: ${before || "blank"} → ${after || "blank"}`,
            );
        };
      compare("Sport", existing.sports?.name || "", row.sport);
      compare("League", existing.leagues?.name || "", row.league);
      compare("Level", existing.levels?.name || "", row.level);
      compare("Home team", existing.home?.name || "", row.home_team);
      compare("Away team", existing.away?.name || "", row.away_team);
      compare("Date", currentDateValue, row.date);
      compare("Time", currentTimeValue, row.time);
      compare("Location", existing.location?.name || "", row.location);
      compare(
        "Bill To",
        billTos.find((billTo) => billTo.id === existing.bill_to_id)?.name || "",
        row.bill_to,
      );
      compare("Length", existing.duration_minutes || 110, row.duration_minutes);
      compare("Officials", existing.officials_needed, row.officials_needed);
      compare("Notes", existing.notes || "", row.notes);
      row.action = changes.length ? "update" : "skip";
      row.changes = changes.length
        ? changes.join(" • ")
        : "No changes detected";
    }
    return validated;
  }
  async function file(e: ChangeEvent<HTMLInputElement>) {
    setError("");
    setMessage("");
    setRows([]);
    setImportValidated(false);
    setImportApproved(false);
    const f = e.target.files?.[0];
    if (!f) return;
    setImportFileName(f.name);
    setValidationBusy(true);
    try {
      const XLSX = await import("xlsx"),
        wb = XLSX.read(await f.arrayBuffer(), { type: "array" }),
        raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
          defval: "",
          raw: true,
        }) as unknown[][];
      const headers = raw[0].map((x) =>
          norm(String(x)).replace(/\s+/g, "_"),
        ),
        locationColumn = headers.indexOf("location"),
        requestedLocations = [
          ...new Set(
            raw
              .slice(1)
              .map((row) => String(row[locationColumn] || "").trim())
              .filter(Boolean),
          ),
        ],
        { data: importLocations, error: locationError } = await sb.rpc(
          "prepare_game_import_locations",
          {
            p_organization_id: organizationId,
            p_location_names: requestedLocations,
          },
        );
      if (locationError) throw locationError;
      const mergedLocations = [
        ...locations,
        ...((importLocations || []) as Location[]).filter(
          (candidate) =>
            !locations.some((location) => location.id === candidate.id),
        ),
      ];
      setLocations(mergedLocations);
      const validated = validate(raw, mergedLocations);
      setRows(validated);
      if (!validated.length)
        throw new Error("The spreadsheet does not contain any game rows.");
      if (!validated.some((row) => !row.valid)) {
        const databaseValidated = validated.map((row) => ({ ...row }));
        for (let attempt = 0; attempt < databaseValidated.length; attempt++) {
          const { error: validationError } = await sb.rpc(
            "validate_game_import",
            {
              p_rows: importPayload(databaseValidated, mergedLocations),
            },
          );
          if (!validationError) break;
          const rowNumber = Number(
              validationError.message.match(/spreadsheet row (\d+)/i)?.[1] || 0,
            ),
            failedRow = databaseValidated.find((row) => row.row === rowNumber);
          if (!failedRow) throw validationError;
          failedRow.valid = false;
          failedRow.action = "error";
          failedRow.issue = validationError.message.replace(
            /^.*spreadsheet row \d+\s*[—-]\s*game\s*[^—-]+\s*[—-]\s*/i,
            "",
          );
          failedRow.changes = failedRow.issue;
        }
        setRows(databaseValidated);
        if (!databaseValidated.some((row) => !row.valid)) {
          setImportValidated(true);
          setMessage(
            `Validation passed for all ${databaseValidated.length} spreadsheet rows. Review the preview and approve it before applying any changes.`,
          );
        }
      }
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to read file");
    }
    setValidationBusy(false);
    e.target.value = "";
  }
  function importPayload(
    sourceRows: Row[],
    availableLocations = locations,
  ) {
    return sourceRows.map((r) => {
      const s = sports.find((x) => norm(x.name) === norm(r.sport)),
        lg = leagues.find((x) => norm(x.name) === norm(r.league)),
        lv = levels.find((x) => norm(x.name) === norm(r.level)),
        home = resolveImportTeam(teams, r.home_team, s?.id, lv?.id),
        away = resolveImportTeam(teams, r.away_team, s?.id, lv?.id),
        loc = availableLocations.find(
          (x) => locationKey(x.name) === locationKey(r.location),
        ),
        billTo = billTos.find((x) => norm(x.name) === norm(r.bill_to)),
        existing = r.game_number
          ? games.find(
              (g) =>
                g.league_id === lg?.id &&
                norm(g.game_number) === norm(r.game_number),
            )
          : undefined;
      if (r.action !== "skip" && (!s || !lg || !lv || !home || !away || !loc))
        throw new Error(
          `Spreadsheet row ${r.row} — Game ${r.game_number || "NEW"} — a sport, league, level, team, or location could not be resolved.`,
        );
      return {
        row: r.row,
        action: r.valid ? r.action : "skip",
        organization_id: organizationId,
        game_id: existing?.id || null,
        game_number: r.game_number,
        sport_id: s?.id || null,
        league_id: lg?.id || null,
        level_id: lv?.id || null,
        level_name: lv?.name || null,
        home_team_id: home?.id || null,
        away_team_id: away?.id || null,
        location_id: loc?.id || null,
        bill_to_id: billTo?.id || null,
        starts_at: eventLocalToIso(r.date, r.time, loc),
        time_tbd: false,
        field_tbd: false,
        duration_minutes: r.duration_minutes,
        officials_needed: r.officials_needed,
        notes: r.notes,
      };
    });
  }
  async function applyImport() {
    setBusy(true);
    setError("");
    try {
      const validRows = rows.filter((row) => row.valid);
      const blockedRows = rows.length - validRows.length;
      const previewIsReady = !validationBusy && validRows.length > 0;
      if (!previewIsReady || !importApproved)
        throw new Error(
          "Review and approve the valid preview rows before applying this import.",
        );
      const { data, error: applyError } = await sb.rpc("apply_game_import", {
        p_rows: importPayload(validRows),
      });
      if (applyError) throw applyError;
      const result = data as {
        added?: number;
        updated?: number;
        skipped?: number;
      };
      setMessage(
        `Import complete: ${result.updated || 0} updated, ${result.added || 0} added, ${result.skipped || 0} unchanged${blockedRows ? `, and ${blockedRows} unresolved row${blockedRows === 1 ? " was" : "s were"} not imported` : ""}.`,
      );
      announceUndoAvailable();
      setRows([]);
      setImportApproved(false);
      setImportValidated(false);
      await load();
    } catch (x) {
      const importError = x instanceof Error ? x.message : "Import failed";
      setError(importError);
      const rowNumber =
        Number(importError.match(/spreadsheet row (\d+)/i)?.[1] || 0) || null;
      const { data: userData } = await sb.auth.getUser();
      await sb.from("import_error_log").insert({
        organization_id: organizationId || null,
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
      "game_number,sport,league,level,home_team,away_team,date,time,location,duration_minutes,officials_needed,bill_to,notes\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "refassign-game-import-template.csv";
    a.click();
  }
  async function addBillTo() {
    const name = newBillToName.trim();
    if (!name || !organizationId) return;
    setBusy(true);
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
      setForm((current) => ({ ...current, bill_to_id: result.billTo!.id }));
      setNewBillToName("");
      setMessage(`${result.billTo.name} added to Bill To options.`);
    }
    setBusy(false);
  }
  const filters: [Range, string][] = [
    ["all", "All Games"],
    ["today", "Today's Games"],
    ["tomorrow", "Tomorrow's Games"],
    ["thisWeek", "This Week"],
    ["nextWeek", "Next Week"],
  ];
  const importPreviewReady =
    rows.length > 0 &&
    rows.some((row) => row.valid);
  const blockedImportRows = rows.filter((row) => !row.valid);
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
          <button className="secondary" disabled={!filteredGames.length} onClick={() => void exportGames()}>
            Export Shown Games
          </button>
          <button
            className="secondary"
            onClick={() => {
              setShowImport(!showImport);
              setShow(false);
              setRows([]);
              setImportFileName("");
              setImportValidated(false);
              setImportApproved(false);
              setError("");
              setMessage("");
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
        <button
          type="button"
          className={!showArchived ? "primary" : "secondary"}
          onClick={() => setShowArchived(false)}
        >
          Working Schedule
        </button>
        <button
          type="button"
          className={showArchived ? "primary" : "secondary"}
          onClick={() => setShowArchived(true)}
        >
          Archived Games
        </button>
        <label className="gameLeagueFilter">
          <span>League</span>
          <select
            value={leagueFilter}
            onChange={(event) => {
              setLeagueFilter(event.target.value);
              setSelectedGames([]);
            }}
          >
            <option value="all">All Leagues</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gameLeagueFilter">
          <span>Level</span>
          <select value={levelFilter} onChange={(event) => { setLevelFilter(event.target.value); setSelectedGames([]); }}>
            <option value="all">All Levels</option>
            {levels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
          </select>
        </label>
        <label className="gameLeagueFilter">
          <span>Venue</span>
          <select value={venueFilter} onChange={(event) => { setVenueFilter(event.target.value); setSelectedGames([]); }}>
            <option value="all">All Venues</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
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
            {label} (
            {leagueGames.filter((game) => inRange(game, key, customDate)).length}
            )
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
        <label className="gameLeagueFilter"><span>From date</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setSelectedGames([]); }} /></label>
        <label className="gameLeagueFilter"><span>Through date</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setSelectedGames([]); }} /></label>
        <label className="gameLeagueFilter"><span>From time</span><input type="time" value={timeFrom} onChange={(event) => { setTimeFrom(event.target.value); setSelectedGames([]); }} /></label>
        <label className="gameLeagueFilter"><span>Through time</span><input type="time" value={timeTo} onChange={(event) => { setTimeTo(event.target.value); setSelectedGames([]); }} /></label>
        {(levelFilter !== "all" || venueFilter !== "all" || dateFrom || dateTo || timeFrom || timeTo) && (
          <button type="button" className="secondary" onClick={() => { setLevelFilter("all"); setVenueFilter("all"); setDateFrom(""); setDateTo(""); setTimeFrom(""); setTimeTo(""); setSelectedGames([]); }}>Clear detailed filters</button>
        )}
      </div>
      {selectedGames.length > 0 && (
        <div className="noticeBox" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b>{selectedGames.length} selected</b>
          <button
            type="button"
            className="secondary"
            disabled={managementBusy}
            onClick={() => void manageGames(showArchived ? "restore" : "archive", selectedGames)}
          >
            {managementBusy ? "Working…" : showArchived ? "Restore selected" : "Archive selected"}
          </button>
          {showArchived && (
            <button
              type="button"
              className="danger"
              disabled={managementBusy}
              onClick={() => void manageGames("delete", selectedGames)}
            >
              Permanently delete selected
            </button>
          )}
          <button type="button" className="secondary" onClick={() => setSelectedGames([])}>
            Clear selection
          </button>
          {showArchived && (
            <small>
              Archived games still use database storage. Permanent deletion frees their game and related-record space.
            </small>
          )}
        </div>
      )}
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
              required={!form.time_tbd}
              disabled={form.time_tbd}
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
            <small><input type="checkbox" checked={form.time_tbd} onChange={(e) => setForm({ ...form, time_tbd: e.target.checked })} /> Time TBD</small>
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
            <small><input type="checkbox" checked={form.field_tbd} onChange={(e) => setForm({ ...form, field_tbd: e.target.checked })} /> Field TBD</small>
          </label>
          <label>
            Bill To <small>Optional</small>
            <select
              value={form.bill_to_id}
              onChange={(e) => setForm({ ...form, bill_to_id: e.target.value })}
            >
              <option value="">Not selected</option>
              {billTos.map((billTo) => (
                <option key={billTo.id} value={billTo.id}>
                  {billTo.name}
                </option>
              ))}
            </select>
          </label>
          {canManageBillTos && (
            <label>
              Add a new Bill To
              <span style={{ display: "flex", gap: 8 }}>
                <input
                  value={newBillToName}
                  placeholder="Organization or customer name"
                  onChange={(e) => setNewBillToName(e.target.value)}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !newBillToName.trim()}
                  onClick={() => void addBillTo()}
                >
                  Add
                </button>
              </span>
            </label>
          )}
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
          {validationBusy && <p>Validating every spreadsheet row…</p>}
          {rows.length > 0 && (
            <>
              <p>
                <b>{importFileName}</b> • {rows.length} spreadsheet row
                {rows.length === 1 ? "" : "s"}
              </p>
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
                  {blockedImportRows.length} spreadsheet row
                  {blockedImportRows.length === 1 ? " needs" : "s need"}{" "}
                  correction and will not be imported. You can still approve and
                  import every valid row below.
                  <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                    {blockedImportRows.slice(0, 10).map((row) => (
                      <li key={row.row}>
                        <b>Row {row.row}</b>
                        {row.game_number ? ` (Game ${row.game_number})` : ""}: {row.issue}
                      </li>
                    ))}
                    {blockedImportRows.length > 10 && (
                      <li>{blockedImportRows.length - 10} additional rows need attention.</li>
                    )}
                  </ul>
                </div>
              )}
              {importValidated && (
                <div className="loginMessage">
                  Full-file validation passed. No database changes have been
                  applied.
                </div>
              )}
              <div className="tableWrap workspaceDataScroll" role="region" aria-label="Game import preview" tabIndex={0}>
                <table className="gameImportPreviewTable">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Game #</th>
                      <th>Game</th>
                      <th>Date / Time</th>
                      <th>Length</th>
                      <th>Bill To</th>
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
                        <td>{r.bill_to || "Not selected"}</td>
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
                type="button"
                role="checkbox"
                aria-checked={importApproved}
                disabled={!importPreviewReady}
                onClick={() => setImportApproved((approved) => !approved)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  margin: "14px 0",
                  fontWeight: 700,
                  cursor: importPreviewReady ? "pointer" : "not-allowed",
                  minHeight: 44,
                  width: "100%",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  color: "#172033",
                  textAlign: "left",
                  fontSize: "inherit",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 26,
                    height: 26,
                    flex: "0 0 26px",
                    display: "grid",
                    placeItems: "center",
                    border: `2px solid ${importApproved ? "#2563eb" : "#94a3b8"}`,
                    borderRadius: 7,
                    background: importApproved ? "#2563eb" : "#fff",
                    color: "#fff",
                    fontSize: 19,
                    lineHeight: 1,
                  }}
                >
                  {importApproved ? "✓" : ""}
                </span>
                I reviewed this preview and approve importing all valid rows.
              </button>
              {validationBusy && importApproved && (
                <div className="loginMessage" role="status">
                  Approval recorded. Final validation is still running; the import
                  button will become available when it finishes.
                </div>
              )}
              {!validationBusy && rows.length > 0 && !rows.some((row) => row.valid) && (
                <div className="errorBox" role="status">
                  No rows are ready to import. Correct the listed validation errors
                  and upload the file again.
                </div>
              )}
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  validationBusy ||
                  !importPreviewReady ||
                  !importApproved ||
                  !rows.some((r) => r.valid)
                }
                onClick={() => void applyImport()}
              >
                {busy
                  ? "Applying Import…"
                  : `Apply ${rows.filter((row) => row.valid).length} Approved Row${rows.filter((row) => row.valid).length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className="errorBox">{error}</div>}
      {message && <div className="loginMessage">{message}</div>}
      {pendingStatus && (
        <div
          className="assignmentDialogBackdrop"
          role="presentation"
          onMouseDown={() => !statusBusy && setPendingStatus(null)}
        >
          <div
            className="assignmentDialog assignmentConfirmDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gamesStatusConfirmTitle"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="assignmentDialogHead">
              <div>
                <h3 id="gamesStatusConfirmTitle">Confirm Game Status</h3>
                <p>
                  Change Game #
                  {games.find((game) => game.id === pendingStatus.gameId)
                    ?.game_number || ""}{" "}
                  to{" "}
                  {statusOptions.find(
                    ([value]) => value === pendingStatus.status,
                  )?.[1] || pendingStatus.status}
                  ?
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={Boolean(statusBusy)}
                onClick={() => setPendingStatus(null)}
              >
                ×
              </button>
            </div>
            <div className="assignmentConfirmMessage">
              Assigned officials will be notified of this change.
            </div>
            <div className="assignmentDialogFooter">
              <button
                type="button"
                className="secondary"
                disabled={Boolean(statusBusy)}
                onClick={() => setPendingStatus(null)}
              >
                Keep Current Status
              </button>
              <button
                type="button"
                className="danger"
                disabled={Boolean(statusBusy)}
                onClick={() =>
                  void changeStatus(pendingStatus.gameId, pendingStatus.status)
                }
              >
                {statusBusy
                  ? "Updating…"
                  : `Confirm ${
                      statusOptions.find(
                        ([value]) => value === pendingStatus.status,
                      )?.[1] || "Change"
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="tableWrap workspaceDataScroll" role="region" aria-label="Games" tabIndex={0}>
        <table className="gamesManagementTable">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all visible games"
                  checked={filteredGames.length > 0 && filteredGames.every((game) => selectedGames.includes(game.id))}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    setSelectedGames(event.target.checked ? filteredGames.map((game) => game.id) : [])
                  }
                  style={{ width: "auto", marginRight: 8 }}
                />
                Game #
              </th>
              <th>Date</th>
              <th>Game</th>
              <th>League / Level</th>
              <th>Location</th>
              <th>Bill To</th>
              <th>Length</th>
              <th>Officials</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredGames.map((g) => {
              const row = statusColors(g.status);
              const rainOut = g.status === "rained_out";
              return (
                <tr
                  key={g.id}
                  style={{ background: row.background, color: row.color }}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select game ${g.game_number || "unnumbered"}`}
                      checked={selectedGames.includes(g.id)}
                      onChange={(event) =>
                        setSelectedGames((current) =>
                          event.target.checked
                            ? [...current, g.id]
                            : current.filter((id) => id !== g.id),
                        )
                      }
                      style={{ width: "auto", marginRight: 8 }}
                    />
                    <b>{g.game_number}</b>
                  </td>
                  <td>
                    {formatEventDate(g.starts_at, g.location)}
                    <small style={{ color: rainOut ? "#dbeafe" : undefined }}>
                      {g.time_tbd ? "Time TBD" : formatEventTime(g.starts_at, g.location)}
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
                  <td>{g.field_tbd ? "Hy-Vee Multiplex — Field TBD" : g.location?.name || "TBD"}</td>
                  <td>
                    {billTos.find((billTo) => billTo.id === g.bill_to_id)
                      ?.name || "—"}
                  </td>
                  <td>{g.duration_minutes || 110} min</td>
                  <td>{g.officials_needed}</td>
                  <td>
                    <select
                      aria-label={`Status for ${g.game_number}`}
                      disabled={showArchived || statusBusy === g.id}
                      value={g.status === "open" ? "active" : g.status}
                      onChange={(e) =>
                        requestStatusChange(g.id, e.target.value)
                      }
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
                    <div style={{ display: "flex", gap: 6 }}>
                      {!showArchived && <button className="secondary" onClick={() => edit(g)}>Edit</button>}
                      <button
                        type="button"
                        className="danger"
                        disabled={managementBusy}
                        onClick={() => void manageGames("delete", [g.id])}
                      >
                        Delete
                      </button>
                    </div>
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
