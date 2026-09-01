"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Team = { id: string; name: string };
type Game = {
  id: string;
  game_number: string;
  status: string;
  sport_id: string;
  league_id: string | null;
  level_id: string | null;
  location_id: string | null;
  starts_at: string;
  duration_minutes: number;
  officials_needed: number;
  sports: { name: string } | null;
  leagues: { name: string } | null;
  levels: { name: string } | null;
  home: Team | null;
  away: Team | null;
  location: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  sports: string[];
  active: boolean;
  home_city: string | null;
  home_state: string | null;
  home_latitude: number | null;
  home_longitude: number | null;
};
type Position = {
  id: string;
  sport_id: string;
  name: string;
  required: boolean;
  sort_order: number;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string;
  position_id: string;
  status: string;
  published_at: string | null;
  accept_by: string | null;
};
type Rank = { official_id: string; rank: number };
type PositionRank = {
  official_id: string;
  ref_rank: number;
  ar1_rank: number;
  ar2_rank: number;
  fourth_rank: number;
  mentor_rank: number;
};
type Power = { team_id: string; power: number };
type EligL = { official_id: string; league_id: string };
type EligV = { official_id: string; level_id: string };
type Block = {
  official_id: string;
  block_type: "date" | "location" | "team" | "time";
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location_id: string | null;
  team_id: string | null;
};
type LinkGroup = { id: string; name: string; created_at: string };
type LinkMember = { group_id: string; game_id: string; sort_order: number };
type Range = "all" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "custom";
type Completeness =
  | "all"
  | "unassigned"
  | "partial"
  | "awaiting"
  | "confirmed"
  | "attention";
type GameSort =
  | "default"
  | "game"
  | "location"
  | "time"
  | "power"
  | "status"
  | "assignments";
const gameStatusOptions = [
  ["active", "Active"],
  ["suspended", "Hold"],
  ["canceled", "Cancelled"],
  ["rained_out", "Rain Out"],
] as const;
function miles(
  a: number | null,
  b: number | null,
  c: number | null,
  d: number | null,
) {
  if ([a, b, c, d].some((x) => x == null)) return null;
  const r = 3958.7613,
    p = Math.PI / 180,
    dlat = (c! - a!) * p,
    dlon = (d! - b!) * p,
    q =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(a! * p) * Math.cos(c! * p) * Math.sin(dlon / 2) ** 2;
  return r * 2 * Math.asin(Math.sqrt(q));
}
function overlaps(
  aStart: string,
  aMinutes: number,
  bStart: string,
  bMinutes: number,
) {
  const a = new Date(aStart).getTime(),
    b = new Date(bStart).getTime();
  return a < b + bMinutes * 60000 && b < a + aMinutes * 60000;
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
export default function AssignmentsManagerV2() {
  const supabase = useMemo(() => createClient(), []);
  const [games, setGames] = useState<Game[]>([]),
    [officials, setOfficials] = useState<Official[]>([]),
    [positions, setPositions] = useState<Position[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [ranks, setRanks] = useState<Record<string, number>>({}),
    [positionRanks, setPositionRanks] = useState<Record<string, PositionRank>>(
      {},
    ),
    [powers, setPowers] = useState<Record<string, number>>({}),
    [leagueElig, setLeagueElig] = useState<EligL[]>([]),
    [levelElig, setLevelElig] = useState<EligV[]>([]),
    [blocks, setBlocks] = useState<Block[]>([]),
    [selected, setSelected] = useState(""),
    [range, setRange] = useState<Range>("all"),
    [customDate, setCustomDate] = useState(""),
    [showCalendar, setShowCalendar] = useState(false),
    [unpublishedOnly, setUnpublishedOnly] = useState(false),
    [completenessFilter, setCompletenessFilter] = useState<Completeness>("all"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(""),
    [movingAssignment, setMovingAssignment] = useState(""),
    [publishing, setPublishing] = useState(false),
    [confirming, setConfirming] = useState(""),
    [gameStatusSaving, setGameStatusSaving] = useState(""),
    [canManage, setCanManage] = useState(false),
    [overrideOfficial, setOverrideOfficial] = useState(""),
    [gameSort, setGameSort] = useState<GameSort>("default"),
    [gameSortDir, setGameSortDir] = useState<"asc" | "desc">("asc"),
    [linkGroups, setLinkGroups] = useState<LinkGroup[]>([]),
    [linkMembers, setLinkMembers] = useState<LinkMember[]>([]),
    [linkSelected, setLinkSelected] = useState<string[]>([]),
    [linking, setLinking] = useState(false);
  async function load() {
    setError("");
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: userRoles } = await supabase.rpc("current_user_roles");
      setCanManage(
        ((userRoles || []) as string[]).some((role) =>
          ["admin", "assignor"].includes(role),
        ),
      );
    } else setCanManage(false);
    const [g, o, p, a, r, pr, pw, le, ve, bl, lg, lm] = await Promise.all([
      supabase
        .from("games")
        .select(
          "id,game_number,status,sport_id,league_id,level_id,location_id,starts_at,duration_minutes,officials_needed,sports(name),leagues(name),levels(name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name),location:locations(id,name,city,state,latitude,longitude)",
        )
        .order("starts_at"),
      supabase
        .from("officials")
        .select(
          "id,first_name,last_name,email,phone,sports,active,home_city,home_state,home_latitude,home_longitude",
        )
        .eq("active", true),
      supabase
        .from("sport_positions")
        .select("id,sport_id,name,required,sort_order")
        .order("sort_order"),
      supabase
        .from("assignments")
        .select(
          "id,game_id,official_id,position_id,status,published_at,accept_by",
        ),
      supabase.from("official_rankings").select("official_id,rank"),
      supabase
        .from("official_soccer_position_rankings")
        .select(
          "official_id,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_rank",
        ),
      supabase.from("team_power_rankings").select("team_id,power"),
      supabase
        .from("official_league_eligibility")
        .select("official_id,league_id"),
      supabase
        .from("official_level_eligibility")
        .select("official_id,level_id"),
      supabase
        .from("official_availability_blocks")
        .select(
          "official_id,block_type,start_date,end_date,starts_at,ends_at,location_id,team_id",
        ),
      supabase
        .from("game_link_groups")
        .select("id,name,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("game_link_members")
        .select("group_id,game_id,sort_order")
        .order("sort_order"),
    ]);
    const err =
      g.error ||
      o.error ||
      p.error ||
      a.error ||
      r.error ||
      pr.error ||
      pw.error ||
      le.error ||
      ve.error ||
      bl.error ||
      lg.error ||
      lm.error;
    if (err) {
      setError(err.message);
      return;
    }
    const rm: Record<string, number> = {},
      prm: Record<string, PositionRank> = {},
      pm: Record<string, number> = {};
    ((r.data || []) as Rank[]).forEach(
      (x) => (rm[x.official_id] = Number(x.rank)),
    );
    ((pr.data || []) as PositionRank[]).forEach(
      (x) =>
        (prm[x.official_id] = {
          official_id: x.official_id,
          ref_rank: Number(x.ref_rank),
          ar1_rank: Number(x.ar1_rank),
          ar2_rank: Number(x.ar2_rank),
          fourth_rank: Number(x.fourth_rank),
          mentor_rank: Number(x.mentor_rank),
        }),
    );
    ((pw.data || []) as Power[]).forEach(
      (x) => (pm[x.team_id] = Number(x.power)),
    );
    setRanks(rm);
    setPositionRanks(prm);
    setPowers(pm);
    setOfficials((o.data || []) as Official[]);
    setPositions((p.data || []) as Position[]);
    setAssignments((a.data || []) as Assignment[]);
    setLeagueElig((le.data || []) as EligL[]);
    setLevelElig((ve.data || []) as EligV[]);
    setBlocks((bl.data || []) as Block[]);
    setLinkGroups((lg.data || []) as LinkGroup[]);
    setLinkMembers((lm.data || []) as LinkMember[]);
    const sorted = ((g.data || []) as unknown as Game[]).sort(
      (x, y) =>
        gamePower(y, pm) - gamePower(x, pm) ||
        new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime(),
    );
    setGames(sorted);
    if (!selected && sorted[0]) setSelected(sorted[0].id);
  }
  useEffect(() => {
    void load();
  }, []);
  function gamePower(g: Game, map = powers) {
    return (
      ((g.home ? (map[g.home.id] ?? 1) : 1) +
        (g.away ? (map[g.away.id] ?? 1) : 1)) /
      2
    );
  }
  function isUnpublishedGame(g: Game) {
    const ga = assignments.filter(
      (a) => a.game_id === g.id && a.status !== "declined",
    );
    return ga.length > 0 && ga.some((a) => !a.published_at);
  }
  function assignmentCompleteness(g: Game) {
    const slots = positions
        .filter((position) => position.sport_id === g.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .slice(0, Math.max(0, g.officials_needed)),
      active = assignments.filter(
        (assignment) =>
          assignment.game_id === g.id &&
          assignment.status !== "declined" &&
          slots.some((slot) => slot.id === assignment.position_id),
      ),
      filled = new Set(active.map((assignment) => assignment.position_id)).size;
    if (!slots.length || filled === 0)
      return { key: "unassigned" as const, label: "Unassigned", color: "#dc2626", detail: "No assignment slots are filled" };
    if (filled < slots.length)
      return { key: "partial" as const, label: "Partially Assigned", color: "#ea580c", detail: `${filled} of ${slots.length} slots filled` };
    if (active.every((assignment) => ["accepted", "confirmed"].includes(assignment.status)))
      return { key: "confirmed" as const, label: "Confirmed", color: "#16a34a", detail: "Every assignment is confirmed" };
    if (active.every((assignment) => Boolean(assignment.published_at)))
      return { key: "awaiting" as const, label: "Awaiting Confirmation", color: "#ca8a04", detail: "Published; waiting for one or more confirmations" };
    return { key: "attention" as const, label: "Needs Attention", color: "#2563eb", detail: "All slots are filled but one or more assignments still need publishing" };
  }
  const rangeGames = games.filter((g) => inRange(g, range, customDate));
  const baseFilteredGames = rangeGames.filter(
    (g) =>
      (!unpublishedOnly || isUnpublishedGame(g)) &&
      (completenessFilter === "all" ||
        assignmentCompleteness(g).key === completenessFilter),
  );
  function compareGames(a: Game, b: Game) {
    let n = 0;
    if (gameSort === "game")
      n = `${a.home?.name || ""} ${a.away?.name || ""}`.localeCompare(
        `${b.home?.name || ""} ${b.away?.name || ""}`,
      );
    else if (gameSort === "location")
      n = (a.location?.name || "").localeCompare(b.location?.name || "");
    else if (gameSort === "time")
      n = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    else if (gameSort === "power") n = gamePower(a) - gamePower(b);
    else if (gameSort === "status")
      n = (a.status === "open" ? "active" : a.status).localeCompare(
        b.status === "open" ? "active" : b.status,
      );
    else if (gameSort === "assignments")
      n = assignmentCompleteness(a).label.localeCompare(
        assignmentCompleteness(b).label,
      );
    else
      n =
        gamePower(b) - gamePower(a) ||
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    if (n === 0)
      n = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    return gameSortDir === "desc" ? -n : n;
  }
  const linkGroupByGame = new Map(
    linkMembers.map((member) => [member.game_id, member.group_id]),
  );
  const linkOrderByGame = new Map(
    linkMembers.map((member) => [member.game_id, member.sort_order]),
  );
  const groupedGames = new Map<string, Game[]>();
  const unlinkedGames: Game[] = [];
  for (const currentGame of baseFilteredGames) {
    const groupId = linkGroupByGame.get(currentGame.id);
    if (!groupId) unlinkedGames.push(currentGame);
    else {
      const group = groupedGames.get(groupId) || [];
      group.push(currentGame);
      groupedGames.set(groupId, group);
    }
  }
  const gameUnits: { key: string; groupId: string | null; games: Game[] }[] = [
    ...Array.from(groupedGames.entries()).map(([groupId, linked]) => ({
      key: groupId,
      groupId,
      games: linked.sort(
        (a, b) =>
          (linkOrderByGame.get(a.id) || 0) - (linkOrderByGame.get(b.id) || 0),
      ),
    })),
    ...unlinkedGames.map((single) => ({
      key: `single-${single.id}`,
      groupId: null,
      games: [single],
    })),
  ].sort((a, b) => compareGames(a.games[0], b.games[0]));
  const filteredGames = gameUnits.flatMap((unit) => unit.games);
  function sortGames(by: Exclude<GameSort, "default">) {
    if (gameSort === by) setGameSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setGameSort(by);
      setGameSortDir("asc");
    }
  }
  function sortArrow(by: Exclude<GameSort, "default">) {
    return gameSort === by ? (gameSortDir === "asc" ? " ▲" : " ▼") : "";
  }
  function toggleLinkSelection(gameId: string) {
    setLinkSelected((current) =>
      current.includes(gameId)
        ? current.filter((id) => id !== gameId)
        : [...current, gameId],
    );
  }
  async function linkGames() {
    if (linkSelected.length < 2) return;
    setLinking(true);
    setError("");
    setNotice("");
    const alreadyLinked = linkSelected.some((id) => linkGroupByGame.has(id));
    if (alreadyLinked) {
      setError(
        "Unlink selected games from their current group before linking them again.",
      );
      setLinking(false);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data: group, error: groupError } = await supabase
      .from("game_link_groups")
      .insert({ name: "Linked Games", created_by: userData.user?.id || null })
      .select("id")
      .single();
    if (groupError || !group) {
      setError(groupError?.message || "Unable to link games.");
      setLinking(false);
      return;
    }
    const orderedIds = filteredGames
      .filter((listedGame) => linkSelected.includes(listedGame.id))
      .map((listedGame) => listedGame.id);
    const { error: memberError } = await supabase
      .from("game_link_members")
      .insert(
        orderedIds.map((game_id, sort_order) => ({
          group_id: group.id,
          game_id,
          sort_order,
        })),
      );
    if (memberError) {
      await supabase.from("game_link_groups").delete().eq("id", group.id);
      setError(memberError.message);
    } else {
      setNotice(`${orderedIds.length} games linked and grouped together.`);
      setLinkSelected([]);
    }
    await load();
    setLinking(false);
  }
  async function unlinkGames(groupId: string) {
    if (
      !window.confirm(
        "Unlink these games? The games and assignments will remain.",
      )
    )
      return;
    setLinking(true);
    setError("");
    const { error: deleteError } = await supabase
      .from("game_link_groups")
      .delete()
      .eq("id", groupId);
    if (deleteError) setError(deleteError.message);
    else setNotice("Games unlinked.");
    await load();
    setLinking(false);
  }
  const game = games.find((g) => g.id === selected);
  const sportPositions = game
    ? positions
        .filter((p) => p.sport_id === game.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const gamePositions = game
    ? sportPositions.slice(
        0,
        Math.max(0, Math.min(game.officials_needed, sportPositions.length)),
      )
    : [];
  const gameAssignments = game
    ? assignments.filter((a) => a.game_id === game.id)
    : [];
  const unpublishedCount = gameAssignments.filter(
    (a) => !a.published_at,
  ).length;
  function chooseRange(r: Range) {
    setRange(r);
    setShowCalendar(false);
    setOverrideOfficial("");
    const list = games.filter(
      (g) =>
        inRange(g, r, customDate) &&
        (!unpublishedOnly || isUnpublishedGame(g)) &&
        (completenessFilter === "all" || assignmentCompleteness(g).key === completenessFilter),
    );
    if (!list.some((g) => g.id === selected)) setSelected(list[0]?.id || "");
  }
  function chooseDate(value: string) {
    setCustomDate(value);
    setRange("custom");
    setOverrideOfficial("");
    const list = games.filter(
      (g) =>
        inRange(g, "custom", value) &&
        (!unpublishedOnly || isUnpublishedGame(g)) &&
        (completenessFilter === "all" || assignmentCompleteness(g).key === completenessFilter),
    );
    setSelected(list[0]?.id || "");
  }
  function toggleUnpublished() {
    const next = !unpublishedOnly;
    setUnpublishedOnly(next);
    setOverrideOfficial("");
    const list = games.filter(
      (g) =>
        inRange(g, range, customDate) &&
        (!next || isUnpublishedGame(g)) &&
        (completenessFilter === "all" || assignmentCompleteness(g).key === completenessFilter),
    );
    if (!list.some((g) => g.id === selected)) setSelected(list[0]?.id || "");
  }
  function chooseCompleteness(value: Completeness) {
    setCompletenessFilter(value);
    setOverrideOfficial("");
    const list = games.filter(
      (listedGame) =>
        inRange(listedGame, range, customDate) &&
        (!unpublishedOnly || isUnpublishedGame(listedGame)) &&
        (value === "all" || assignmentCompleteness(listedGame).key === value),
    );
    if (!list.some((listedGame) => listedGame.id === selected))
      setSelected(list[0]?.id || "");
  }
  function assignmentConflictReasons(o: Official, ignorePositionId = "") {
    if (!game) return [];
    const reasons: string[] = [];
    for (const a of assignments) {
      if (a.official_id !== o.id || a.status === "declined") continue;
      if (
        ignorePositionId &&
        a.game_id === game.id &&
        a.position_id === ignorePositionId
      )
        continue;
      const other = games.find((g) => g.id === a.game_id);
      if (
        other &&
        overlaps(
          game.starts_at,
          game.duration_minutes || 110,
          other.starts_at,
          other.duration_minutes || 110,
        )
      ) {
        const when = new Date(other.starts_at).toLocaleString([], {
          dateStyle: "short",
          timeStyle: "short",
        });
        reasons.push(
          `Overlaps Game #${other.game_number} (${other.home?.name || "TBD"} vs ${other.away?.name || "TBD"}) at ${when}`,
        );
      }
    }
    return reasons;
  }
  function workingAtGameTime(o: Official, ignorePositionId = "") {
    return assignmentConflictReasons(o, ignorePositionId).length > 0;
  }
  function ineligibleReasons(o: Official, ignorePositionId = "") {
    if (!game) return [];
    const reasons: string[] = [];
    reasons.push(...assignmentConflictReasons(o, ignorePositionId));
    const day = game.starts_at.slice(0, 10),
      gs = new Date(game.starts_at).getTime(),
      ge = gs + (game.duration_minutes || 110) * 60000;
    for (const b of blocks) {
      if (b.official_id !== o.id) continue;
      if (
        b.starts_at &&
        b.ends_at &&
        new Date(b.starts_at).getTime() < ge &&
        new Date(b.ends_at).getTime() > gs
      )
        reasons.push(
          `Unavailable from ${new Date(b.starts_at).toLocaleString()} to ${new Date(b.ends_at).toLocaleString()}`,
        );
      else if (
        b.block_type === "date" &&
        b.start_date &&
        b.end_date &&
        day >= b.start_date &&
        day <= b.end_date
      )
        reasons.push(`Unavailable from ${b.start_date} through ${b.end_date}`);
      else if (
        b.block_type === "location" &&
        b.location_id === game.location_id
      )
        reasons.push(`Blocked at ${game.location?.name || "this location"}`);
      else if (
        b.block_type === "team" &&
        b.team_id &&
        (b.team_id === game.home?.id || b.team_id === game.away?.id)
      )
        reasons.push(
          `Blocked for ${b.team_id === game.home?.id ? game.home?.name : game.away?.name || "this team"}`,
        );
    }
    if (
      !o.sports.some((s) => s.toLowerCase() === game.sports?.name.toLowerCase())
    )
      reasons.push(`Not eligible for ${game.sports?.name || "sport"}`);
    const ol = leagueElig.filter((x) => x.official_id === o.id),
      ov = levelElig.filter((x) => x.official_id === o.id);
    if (
      game.league_id &&
      ol.length &&
      !ol.some((x) => x.league_id === game.league_id)
    )
      reasons.push(`Not eligible for league ${game.leagues?.name || "selected league"}`);
    if (
      game.level_id &&
      ov.length &&
      !ov.some((x) => x.level_id === game.level_id)
    )
      reasons.push(`Not eligible for level ${game.levels?.name || "selected level"}`);
    if (
      assignments.some(
        (a) =>
          a.game_id === game.id &&
          a.official_id === o.id &&
          a.status !== "declined" &&
          !(ignorePositionId && a.position_id === ignorePositionId),
      )
    )
      reasons.push("Already assigned to this game");
    return [...new Set(reasons)];
  }
  function eligible(o: Official) {
    return ineligibleReasons(o).length === 0;
  }
  function daysSinceTeam(
    officialId: string,
    teamId: string | null | undefined,
  ) {
    if (!game || !teamId) return null;
    const target = new Date(game.starts_at).getTime();
    let last = 0;
    for (const a of assignments) {
      if (
        a.official_id !== officialId ||
        !["accepted", "confirmed"].includes(a.status)
      )
        continue;
      const g = games.find((x) => x.id === a.game_id);
      if (!g) continue;
      const t = new Date(g.starts_at).getTime();
      if (t >= target) continue;
      if (g.home?.id === teamId || g.away?.id === teamId)
        last = Math.max(last, t);
    }
    return last ? Math.max(0, Math.floor((target - last) / 86400000)) : null;
  }
  function hasFutureTeamAssignment(officialId: string) {
    if (!game) return false;
    const target = new Date(game.starts_at).getTime(),
      teamIds = [game.home?.id, game.away?.id].filter(Boolean);
    if (!teamIds.length) return false;
    return assignments.some((a) => {
      if (
        a.official_id !== officialId ||
        a.game_id === game.id ||
        a.status === "declined"
      )
        return false;
      const g = games.find((x) => x.id === a.game_id);
      if (!g || new Date(g.starts_at).getTime() <= target) return false;
      return teamIds.includes(g.home?.id) || teamIds.includes(g.away?.id);
    });
  }
  function futureBadge(officialId: string) {
    return hasFutureTeamAssignment(officialId) ? (
      <span
        title="This official already has a later assignment involving one of these teams"
        style={{
          display: "inline-block",
          marginLeft: 6,
          background: "#2563eb",
          color: "#fff",
          borderRadius: 6,
          padding: "2px 6px",
          fontSize: 10,
          fontWeight: 800,
          verticalAlign: "middle",
        }}
      >
        Future+
      </span>
    ) : null;
  }
  function teamRecencyLabel(officialId: string) {
    if (!game) return "";
    const h = daysSinceTeam(officialId, game.home?.id),
      a = daysSinceTeam(officialId, game.away?.id);
    return ` • ${game.home?.name || "Home"} ${h == null ? "Never" : `${h}d`} • ${game.away?.name || "Away"} ${a == null ? "Never" : `${a}d`}`;
  }
  function isMentor(pos: Position) {
    return pos.name.toLowerCase().includes("mentor");
  }
  function positionRankFor(officialId: string, pos: Position) {
    const pr = positionRanks[officialId],
      name = pos.name.toLowerCase();
    if (isMentor(pos)) return pr?.mentor_rank ?? 1;
    if (name.includes("assistant referee 1") || name === "ar1")
      return pr?.ar1_rank ?? ranks[officialId] ?? 1;
    if (name.includes("assistant referee 2") || name === "ar2")
      return pr?.ar2_rank ?? ranks[officialId] ?? 1;
    if (name.includes("4th") || name.includes("fourth"))
      return pr?.fourth_rank ?? ranks[officialId] ?? 1;
    if (
      name.includes("center") ||
      name === "ref" ||
      (name.includes("referee") && !name.includes("assistant"))
    )
      return pr?.ref_rank ?? ranks[officialId] ?? 1;
    return ranks[officialId] ?? 1;
  }
  function rankLabel(pos: Position) {
    const name = pos.name.toLowerCase();
    if (isMentor(pos)) return "Mentor";
    if (name.includes("assistant referee 1") || name === "ar1") return "AR1";
    if (name.includes("assistant referee 2") || name === "ar2") return "AR2";
    if (name.includes("4th") || name.includes("fourth")) return "4th";
    if (
      name.includes("center") ||
      name === "ref" ||
      (name.includes("referee") && !name.includes("assistant"))
    )
      return "REF";
    return "Rank";
  }
  function candidates(pos: Position) {
    if (!game) return [];
    const current = assignments.find(
        (a) => a.game_id === game.id && a.position_id === pos.id,
      ),
      used = new Set(
        assignments
          .filter((a) => a.game_id === game.id && a.position_id !== pos.id)
          .map((a) => a.official_id),
      );
    return officials
      .filter(
        (o) =>
          !workingAtGameTime(o, pos.id) &&
          (eligible(o) || canManage || current?.official_id === o.id) &&
          !used.has(o.id) &&
          (!isMentor(pos) ||
            positionRankFor(o.id, pos) > 1 ||
            canManage ||
            current?.official_id === o.id),
      )
      .map((o) => ({
        ...o,
        distance: miles(
          o.home_latitude,
          o.home_longitude,
          game.location?.latitude ?? null,
          game.location?.longitude ?? null,
        ),
        rank: positionRankFor(o.id, pos),
        reasons: ineligibleReasons(o, pos.id).filter(
          (r) =>
            !(
              current?.official_id === o.id &&
              r === "Already assigned to this game"
            ),
        ),
      }))
      .sort(
        (a, b) =>
          (a.reasons.length ? 1 : 0) - (b.reasons.length ? 1 : 0) ||
          b.rank - a.rank ||
          (a.distance ?? 9999) - (b.distance ?? 9999),
      );
  }
  const availableOfficials = game
    ? officials
        .filter((o) => eligible(o) && !workingAtGameTime(o))
        .map((o) => ({
          ...o,
          rank: ranks[o.id] ?? 1,
          distance: miles(
            o.home_latitude,
            o.home_longitude,
            game.location?.latitude ?? null,
            game.location?.longitude ?? null,
          ),
        }))
        .sort(
          (a, b) =>
            b.rank - a.rank || (a.distance ?? 9999) - (b.distance ?? 9999),
        )
    : [];
  const ineligibleOfficials = game
    ? officials
        .map((o) => ({ ...o, reasons: ineligibleReasons(o) }))
        .filter((o) => o.reasons.length > 0)
        .sort(
          (a, b) =>
            a.last_name.localeCompare(b.last_name) ||
            a.first_name.localeCompare(b.first_name),
        )
    : [];
  async function assign(positionId: string, officialId: string) {
    if (!game) return;
    const official = officials.find((o) => o.id === officialId);
    if (officialId && official && workingAtGameTime(official, positionId)) {
      setError(
        `${official.first_name} ${official.last_name} cannot be assigned: ${assignmentConflictReasons(official, positionId).join("; ")}.`,
      );
      return;
    }
    const reasons = official
      ? ineligibleReasons(official, positionId).filter(
          (r) => r !== "Already assigned to this game",
        )
      : [];
    if (officialId && reasons.length) {
      if (!canManage) {
        setError("This official is not eligible for this game.");
        return;
      }
      if (
        !window.confirm(
          `Override eligibility and assign ${official?.first_name} ${official?.last_name}?\n\nWarning: ${reasons.join(", ")}`,
        )
      )
        return;
    }
    setSaving(positionId);
    setError("");
    setNotice("");
    const existing = assignments.find(
      (a) => a.game_id === game.id && a.position_id === positionId,
    );
    let result;
    if (!officialId && existing)
      result = await supabase
        .from("assignments")
        .delete()
        .eq("id", existing.id);
    else if (officialId)
      result = await supabase.rpc("assign_official_to_linked_games", {
        p_game_id: game.id,
        p_position_id: positionId,
        p_official_id: officialId,
      });
    if (!result) {
      setSaving("");
      return;
    }
    if (result.error) setError(result.error.message);
    else if (officialId) {
      const linkedCount = Number(result.data || 1);
      setNotice(
        `${official?.first_name} ${official?.last_name} assigned to ${linkedCount} ${linkedCount === 1 ? "game" : "linked games"}${reasons.length ? " with an eligibility override" : ""}.`,
      );
    }
    await load();
    setSaving("");
    setOverrideOfficial("");
  }
  async function moveAssignment(
    gameId: string,
    assignmentId: string,
    direction: -1 | 1,
  ) {
    if (!canManage) return;
    setMovingAssignment(assignmentId);
    setError("");
    setNotice("");
    const { error: moveError } = await supabase.rpc(
      "move_assignment_position",
      {
        p_game_id: gameId,
        p_assignment_id: assignmentId,
        p_direction: direction,
      },
    );
    if (moveError) setError(moveError.message);
    else setNotice("Official positions updated.");
    await load();
    setMovingAssignment("");
  }
  async function unassign(assignmentId: string, positionId: string) {
    if (!canManage) {
      setError("Only Administrators and Assignors can unassign officials.");
      return;
    }
    setSaving(positionId);
    setError("");
    setNotice("");
    const { error: deleteError } = await supabase
      .from("assignments")
      .delete()
      .eq("id", assignmentId);
    if (deleteError) setError(deleteError.message);
    await load();
    setSaving("");
  }
  async function confirmAssignment(a: Assignment) {
    if (
      !canManage ||
      !a.published_at ||
      a.status === "declined" ||
      a.status === "confirmed"
    )
      return;
    setConfirming(a.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/assignments/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: a.id }),
      });
      const result = (await response.json()) as {
        confirmed?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to confirm assignment.");
      setNotice(
        "Assignment confirmed and confirmed game information emailed to the official.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to confirm assignment.",
      );
    }
    await load();
    setConfirming("");
  }
  async function changeGameStatus(gameId: string, status: string) {
    if (!canManage) {
      setError("Only Administrators and Assignors can change game status.");
      return;
    }
    setGameStatusSaving(gameId);
    setError("");
    setNotice("");
    const { error: statusError } = await supabase.rpc("set_game_status", {
      p_game_id: gameId,
      p_status: status,
    });
    if (statusError) setError(statusError.message);
    else {
      setGames((current) =>
        current.map((listedGame) =>
          listedGame.id === gameId
            ? { ...listedGame, status }
            : listedGame,
        ),
      );
      setNotice(
        `Game status changed to ${gameStatusOptions.find(([value]) => value === status)?.[1] || status}.`,
      );
    }
    setGameStatusSaving("");
  }
  async function publishAssignments() {
    if (!game || unpublishedCount === 0) return;
    setPublishing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/assignments/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: game.id }),
      });
      const result = (await response.json()) as {
        sent?: number;
        failed?: number;
        failures?: string[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to publish assignments.");
      if (result.failed)
        setError(
          `${result.sent || 0} assignment email${result.sent === 1 ? "" : "s"} sent. ${result.failed} failed: ${(result.failures || []).join("; ")}`,
        );
      else
        setNotice(
          `${result.sent || 0} assignment email${result.sent === 1 ? "" : "s"} sent successfully.`,
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to publish assignments.",
      );
    }
    await load();
    setPublishing(false);
  }
  function assignmentStatus(a: Assignment) {
    if (a.status === "accepted" || a.status === "confirmed")
      return { label: "Accepted", className: "badge green" };
    if (a.status === "declined")
      return { label: "Declined", className: "badge red" };
    if (a.published_at)
      return { label: "Under Review", className: "badge yellow" };
    return { label: "Not Published", className: "badge blue" };
  }
  function formatDeadline(value: string | null) {
    return value ? new Date(value).toLocaleString() : "";
  }
  async function exportAssignments() {
    const XLSX = await import("xlsx");
    const positionNames: string[] = [];
    for (const g of filteredGames) {
      const gp = positions
        .filter((p) => p.sport_id === g.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .slice(0, Math.max(0, g.officials_needed));
      for (const pos of gp)
        if (!positionNames.includes(pos.name)) positionNames.push(pos.name);
    }
    const data = filteredGames.map((g) => {
      const d = new Date(g.starts_at),
        row: Record<string, string | number> = {
          "Game Number": g.game_number,
          Date: d.toLocaleDateString(),
          Time: d.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          Sport: g.sports?.name || "",
          League: g.leagues?.name || "",
          "Home Team": g.home?.name || "TBD",
          "Away Team": g.away?.name || "TBD",
          Location: g.location?.name || "TBD",
          Power: Number(gamePower(g).toFixed(1)),
        };
      for (const name of positionNames) {
        row[`${name} Official`] = "";
        row[`${name} Email`] = "";
        row[`${name} Phone`] = "";
        row[`${name} Status`] = "";
        row[`${name} Published`] = "";
        row[`${name} Accept By`] = "";
      }
      const gp = positions
        .filter((p) => p.sport_id === g.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .slice(0, Math.max(0, g.officials_needed));
      for (const pos of gp) {
        const a = assignments.find(
            (x) =>
              x.game_id === g.id &&
              x.position_id === pos.id &&
              x.status !== "declined",
          ),
          o = a ? officials.find((x) => x.id === a.official_id) : undefined;
        row[`${pos.name} Official`] = o
          ? `${o.first_name} ${o.last_name}`
          : "UNASSIGNED";
        row[`${pos.name} Email`] = o?.email || "";
        row[`${pos.name} Phone`] = o?.phone || "";
        row[`${pos.name} Status`] = a
          ? assignmentStatus(a).label
          : "Unassigned";
        row[`${pos.name} Published`] = a?.published_at ? "Yes" : "No";
        row[`${pos.name} Accept By`] = a?.accept_by
          ? new Date(a.accept_by).toLocaleString()
          : "";
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data),
      wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assignments");
    XLSX.writeFile(wb, "refassign-game-assignments.xlsx");
  }
  const filters: [Range, string][] = [
    ["all", "All Games"],
    ["today", "Today's Games"],
    ["tomorrow", "Tomorrow's Games"],
    ["thisWeek", "This Week"],
    ["nextWeek", "Next Week"],
  ];
  function renderGameRow(g: Game, linked: boolean, showChain: boolean) {
    const d = new Date(g.starts_at);
    const completeness = assignmentCompleteness(g);
    const normalizedStatus = g.status === "open" ? "active" : g.status;
    const isRainOut = normalizedStatus === "rained_out";
    const statusBackground =
      normalizedStatus === "canceled"
        ? "#fee2e2"
        : normalizedStatus === "suspended"
          ? "#fef9c3"
          : isRainOut
            ? "#1e3a8a"
            : null;
    const statusBorder =
      normalizedStatus === "canceled"
        ? "#fecaca"
        : normalizedStatus === "suspended"
          ? "#fde68a"
          : isRainOut
            ? "#1e40af"
            : null;
    const gamePositionsForRow = positions
      .filter((p) => p.sport_id === g.sport_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .slice(0, Math.max(0, g.officials_needed));
    return (
      <div
        key={g.id}
        style={{
          display: "grid",
          gridTemplateColumns:
            "38px minmax(230px,1fr) minmax(150px,220px) 105px 90px 125px minmax(390px,auto)",
          alignItems: "center",
          gap: 10,
          padding: "9px 12px",
          borderBottom: `1px solid ${statusBorder || (linked ? "#bfdbfe" : "#e2e8f0")}`,
          background:
            statusBackground ||
            (linked ? "#eff6ff" : selected === g.id ? "#f8fafc" : "#fff"),
          color: isRainOut ? "#fff" : "inherit",
        }}
      >
        <label
          title={
            linked
              ? "Unlink this group before selecting this game"
              : "Select game to link"
          }
          style={{ display: "flex", justifyContent: "center" }}
        >
          <input
            type="checkbox"
            aria-label={`Select game ${g.game_number} to link`}
            checked={linkSelected.includes(g.id)}
            disabled={linked || linking}
            onChange={() => toggleLinkSelection(g.id)}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setSelected(g.id);
            setOverrideOfficial("");
          }}
          style={{
            border: 0,
            background: "transparent",
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 800 }}>
            {showChain && (
              <span aria-hidden="true" style={{ marginRight: 8 }}>
                🔗
              </span>
            )}
            {g.home?.name || "TBD"} vs {g.away?.name || "TBD"}
            <small style={{ marginLeft: 7, color: isRainOut ? "#bfdbfe" : "#64748b" }}>
              • {g.game_number}
            </small>
          </span>
          <small style={{ display: "block", color: isRainOut ? "#dbeafe" : "#64748b", marginTop: 3 }}>
            {d.toLocaleDateString()}
          </small>
        </button>
        <span style={{ color: isRainOut ? "#fff" : "#475569", fontSize: 12, fontWeight: 700 }}>
          {g.location?.name || "TBD"}
        </span>
        <span
          style={{
            color: isRainOut ? "#fff" : "#475569",
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <span
          title="Average of the home and away team power rankings"
          style={{
            color: isRainOut ? "#fff" : "#7c3aed",
            fontSize: 13,
            fontWeight: 900,
          }}
        >
          {gamePower(g).toFixed(1)}
        </span>
        <select
          aria-label={`Status for game ${g.game_number}`}
          disabled={!canManage || gameStatusSaving === g.id}
          value={g.status === "open" ? "active" : g.status}
          onChange={(event) => void changeGameStatus(g.id, event.target.value)}
          style={{ width: "100%", minWidth: 115, padding: "6px 7px" }}
        >
          {gameStatusOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "5px 12px",
            flexWrap: "wrap",
            fontSize: 11,
          }}
        >
          <span
            title={completeness.detail}
            style={{
              border: `1px solid ${completeness.color}`,
              color: isRainOut ? "#fff" : completeness.color,
              background: isRainOut ? "rgba(255,255,255,.12)" : "#fff",
              borderRadius: 999,
              padding: "3px 7px",
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            {completeness.label}
          </span>
          {gamePositionsForRow.map((pos, positionIndex) => {
            const assignment = assignments.find(
              (item) =>
                item.game_id === g.id &&
                item.position_id === pos.id &&
                item.status !== "declined",
            );
            const official = assignment
              ? officials.find((item) => item.id === assignment.official_id)
              : undefined;
            const color = !assignment
              ? "#dc2626"
              : !assignment.published_at
                ? "#2563eb"
                : ["accepted", "confirmed"].includes(assignment.status)
                  ? "#16a34a"
                  : "#ca8a04";
            return (
              <div
                key={pos.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  whiteSpace: "nowrap",
                }}
              >
                <span>
                  <b style={{ color: isRainOut ? "#bfdbfe" : assignment ? "#64748b" : "#dc2626" }}>
                    {pos.name}
                  </b>
                  {official ? (
                    <b style={{ color: isRainOut ? "#fff" : color }}>
                      {" "}
                      {official.first_name} {official.last_name}
                    </b>
                  ) : (
                    <b style={{ color: "#dc2626" }}> Unassigned</b>
                  )}
                </span>
                {assignment && canManage && (
                  <>
                    <span
                      style={{
                        display: "inline-flex",
                        gap: 3,
                        marginRight: 2,
                        alignItems: "center",
                      }}
                    >
                      <button
                        type="button"
                        aria-label={`Move ${official ? `${official.first_name} ${official.last_name}` : "official"} to the previous position`}
                        title="Move left; swaps with the adjacent official"
                        disabled={
                          positionIndex === 0 ||
                          movingAssignment === assignment.id
                        }
                        onClick={() =>
                          void moveAssignment(g.id, assignment.id, -1)
                        }
                        style={{
                          padding: "5px 8px",
                          fontSize: 14,
                          lineHeight: 1,
                          borderRadius: 6,
                          border: "1px solid #1d4ed8",
                          background: positionIndex === 0 ? "#cbd5e1" : "#2563eb",
                          color: "#fff",
                          fontWeight: 900,
                          cursor: positionIndex === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${official ? `${official.first_name} ${official.last_name}` : "official"} to the next position`}
                        title="Move right; swaps with the adjacent official"
                        disabled={
                          positionIndex === gamePositionsForRow.length - 1 ||
                          movingAssignment === assignment.id
                        }
                        onClick={() =>
                          void moveAssignment(g.id, assignment.id, 1)
                        }
                        style={{
                          padding: "5px 8px",
                          fontSize: 14,
                          lineHeight: 1,
                          borderRadius: 6,
                          border: "1px solid #1d4ed8",
                          background:
                            positionIndex === gamePositionsForRow.length - 1
                              ? "#cbd5e1"
                              : "#2563eb",
                          color: "#fff",
                          fontWeight: 900,
                          cursor:
                            positionIndex === gamePositionsForRow.length - 1
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        →
                      </button>
                    </span>
                    <button
                      type="button"
                      disabled={
                        confirming === assignment.id ||
                        !assignment.published_at ||
                        assignment.status === "confirmed"
                      }
                      title={
                        !assignment.published_at
                          ? "Publish this assignment before confirming it"
                          : assignment.status === "confirmed"
                            ? "This assignment is confirmed"
                            : "Confirm this official"
                      }
                      onClick={() => void confirmAssignment(assignment)}
                      style={{
                        background: "#facc15",
                        color: "#713f12",
                        border: "1px solid #eab308",
                        borderRadius: 6,
                        padding: "4px 7px",
                        fontSize: 10,
                        fontWeight: 800,
                        cursor:
                          !assignment.published_at ||
                          assignment.status === "confirmed"
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          !assignment.published_at ||
                          assignment.status === "confirmed"
                            ? 0.55
                            : 1,
                      }}
                    >
                      {confirming === assignment.id
                        ? "Confirming…"
                        : assignment.status === "confirmed"
                          ? "Confirmed"
                          : "Confirm"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={saving === pos.id}
                      onClick={() => void unassign(assignment.id, pos.id)}
                      style={{ padding: "4px 7px", fontSize: 10 }}
                    >
                      {saving === pos.id ? "Unassigning…" : "Unassign"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Assignment Center</h2>
            <p>
              Rank, team recency, distance, availability and game-time conflicts
              are applied when selecting officials.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canManage && (
              <button
                className="secondary"
                disabled={!filteredGames.length}
                onClick={() => void exportAssignments()}
              >
                Export Assignments
              </button>
            )}
            <button
              className="primary"
              disabled={!game || unpublishedCount === 0 || publishing}
              onClick={() => void publishAssignments()}
            >
              {publishing
                ? "Publishing & Sending…"
                : `Publish${unpublishedCount ? ` (${unpublishedCount})` : ""}`}
            </button>
          </div>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
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
              onClick={() => chooseRange(key)}
            >
              {label} ({games.filter((g) => inRange(g, key, customDate)).length}
              )
            </button>
          ))}
          <button
            type="button"
            className={unpublishedOnly ? "primary" : "secondary"}
            onClick={toggleUnpublished}
          >
            Not Published ({rangeGames.filter(isUnpublishedGame).length})
          </button>
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
              onChange={(e) => chooseDate(e.target.value)}
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
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            margin: "-4px 0 14px",
            alignItems: "center",
          }}
        >
          <b style={{ fontSize: 12, color: "#475569" }}>Assignment status:</b>
          {(
            [
              ["all", "All"],
              ["unassigned", "Unassigned"],
              ["partial", "Partially Assigned"],
              ["awaiting", "Awaiting Confirmation"],
              ["confirmed", "Confirmed"],
              ["attention", "Needs Attention"],
            ] as [Completeness, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={completenessFilter === key ? "primary" : "secondary"}
              onClick={() => chooseCompleteness(key)}
              style={{ padding: "7px 10px", fontSize: 11 }}
            >
              {label} (
              {key === "all"
                ? rangeGames.length
                : rangeGames.filter(
                    (listedGame) => assignmentCompleteness(listedGame).key === key,
                  ).length}
              )
            </button>
          ))}
        </div>
        <div
          style={{
            margin: "14px 0",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 12px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <b>
              Assignments — {filteredGames.length} game
              {filteredGames.length === 1 ? "" : "s"}
            </b>
            <button
              type="button"
              className="primary"
              disabled={linking || linkSelected.length < 2}
              onClick={() => void linkGames()}
            >
              🔗 Link{linkSelected.length ? ` (${linkSelected.length})` : ""}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "38px minmax(230px,1fr) minmax(150px,220px) 105px 90px 125px minmax(390px,auto)",
              gap: 10,
              padding: "7px 12px",
              background: "#f8fafc",
              color: "#64748b",
              fontSize: 11,
              fontWeight: 800,
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <span />
            <button
              type="button"
              onClick={() => sortGames("game")}
              style={{ border: 0, background: "none", padding: 0, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}
            >
              Game{sortArrow("game")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("location")}
              style={{
                border: 0,
                background: "none",
                padding: 0,
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Location{sortArrow("location")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("time")}
              style={{
                border: 0,
                background: "none",
                padding: 0,
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Game Time{sortArrow("time")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("power")}
              style={{ border: 0, background: "none", padding: 0, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}
            >
              Game Ranking{sortArrow("power")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("status")}
              style={{ border: 0, background: "none", padding: 0, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}
            >
              Game Status{sortArrow("status")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("assignments")}
              style={{ border: 0, background: "none", padding: 0, textAlign: "right", font: "inherit", color: "inherit", cursor: "pointer" }}
            >
              Assignment Status{sortArrow("assignments")}
            </button>
          </div>
          <div style={{ maxHeight: 420, overflow: "auto" }}>
            {gameUnits.length ? (
              gameUnits.map((unit) => (
                <div key={unit.key}>
                  {unit.groupId && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "#dbeafe",
                        color: "#1e3a8a",
                        borderBottom: "1px solid #93c5fd",
                        fontWeight: 900,
                      }}
                    >
                      <span>🔗 Linked Games</span>
                      <button
                        type="button"
                        className="secondary"
                        disabled={linking}
                        onClick={() => void unlinkGames(unit.groupId!)}
                        style={{ padding: "5px 9px", fontSize: 11 }}
                      >
                        Unlink
                      </button>
                    </div>
                  )}
                  {unit.games.map((listedGame, index) =>
                    renderGameRow(
                      listedGame,
                      Boolean(unit.groupId),
                      Boolean(unit.groupId) && index > 0,
                    ),
                  )}
                </div>
              ))
            ) : (
              <div style={{ padding: 14, color: "#64748b" }}>
                No games in this selection.
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            margin: "14px 0",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            overflow: "hidden",
            display: "none",
          }}
        >
          <div
            style={{
              padding: "10px 12px",
              background: "#f8fafc",
              fontWeight: 800,
            }}
          >
            Assignment Status — {filteredGames.length} game
            {filteredGames.length === 1 ? "" : "s"}
          </div>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {filteredGames.length ? (
              filteredGames.map((g) => {
                const d = new Date(g.starts_at),
                  gp = positions
                    .filter((p) => p.sport_id === g.sport_id)
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .slice(0, Math.max(0, g.officials_needed));
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setSelected(g.id);
                      setOverrideOfficial("");
                    }}
                    style={{
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns:
                        "minmax(300px,1fr) minmax(390px,auto)",
                      gap: 12,
                      alignItems: "center",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: 0,
                      borderBottom: "1px solid #e2e8f0",
                      background: selected === g.id ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          lineHeight: 1.15,
                        }}
                      >
                        {g.home?.name || "TBD"} vs {g.away?.name || "TBD"}{" "}
                        <small
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          • {g.game_number}
                        </small>
                      </span>
                      <small
                        style={{
                          display: "block",
                          color: "#64748b",
                          marginTop: 3,
                          fontSize: 12,
                          lineHeight: 1.15,
                        }}
                      >
                        {d.toLocaleDateString()}{" "}
                        {d.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        • {g.location?.name || "TBD"}
                      </small>
                    </span>
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        gap: "5px 12px",
                        flexWrap: "wrap",
                        fontSize: 11,
                        lineHeight: 1.1,
                      }}
                    >
                      {gp.map((pos) => {
                        const a = assignments.find(
                            (x) =>
                              x.game_id === g.id &&
                              x.position_id === pos.id &&
                              x.status !== "declined",
                          ),
                          o = a
                            ? officials.find((x) => x.id === a.official_id)
                            : undefined,
                          color = !a
                            ? "#dc2626"
                            : !a.published_at
                              ? "#2563eb"
                              : ["accepted", "confirmed"].includes(a.status)
                                ? "#16a34a"
                                : "#ca8a04";
                        return (
                          <span key={pos.id} style={{ whiteSpace: "nowrap" }}>
                            <span
                              style={{
                                fontWeight: 800,
                                color: a ? "#64748b" : "#dc2626",
                              }}
                            >
                              {pos.name}
                            </span>
                            {o && (
                              <span style={{ fontWeight: 800, color }}>
                                {" "}
                                {o.first_name} {o.last_name}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </span>
                  </button>
                );
              })
            ) : (
              <div style={{ padding: 14, color: "#64748b" }}>
                No games in this selection.
              </div>
            )}
          </div>
        </div>
        <label style={{ display: "none" }}>
          Select Game
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setOverrideOfficial("");
            }}
          >
            <option value="">
              {filteredGames.length ? "Select a game" : "No games on this date"}
            </option>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(150px,1fr) 120px",
                gap: 8,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 800,
                color: "#64748b",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              <button
                type="button"
                onClick={() => sortGames("location")}
                style={{
                  border: 0,
                  background: "none",
                  padding: 0,
                  textAlign: "left",
                  font: "inherit",
                  fontWeight: 800,
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                Location{sortArrow("location")}
              </button>
              <button
                type="button"
                onClick={() => sortGames("time")}
                style={{
                  border: 0,
                  background: "none",
                  padding: 0,
                  textAlign: "left",
                  font: "inherit",
                  fontWeight: 800,
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                Game Time{sortArrow("time")}
              </button>
            </div>
            {filteredGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.game_number} — {new Date(g.starts_at).toLocaleDateString()} —{" "}
                {g.home?.name || "TBD"} vs {g.away?.name || "TBD"} —{" "}
                {g.duration_minutes || 110} min — Power{" "}
                {gamePower(g).toFixed(1)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {game && filteredGames.some((g) => g.id === game.id) && (
        <div className="assignmentLayout">
          <section className="card assignmentMain">
            <div className="cardHead">
              <div>
                <h2>
                  {game.home?.name || "TBD"} vs {game.away?.name || "TBD"}
                </h2>
                <div
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    marginTop: 2,
                    marginBottom: 5,
                  }}
                >
                  Game #{game.game_number}
                </div>
                <p>
                  {new Date(game.starts_at).toLocaleString()} •{" "}
                  {game.duration_minutes || 110} min • {game.sports?.name} •{" "}
                  {game.leagues?.name || "No league"} •{" "}
                  {game.location?.name || "TBD"} •{" "}
                  <b>{game.officials_needed} assignment slots</b>
                </p>
              </div>
            </div>
            {gamePositions.length === 0 ? (
              <div className="errorBox">
                No assignment positions are configured for this sport.
              </div>
            ) : (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Assigned Official</th>
                      <th>Status</th>
                      <th>Eligible Candidates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gamePositions.map((pos, index) => {
                      const current = assignments.find(
                          (a) =>
                            a.game_id === game.id && a.position_id === pos.id,
                        ),
                        list = candidates(pos),
                        label = rankLabel(pos),
                        status = current ? assignmentStatus(current) : null;
                      return (
                        <tr key={pos.id}>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              {current && canManage && (
                                <button
                                  className="primary"
                                  style={{ padding: "5px 8px", fontSize: 11 }}
                                  disabled={saving === pos.id}
                                  onClick={() =>
                                    void unassign(current.id, pos.id)
                                  }
                                >
                                  Unassign
                                </button>
                              )}
                              <div>
                                <b>{pos.name}</b>
                                <small>
                                  Slot {index + 1} of {game.officials_needed}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            {current ? (
                              <div>
                                {officials.find(
                                  (o) => o.id === current.official_id,
                                )?.first_name +
                                  " " +
                                  officials.find(
                                    (o) => o.id === current.official_id,
                                )?.last_name}
                                {futureBadge(current.official_id)}
                                {canManage && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      gap: 4,
                                      marginLeft: 8,
                                      alignItems: "center",
                                    }}
                                  >
                                    <small
                                      style={{
                                        color: "#2563eb",
                                        fontWeight: 900,
                                      }}
                                    >
                                      Position
                                    </small>
                                    <button
                                      type="button"
                                      title="Move to previous position; swaps officials when occupied"
                                      aria-label="Move official to previous position"
                                      disabled={
                                        index === 0 ||
                                        movingAssignment === current.id
                                      }
                                      onClick={() =>
                                        void moveAssignment(
                                          game.id,
                                          current.id,
                                          -1,
                                        )
                                      }
                                      style={{
                                        padding: "5px 9px",
                                        border: "1px solid #1d4ed8",
                                        borderRadius: 6,
                                        background:
                                          index === 0 ? "#cbd5e1" : "#2563eb",
                                        color: "#fff",
                                        fontSize: 14,
                                        fontWeight: 900,
                                      }}
                                    >
                                      ←
                                    </button>
                                    <button
                                      type="button"
                                      title="Move to next position; swaps officials when occupied"
                                      aria-label="Move official to next position"
                                      disabled={
                                        index === gamePositions.length - 1 ||
                                        movingAssignment === current.id
                                      }
                                      onClick={() =>
                                        void moveAssignment(
                                          game.id,
                                          current.id,
                                          1,
                                        )
                                      }
                                      style={{
                                        padding: "5px 9px",
                                        border: "1px solid #1d4ed8",
                                        borderRadius: 6,
                                        background:
                                          index === gamePositions.length - 1
                                            ? "#cbd5e1"
                                            : "#2563eb",
                                        color: "#fff",
                                        fontSize: 14,
                                        fontWeight: 900,
                                      }}
                                    >
                                      →
                                    </button>
                                  </span>
                                )}
                                {canManage &&
                                  current.published_at &&
                                  current.status !== "declined" &&
                                  current.status !== "confirmed" && (
                                    <div style={{ marginTop: 6 }}>
                                      <button
                                        type="button"
                                        disabled={confirming === current.id}
                                        onClick={() =>
                                          void confirmAssignment(current)
                                        }
                                        style={{
                                          background: "#facc15",
                                          color: "#713f12",
                                          border: "1px solid #eab308",
                                          borderRadius: 7,
                                          padding: "6px 10px",
                                          fontSize: 11,
                                          fontWeight: 800,
                                          cursor: "pointer",
                                        }}
                                      >
                                        {confirming === current.id
                                          ? "Confirming…"
                                          : "Confirm"}
                                      </button>
                                    </div>
                                  )}
                              </div>
                            ) : (
                              "Open"
                            )}
                          </td>
                          <td>
                            {current && status ? (
                              <>
                                <span className={status.className}>
                                  {status.label}
                                </span>
                                {current.published_at &&
                                  current.status === "proposed" && (
                                    <small>
                                      Accept By:{" "}
                                      {formatDeadline(current.accept_by)}
                                    </small>
                                  )}
                              </>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td>
                            <select
                              disabled={saving === pos.id}
                              value={current?.official_id || ""}
                              onChange={(e) =>
                                void assign(pos.id, e.target.value)
                              }
                            >
                              <option value="">Open / Unassign</option>
                              {list.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.reasons.length ? "⚠ OVERRIDE — " : ""}
                                  {o.first_name} {o.last_name}
                                  {o.reasons.length
                                    ? ` — ${o.reasons.join(", ")}`
                                    : ""}
                                  {hasFutureTeamAssignment(o.id)
                                    ? " — Future+"
                                    : ""}{" "}
                                  — {label} {o.rank.toFixed(1)}
                                  {teamRecencyLabel(o.id)}
                                  {o.distance != null
                                    ? ` • ${o.distance.toFixed(1)} mi`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              <small>
                <b>Future+</b> means the official already has a later
                non-declined assignment involving the home or away team in this
                game. <b>⚠ OVERRIDE</b> options are ineligible officials that an
                Administrator or Assignor may manually assign after confirming
                the warning. Officials already working during this game time are
                hidden and cannot be overridden.
              </small>
            </p>
          </section>
          <aside className="availableOfficialsPanel">
            <div className="availableOfficialsHead">
              <h3>Officials</h3>
              <span className="badge blue">
                {availableOfficials.length} Available
              </span>
            </div>
            <p>
              Eligible officials are listed first. Every unavailable official
              remains visible in red with the exact reason. Overlapping game
              assignments cannot be overridden.
            </p>
            <div className="availableOfficialsList">
              {availableOfficials.map((o, i) => (
                <div className="availableOfficial" key={o.id}>
                  <span className="availableOrder">{i + 1}</span>
                  <div>
                    <b>
                      {o.first_name} {o.last_name}
                    </b>
                    {futureBadge(o.id)}
                    <small>
                      General Rank {o.rank.toFixed(1)}
                      {teamRecencyLabel(o.id)}
                      {o.distance != null
                        ? ` • ${o.distance.toFixed(1)} mi`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
              {ineligibleOfficials.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "2px solid #fecaca",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#b91c1c",
                      marginBottom: 6,
                    }}
                  >
                    INELIGIBLE ({ineligibleOfficials.length})
                  </div>
                  {ineligibleOfficials.map((o) => (
                    <div
                      className="availableOfficial"
                      key={o.id}
                      style={{
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        color: "#b91c1c",
                      }}
                    >
                      <span
                        className="availableOrder"
                        style={{ background: "#dc2626", color: "#fff" }}
                      >
                        !
                      </span>
                      <div style={{ flex: 1 }}>
                        <b>
                          {o.first_name} {o.last_name}
                        </b>
                        <small style={{ color: "#b91c1c", fontWeight: 700 }}>
                          {o.reasons.join(" • ")}
                        </small>
                        {canManage &&
                          !o.reasons.some((reason) =>
                            reason.startsWith("Overlaps Game #"),
                          ) && (
                          <div style={{ marginTop: 6 }}>
                            <button
                              type="button"
                              onClick={() =>
                                setOverrideOfficial(
                                  overrideOfficial === o.id ? "" : o.id,
                                )
                              }
                              style={{
                                background: "#fff",
                                color: "#b91c1c",
                                border: "1px solid #dc2626",
                                borderRadius: 6,
                                padding: "4px 8px",
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              {overrideOfficial === o.id
                                ? "Cancel Override"
                                : "Override"}
                            </button>
                            {overrideOfficial === o.id && (
                              <div style={{ marginTop: 6 }}>
                                <small
                                  style={{
                                    display: "block",
                                    marginBottom: 4,
                                    color: "#7f1d1d",
                                  }}
                                >
                                  Assign to position:
                                </small>
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value)
                                      void assign(e.target.value, o.id);
                                  }}
                                >
                                  <option value="">Select position…</option>
                                  {gamePositions.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                        {o.reasons.some((reason) =>
                          reason.startsWith("Overlaps Game #"),
                        ) && (
                          <small style={{ color: "#7f1d1d", fontWeight: 900 }}>
                            Cannot override an overlapping assignment
                          </small>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!availableOfficials.length && !ineligibleOfficials.length && (
                <div className="emptyState">
                  <p>No officials found.</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
