"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { announceUndoAvailable } from "./UndoCenter";
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
  responded_at: string | null;
  decline_reason: string | null;
  overdue_reviewed_at: string | null;
  assignment_source: "manager" | "self_assign" | "auto_assign";
  email_sent_at: string | null;
  email_error: string | null;
  resend_email_id: string | null;
  cancellation_notified_at: string | null;
  cancellation_email_error: string | null;
  cancellation_email_id: string | null;
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
type SelfAssignSlot = {
  id: string;
  game_id: string;
  position_id: string;
  status: "open" | "claimed" | "withdrawn";
};
type AuditEvent = {
  id: number;
  action: string;
  actor_name: string | null;
  summary: string;
  occurred_at: string;
};
type SavedAssignmentView = {
  id: string;
  name: string;
  range: Range;
  customDate: string;
  locationFilter: string;
  officialFilter: string;
  completenessFilter: Completeness;
  unpublishedOnly: boolean;
  selfAssignOnly: boolean;
};
type Range = "all" | "today" | "tomorrow" | "thisWeek" | "nextWeek" | "custom";
type Completeness =
  | "all"
  | "unassigned"
  | "partial"
  | "full"
  | "awaiting"
  | "confirmed"
  | "attention";
type GameSort =
  "default" | "game" | "location" | "time" | "power" | "status" | "assignments";
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
    [selfAssignOnly, setSelfAssignOnly] = useState(false),
    [completenessFilter, setCompletenessFilter] = useState<Completeness>("all"),
    [officialFilter, setOfficialFilter] = useState(""),
    [locationFilter, setLocationFilter] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(""),
    [movingAssignment, setMovingAssignment] = useState(""),
    [publishing, setPublishing] = useState(false),
    [retryingNotifications, setRetryingNotifications] = useState(false),
    [confirming, setConfirming] = useState(""),
    [gameStatusSaving, setGameStatusSaving] = useState(""),
    [pendingGameStatus, setPendingGameStatus] = useState<{
      gameId: string;
      status: string;
    } | null>(null),
    [canManage, setCanManage] = useState(false),
    [overrideOfficial, setOverrideOfficial] = useState(""),
    [gameSort, setGameSort] = useState<GameSort>("default"),
    [gameSortDir, setGameSortDir] = useState<"asc" | "desc">("asc"),
    [linkGroups, setLinkGroups] = useState<LinkGroup[]>([]),
    [linkMembers, setLinkMembers] = useState<LinkMember[]>([]),
    [linkSelected, setLinkSelected] = useState<string[]>([]),
    [linking, setLinking] = useState(false),
    [draggingGame, setDraggingGame] = useState(""),
    [bulkWorking, setBulkWorking] = useState(false),
    [bulkStatus, setBulkStatus] = useState("active"),
    [selfAssignSlots, setSelfAssignSlots] = useState<SelfAssignSlot[]>([]),
    [selfAssignSelected, setSelfAssignSelected] = useState<string[]>([]),
    [selfAssignSaving, setSelfAssignSaving] = useState(false),
    [showSelfAssignDialog, setShowSelfAssignDialog] = useState(false),
    [showIneligibleOfficials, setShowIneligibleOfficials] = useState(false),
    [ineligibleSearch, setIneligibleSearch] = useState(""),
    [ineligibleReasonFilter, setIneligibleReasonFilter] = useState("all"),
    [overduePromptClosed, setOverduePromptClosed] = useState(false),
    [overdueResolving, setOverdueResolving] = useState(false),
    [overdueSelected, setOverdueSelected] = useState<string[]>([]),
    [showPublishReview, setShowPublishReview] = useState(false),
    [showActivityTimeline, setShowActivityTimeline] = useState(false),
    [activityRows, setActivityRows] = useState<AuditEvent[]>([]),
    [activityLoading, setActivityLoading] = useState(false),
    [activityError, setActivityError] = useState(""),
    [savedViews, setSavedViews] = useState<SavedAssignmentView[]>([]);
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
    const [g, o, p, a, r, pr, pw, le, ve, bl, lg, lm, sas] = await Promise.all([
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
        .eq("active", true)
        .order("last_name")
        .order("first_name"),
      supabase
        .from("sport_positions")
        .select("id,sport_id,name,required,sort_order")
        .order("sort_order"),
      supabase
        .from("assignments")
        .select(
          "id,game_id,official_id,position_id,status,published_at,accept_by,responded_at,decline_reason,overdue_reviewed_at,assignment_source,email_sent_at,email_error,resend_email_id,cancellation_notified_at,cancellation_email_error,cancellation_email_id",
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
      supabase
        .from("assignment_self_assign_slots")
        .select("id,game_id,position_id,status")
        .eq("status", "open"),
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
      lm.error ||
      sas.error;
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
    setSelfAssignSlots((sas.data || []) as SelfAssignSlot[]);
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
  useEffect(() => {
    try {
      const stored = localStorage.getItem("refassign-assignment-views");
      if (stored) setSavedViews(JSON.parse(stored) as SavedAssignmentView[]);
    } catch {
      localStorage.removeItem("refassign-assignment-views");
    }
  }, []);
  async function refreshAssignmentState() {
    const [assignmentResult, selfAssignResult] = await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id,game_id,official_id,position_id,status,published_at,accept_by,responded_at,decline_reason,overdue_reviewed_at,assignment_source,email_sent_at,email_error,resend_email_id,cancellation_notified_at,cancellation_email_error,cancellation_email_id",
        ),
      supabase
        .from("assignment_self_assign_slots")
        .select("id,game_id,position_id,status")
        .eq("status", "open"),
    ]);
    const refreshError = assignmentResult.error || selfAssignResult.error;
    if (refreshError) {
      setError(refreshError.message);
      return false;
    }
    setAssignments((assignmentResult.data || []) as Assignment[]);
    setSelfAssignSlots((selfAssignResult.data || []) as SelfAssignSlot[]);
    return true;
  }
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
      filled = new Set(active.map((assignment) => assignment.position_id)).size,
      declined = assignments.filter(
        (assignment) =>
          assignment.game_id === g.id &&
          assignment.status === "declined" &&
          slots.some((slot) => slot.id === assignment.position_id),
      );
    if (declined.length)
      return {
        key: "attention" as const,
        label: "Needs Attention",
        color: "#dc2626",
        detail: `${declined.length} declined position${declined.length === 1 ? "" : "s"} need replacement`,
      };
    if (!slots.length || filled === 0)
      return {
        key: "unassigned" as const,
        label: "Unassigned",
        color: "#dc2626",
        detail: "No assignment slots are filled",
      };
    if (filled < slots.length)
      return {
        key: "partial" as const,
        label: "Partially Assigned",
        color: "#ea580c",
        detail: `${filled} of ${slots.length} slots filled`,
      };
    const overdue = active.some(
      (assignment) =>
        assignment.published_at &&
        assignment.status === "proposed" &&
        ["auto_assign", "manager"].includes(assignment.assignment_source) &&
        assignment.accept_by &&
        new Date(assignment.accept_by).getTime() < Date.now(),
    );
    if (overdue)
      return {
        key: "attention" as const,
        label: "Needs Attention",
        color: "#dc2626",
        detail: "One or more confirmation deadlines have passed",
      };
    if (
      active.every((assignment) =>
        ["accepted", "confirmed"].includes(assignment.status),
      )
    )
      return {
        key: "confirmed" as const,
        label: "Confirmed",
        color: "#16a34a",
        detail: "Every assignment is confirmed",
      };
    if (active.every((assignment) => Boolean(assignment.published_at)))
      return {
        key: "awaiting" as const,
        label: "Awaiting Confirmation",
        color: "#ca8a04",
        detail: "Published; waiting for one or more confirmations",
      };
    return {
      key: "full" as const,
      label: "Fully Assigned",
      color: "#2563eb",
      detail:
        "Every position is filled; one or more assignments still need publishing",
    };
  }
  function matchesOfficialFilter(g: Game) {
    return (
      !officialFilter ||
      assignments.some(
        (assignment) =>
          assignment.game_id === g.id &&
          assignment.official_id === officialFilter &&
          assignment.status !== "declined",
      )
    );
  }
  function matchesLocationFilter(g: Game) {
    return !locationFilter || g.location_id === locationFilter;
  }
  function selfAssignOpenCount(gameId: string) {
    return selfAssignSlots.filter(
      (slot) => slot.game_id === gameId && slot.status === "open",
    ).length;
  }
  const selfAssignGameCount = new Set(
    selfAssignSlots
      .filter((slot) => slot.status === "open")
      .map((slot) => slot.game_id),
  ).size;
  const hasDirectGameFilter = Boolean(locationFilter || officialFilter);
  const rangeGames = games.filter((g) => inRange(g, range, customDate));
  const baseFilteredGames = games.filter((g) => {
    const matchesSelfAssign =
      !selfAssignOnly || selfAssignOpenCount(g.id) > 0;
    if (hasDirectGameFilter)
      return (
        matchesLocationFilter(g) &&
        matchesOfficialFilter(g) &&
        matchesSelfAssign
      );
    return (
      inRange(g, range, customDate) &&
      matchesSelfAssign &&
      (!unpublishedOnly || isUnpublishedGame(g)) &&
      (completenessFilter === "all" ||
        assignmentCompleteness(g).key === completenessFilter)
    );
  });
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
  const assignmentSelection = filteredGames.filter((listedGame) =>
    linkSelected.includes(listedGame.id),
  );
  const assignmentSelectionGroupId = assignmentSelection.length
    ? linkGroupByGame.get(assignmentSelection[0].id) || null
    : null;
  const assignmentSelectionIsOneTarget =
    assignmentSelection.length === 1 ||
    (Boolean(assignmentSelectionGroupId) &&
      assignmentSelection.every(
        (listedGame) =>
          linkGroupByGame.get(listedGame.id) === assignmentSelectionGroupId,
      ));
  const assignmentSelectionTarget = assignmentSelectionIsOneTarget
    ? assignmentSelection[0]
    : null;
  const assignmentSelectionIsLinked = Boolean(
    assignmentSelectionTarget &&
      linkGroupByGame.get(assignmentSelectionTarget.id),
  );
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
    setSelected(gameId);
    setOverrideOfficial("");
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
  function travelBetween(first: Game, second: Game) {
    if (first.location_id && first.location_id === second.location_id)
      return { miles: 0, minutes: 0 };
    const directMiles = miles(
      first.location?.latitude ?? null,
      first.location?.longitude ?? null,
      second.location?.latitude ?? null,
      second.location?.longitude ?? null,
    );
    if (directMiles == null) return null;
    const roadMiles = directMiles * 1.2;
    return {
      miles: roadMiles,
      minutes: Math.max(10, Math.ceil((roadMiles / 35) * 60 + 10)),
    };
  }
  function sharedCrew(first: Game, second: Game) {
    const firstIds = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.game_id === first.id && assignment.status !== "declined",
        )
        .map((assignment) => assignment.official_id),
    );
    return [
      ...new Set(
        assignments
          .filter(
            (assignment) =>
              assignment.game_id === second.id &&
              assignment.status !== "declined" &&
              firstIds.has(assignment.official_id),
          )
          .map((assignment) => assignment.official_id),
      ),
    ];
  }
  function travelDetails(first: Game, second: Game) {
    const travel = travelBetween(first, second);
    const firstEnds =
      new Date(first.starts_at).getTime() + first.duration_minutes * 60000;
    const gapMinutes = Math.floor(
      (new Date(second.starts_at).getTime() - firstEnds) / 60000,
    );
    const shared = sharedCrew(first, second);
    const impossible =
      gapMinutes < 0 || (travel != null && gapMinutes < travel.minutes);
    return { travel, gapMinutes, shared, impossible };
  }
  function linkedGroupWarnings(groupGames: Game[]) {
    const warnings: string[] = [];
    for (let index = 1; index < groupGames.length; index++) {
      const first = groupGames[index - 1],
        second = groupGames[index];
      const details = travelDetails(first, second);
      if (!details.impossible || !details.shared.length) continue;
      const names = details.shared.map((officialId) => {
        const official = officials.find(
          (candidate) => candidate.id === officialId,
        );
        return official
          ? `${official.first_name} ${official.last_name}`
          : "Assigned official";
      });
      warnings.push(
        `${names.join(", ")} cannot reasonably travel from ${first.location?.name || "the first location"} to ${second.location?.name || "the next location"} in the ${Math.max(0, details.gapMinutes)} minutes available.`,
      );
    }
    return warnings;
  }
  async function reorderLinkedGame(
    groupId: string,
    draggedId: string,
    targetId: string,
  ) {
    if (!canManage || !draggedId || draggedId === targetId) return;
    const ordered = linkMembers
      .filter((member) => member.group_id === groupId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((member) => member.game_id);
    const from = ordered.indexOf(draggedId),
      to = ordered.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ordered];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setLinking(true);
    setError("");
    setNotice("");
    const results = await Promise.all(
      next.map((gameId, sortOrder) =>
        supabase
          .from("game_link_members")
          .update({ sort_order: sortOrder })
          .eq("group_id", groupId)
          .eq("game_id", gameId),
      ),
    );
    const failed = results.find((result) => result.error)?.error;
    if (failed) setError(failed.message);
    else setNotice("Linked-game order updated.");
    setDraggingGame("");
    await load();
    setLinking(false);
  }
  async function moveLinkedGame(
    groupId: string,
    gameId: string,
    direction: -1 | 1,
  ) {
    const ordered = linkMembers
      .filter((member) => member.group_id === groupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((member) => member.game_id === gameId);
    const target = ordered[index + direction];
    if (target) await reorderLinkedGame(groupId, gameId, target.game_id);
  }
  async function unlinkOneGame(groupId: string, gameId: string) {
    if (!canManage || linking) return;
    setLinking(true);
    setError("");
    setNotice("");
    const members = linkMembers.filter((member) => member.group_id === groupId);
    const { error: removeError } = await supabase
      .from("game_link_members")
      .delete()
      .eq("group_id", groupId)
      .eq("game_id", gameId);
    if (removeError) setError(removeError.message);
    else if (members.length <= 2) {
      const { error: groupError } = await supabase
        .from("game_link_groups")
        .delete()
        .eq("id", groupId);
      if (groupError) setError(groupError.message);
      else
        setNotice(
          "Game unlinked; the remaining single-game group was removed.",
        );
    } else setNotice("Game removed from Linked Games.");
    await load();
    setLinking(false);
  }
  function selfAssignKey(gameId: string, positionId: string) {
    return `${gameId}:${positionId}`;
  }
  function isSelfAssignOpen(gameId: string, positionId: string) {
    return selfAssignSlots.some(
      (slot) => slot.game_id === gameId && slot.position_id === positionId,
    );
  }
  function toggleSelfAssignSelection(gameId: string, positionId: string) {
    const key = selfAssignKey(gameId, positionId);
    setSelfAssignSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }
  function selfAssignOptionsForGames(gameIds: string[]) {
    return gameIds.flatMap((gameId) => {
      const listedGame = games.find((item) => item.id === gameId);
      if (!listedGame) return [];
      return positions
        .filter((position) => position.sport_id === listedGame.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .slice(0, Math.max(0, listedGame.officials_needed))
        .filter(
          (position) =>
            !assignments.some(
              (assignment) =>
                assignment.game_id === gameId &&
                assignment.position_id === position.id &&
                assignment.status !== "declined",
            ) && !isSelfAssignOpen(gameId, position.id),
        )
        .map((position) => ({
          gameId,
          positionId: position.id,
          positionName: position.name,
          game: listedGame,
          key: selfAssignKey(gameId, position.id),
        }));
    });
  }
  function prepareSelfAssignPositions() {
    const gameIds = linkSelected.length
      ? linkSelected
      : game
        ? [game.id]
        : [];
    const options = selfAssignOptionsForGames(gameIds);
    setNotice("");
    if (!options.length) {
      setError(
        "The selected game has no unassigned positions available for Self Assign.",
      );
      return;
    }
    setError("");
    setSelfAssignSelected(options.map((option) => option.key));
    setShowSelfAssignDialog(true);
  }
  async function openSelfAssignPositions() {
    if (!canManage) {
      setError(
        "Only Administrators and Assignors can open Self Assign positions.",
      );
      return;
    }
    const usedGameSelection = selfAssignSelected.length === 0;
    let slots = selfAssignSelected.map((key) => {
      const [game_id, position_id] = key.split(":");
      return { game_id, position_id };
    });
    if (!slots.length) {
      const selectedGameIds = linkSelected.length
        ? linkSelected
        : game
          ? [game.id]
          : [];
      slots = selectedGameIds.flatMap((gameId) => {
        const selectedGame = games.find((item) => item.id === gameId);
        if (!selectedGame) return [];
        return positions
          .filter((position) => position.sport_id === selectedGame.sport_id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .slice(0, Math.max(0, selectedGame.officials_needed))
          .filter(
            (position) =>
              !assignments.some(
                (assignment) =>
                  assignment.game_id === gameId &&
                  assignment.position_id === position.id &&
                  assignment.status !== "declined",
              ) && !isSelfAssignOpen(gameId, position.id),
          )
          .map((position) => ({ game_id: gameId, position_id: position.id }));
      });
    }
    slots = slots.filter(
      (slot, index, all) =>
        all.findIndex(
          (item) =>
            item.game_id === slot.game_id &&
            item.position_id === slot.position_id,
        ) === index,
    );
    if (!slots.length) {
      setError(
        "The selected game has no unassigned positions available for Self Assign.",
      );
      setNotice("");
      return;
    }
    setSelfAssignSaving(true);
    setError("");
    setNotice("");
    try {
      const { data, error: saveError } = await supabase.rpc(
        "set_self_assign_positions",
        { p_slots: slots },
      );
      if (saveError) throw saveError;

      const count = Number(data ?? slots.length);
      await refreshAssignmentState();
      setNotice(
        `${count} ${count === 1 ? "position is" : "positions are"} now available for Self Assign.`,
      );
      setShowSelfAssignDialog(false);
      setSelfAssignSelected([]);
      if (usedGameSelection) setLinkSelected([]);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : typeof saveError === "object" &&
              saveError !== null &&
              "message" in saveError
            ? String(saveError.message)
            : "Unable to open the selected positions for Self Assign.",
      );
    } finally {
      setSelfAssignSaving(false);
    }
  }
  async function withdrawSelfAssignPosition(
    gameId: string,
    positionId: string,
  ) {
    if (!canManage) return;
    setSelfAssignSaving(true);
    setError("");
    const { error: withdrawError } = await supabase.rpc(
      "withdraw_self_assign_position",
      { p_game_id: gameId, p_position_id: positionId },
    );
    if (withdrawError) setError(withdrawError.message);
    else setNotice("Self Assign position removed.");
    await refreshAssignmentState();
    setSelfAssignSaving(false);
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
    (a) => !a.published_at && a.status !== "declined",
  ).length;
  const unpublishedAssignments = gameAssignments.filter(
    (assignment) => !assignment.published_at && assignment.status !== "declined",
  );
  const activeAssignmentCount = gameAssignments.filter(
    (a) => !["declined", "cancelled"].includes(a.status),
  ).length;
  const openPositionCount = Math.max(0, gamePositions.length - activeAssignmentCount);
  const assignmentEmailsSent = gameAssignments.filter((a) => a.email_sent_at).length;
  const assignmentEmailIssues = gameAssignments.filter(
    (a) => a.published_at && !a.email_sent_at,
  ).length;
  const cancellationEmailsSent = gameAssignments.filter(
    (a) => a.cancellation_notified_at,
  ).length;
  const cancellationEmailIssues = gameAssignments.filter(
    (a) =>
      ["canceled", "rained_out"].includes(game?.status || "") &&
      a.status === "cancelled" &&
      !a.cancellation_notified_at,
  ).length;
  function requestSelectedGame(nextGameId: string) {
    if (
      nextGameId &&
      nextGameId !== selected &&
      unpublishedCount > 0 &&
      !window.confirm(
        `Game #${game?.game_number || ""} has ${unpublishedCount} unpublished assignment${unpublishedCount === 1 ? "" : "s"}. Switch games without publishing?`,
      )
    )
      return;
    setSelected(nextGameId);
    setOverrideOfficial("");
  }
  function chooseRange(r: Range) {
    setRange(r);
    setShowCalendar(false);
    setOverrideOfficial("");
    const list = games.filter(
      (g) =>
        inRange(g, r, customDate) &&
        (!unpublishedOnly || isUnpublishedGame(g)) &&
        (completenessFilter === "all" ||
          assignmentCompleteness(g).key === completenessFilter),
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
        (completenessFilter === "all" ||
          assignmentCompleteness(g).key === completenessFilter),
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
        (completenessFilter === "all" ||
          assignmentCompleteness(g).key === completenessFilter),
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
  function storeSavedViews(next: SavedAssignmentView[]) {
    setSavedViews(next);
    localStorage.setItem("refassign-assignment-views", JSON.stringify(next));
  }
  function saveCurrentView() {
    const name = window.prompt("Name this Assignment Center view:")?.trim();
    if (!name) return;
    const nextView: SavedAssignmentView = {
      id: `${Date.now()}`,
      name,
      range,
      customDate,
      locationFilter,
      officialFilter,
      completenessFilter,
      unpublishedOnly,
      selfAssignOnly,
    };
    storeSavedViews([...savedViews.filter((view) => view.name !== name), nextView]);
    setNotice(`Saved view “${name}”.`);
  }
  function applySavedView(view: SavedAssignmentView) {
    setRange(view.range);
    setCustomDate(view.customDate);
    setLocationFilter(view.locationFilter);
    setOfficialFilter(view.officialFilter);
    setCompletenessFilter(view.completenessFilter);
    setUnpublishedOnly(view.unpublishedOnly);
    setSelfAssignOnly(view.selfAssignOnly);
    setLinkSelected([]);
    setSelected("");
    setNotice(`Showing saved view “${view.name}”.`);
  }
  function deleteSavedView(viewId: string) {
    storeSavedViews(savedViews.filter((view) => view.id !== viewId));
  }
  function linkedAssignmentGames() {
    if (!game) return [];
    const groupId = linkGroupByGame.get(game.id);
    return groupId
      ? games.filter((listedGame) => linkGroupByGame.get(listedGame.id) === groupId)
      : [game];
  }
  function matchingPositionId(targetGame: Game, sourcePositionId: string) {
    if (!game || !sourcePositionId) return "";
    const sourcePositions = positions
      .filter((position) => position.sport_id === game.sport_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
    const sourceSlot = sourcePositions.findIndex(
      (position) => position.id === sourcePositionId,
    );
    if (sourceSlot < 0) return "";
    return (
      positions
        .filter((position) => position.sport_id === targetGame.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))[
        sourceSlot
      ]?.id || ""
    );
  }
  function assignmentConflictReasonsForGame(
    o: Official,
    targetGame: Game,
    ignorePositionId = "",
  ) {
    const reasons: string[] = [];
    for (const a of assignments) {
      if (
        a.official_id !== o.id ||
        ["declined", "cancelled"].includes(a.status)
      )
        continue;
      if (
        ignorePositionId &&
        a.game_id === targetGame.id &&
        a.position_id === ignorePositionId
      )
        continue;
      const other = games.find((g) => g.id === a.game_id);
      if (
        other &&
        overlaps(
          targetGame.starts_at,
          targetGame.duration_minutes || 110,
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
  function assignmentConflictReasons(o: Official, sourcePositionId = "") {
    return linkedAssignmentGames().flatMap((targetGame) =>
      assignmentConflictReasonsForGame(
        o,
        targetGame,
        matchingPositionId(targetGame, sourcePositionId),
      ),
    );
  }
  function workingAtGameTime(o: Official, ignorePositionId = "") {
    return assignmentConflictReasons(o, ignorePositionId).length > 0;
  }
  function ineligibleReasonsForGame(
    o: Official,
    targetGame: Game,
    ignorePositionId = "",
  ) {
    const reasons: string[] = [];
    reasons.push(
      ...assignmentConflictReasonsForGame(o, targetGame, ignorePositionId),
    );
    const day = targetGame.starts_at.slice(0, 10),
      gs = new Date(targetGame.starts_at).getTime(),
      ge = gs + (targetGame.duration_minutes || 110) * 60000;
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
        b.location_id === targetGame.location_id
      )
        reasons.push(
          `Blocked at ${targetGame.location?.name || "this location"}`,
        );
      else if (
        b.block_type === "team" &&
        b.team_id &&
        (b.team_id === targetGame.home?.id || b.team_id === targetGame.away?.id)
      )
        reasons.push(
          `Blocked for ${b.team_id === targetGame.home?.id ? targetGame.home?.name : targetGame.away?.name || "this team"}`,
        );
    }
    if (
      !o.sports.some(
        (s) => s.toLowerCase() === targetGame.sports?.name.toLowerCase(),
      )
    )
      reasons.push(`Not eligible for ${targetGame.sports?.name || "sport"}`);
    const ol = leagueElig.filter((x) => x.official_id === o.id),
      ov = levelElig.filter((x) => x.official_id === o.id);
    if (
      targetGame.league_id &&
      ol.length &&
      !ol.some((x) => x.league_id === targetGame.league_id)
    )
      reasons.push(
        `Not eligible for league ${targetGame.leagues?.name || "selected league"}`,
      );
    if (
      targetGame.level_id &&
      ov.length &&
      !ov.some((x) => x.level_id === targetGame.level_id)
    )
      reasons.push(
        `Not eligible for level ${targetGame.levels?.name || "selected level"}`,
      );
    if (
      assignments.some(
        (a) =>
          a.game_id === targetGame.id &&
          a.official_id === o.id &&
          a.status !== "declined" &&
          !(ignorePositionId && a.position_id === ignorePositionId),
      )
    )
      reasons.push("Already assigned to this game");
    return [...new Set(reasons)];
  }
  function ineligibleReasons(o: Official, sourcePositionId = "") {
    const targetGames = linkedAssignmentGames();
    const linked = targetGames.length > 1;
    return [
      ...new Set(
        targetGames.flatMap((targetGame) =>
          ineligibleReasonsForGame(
            o,
            targetGame,
            matchingPositionId(targetGame, sourcePositionId),
          ).map((reason) =>
            linked && !reason.startsWith("Overlaps Game #")
              ? `Game #${targetGame.game_number}: ${reason}`
              : reason,
          ),
        ),
      ),
    ];
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
        (a) =>
          a.game_id === game.id &&
          a.position_id === pos.id &&
          a.status !== "declined",
      ),
      used = new Set(
        assignments
          .filter(
            (a) =>
              a.game_id === game.id &&
              a.position_id !== pos.id &&
              a.status !== "declined",
          )
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
  const visibleIneligibleOfficials = ineligibleOfficials.filter((official) => {
    const search = ineligibleSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      `${official.first_name} ${official.last_name}`
        .toLowerCase()
        .includes(search);
    const reasonText = official.reasons.join(" ").toLowerCase();
    const matchesReason =
      ineligibleReasonFilter === "all" ||
      (ineligibleReasonFilter === "eligibility" &&
        (reasonText.includes("league") || reasonText.includes("level"))) ||
      (ineligibleReasonFilter === "availability" &&
        (reasonText.includes("unavailable") || reasonText.includes("block"))) ||
      (ineligibleReasonFilter === "conflict" &&
        (reasonText.includes("overlap") || reasonText.includes("assigned")));
    return matchesSearch && matchesReason;
  });
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
      announceUndoAvailable();
    } else {
      announceUndoAvailable();
    }
    await refreshAssignmentState();
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
    await refreshAssignmentState();
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
    else announceUndoAvailable();
    await refreshAssignmentState();
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
    await refreshAssignmentState();
    setConfirming("");
  }
  function requestGameStatusChange(gameId: string, status: string) {
    if (["canceled", "rained_out"].includes(status)) {
      setPendingGameStatus({ gameId, status });
      return;
    }
    void changeGameStatus(gameId, status);
  }
  async function changeGameStatus(gameId: string, status: string) {
    if (!canManage) {
      setError("Only Administrators and Assignors can change game status.");
      return;
    }
    setPendingGameStatus(null);
    setGameStatusSaving(gameId);
    setError("");
    setNotice("");
    const response = await fetch("/api/games/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, status }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      sent?: number;
      failed?: number;
      failures?: string[];
    };
    if (!response.ok) setError(result.error || "Unable to change game status.");
    else {
      setGames((current) =>
        current.map((listedGame) =>
          listedGame.id === gameId ? { ...listedGame, status } : listedGame,
        ),
      );
      const notification = ["canceled", "rained_out"].includes(status)
        ? ` ${result.sent || 0} official notification${result.sent === 1 ? "" : "s"} sent${result.failed ? `; ${result.failed} failed` : ""}.`
        : "";
      setNotice(
        `Game status changed to ${gameStatusOptions.find(([value]) => value === status)?.[1] || status}.${notification}`,
      );
    }
    if (["canceled", "rained_out"].includes(status))
      await refreshAssignmentState();
    setGameStatusSaving("");
  }
  async function publishAssignments() {
    if (!game || unpublishedCount === 0) return;
    setShowPublishReview(false);
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
    await refreshAssignmentState();
    setPublishing(false);
  }
  async function openActivityTimeline() {
    if (!game) return;
    setShowActivityTimeline(true);
    setActivityLoading(true);
    setActivityError("");
    const { data, error: activityLoadError } = await supabase
      .from("audit_history")
      .select("id,action,actor_name,summary,occurred_at")
      .eq("game_id", game.id)
      .order("occurred_at", { ascending: false })
      .limit(100);
    if (activityLoadError) setActivityError(activityLoadError.message);
    else setActivityRows((data || []) as AuditEvent[]);
    setActivityLoading(false);
  }
  async function retryNotificationIssues() {
    if (!game || retryingNotifications) return;
    setRetryingNotifications(true);
    setError("");
    setNotice("");
    try {
      const cancellation = ["canceled", "rained_out"].includes(game.status);
      const response = await fetch(
        cancellation ? "/api/games/status" : "/api/assignments/publish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            cancellation
              ? { gameId: game.id, status: game.status }
              : { gameId: game.id },
          ),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        failed?: number;
        failures?: string[];
      };
      if (!response.ok)
        throw new Error(result.error || "Notifications could not be retried.");
      if (result.failed)
        setError(
          `${result.sent || 0} notification${result.sent === 1 ? "" : "s"} sent; ${result.failed} still failed. ${(result.failures || []).join("; ")}`,
        );
      else
        setNotice(
          `${result.sent || 0} notification${result.sent === 1 ? "" : "s"} sent successfully.`,
        );
      await refreshAssignmentState();
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Notifications could not be retried.",
      );
    }
    setRetryingNotifications(false);
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
  async function exportAssignments(gameIds?: string[]) {
    const XLSX = await import("xlsx");
    const exportGames = gameIds?.length
      ? filteredGames.filter((listedGame) => gameIds.includes(listedGame.id))
      : filteredGames;
    const positionNames: string[] = [];
    for (const g of exportGames) {
      const gp = positions
        .filter((p) => p.sport_id === g.sport_id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .slice(0, Math.max(0, g.officials_needed));
      for (const pos of gp)
        if (!positionNames.includes(pos.name)) positionNames.push(pos.name);
    }
    const data = exportGames.map((g) => {
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
  async function runBulkAction(
    action: "publish" | "confirm" | "unassign" | "status" | "closeSelfAssign",
  ) {
    if (!canManage || !linkSelected.length || bulkWorking) return;
    const selectedIds = [...linkSelected];
    const selectedAssignments = assignments.filter(
      (a) => selectedIds.includes(a.game_id) && a.status !== "declined",
    );
    const labels = {
      publish: "publish assignments for",
      confirm: "confirm officials on",
      unassign: "unassign every official from",
      closeSelfAssign: "close every open Self Assign position for",
      status: `change the status to ${gameStatusOptions.find(([value]) => value === bulkStatus)?.[1] || bulkStatus} for`,
    };
    const officialNotificationWarning =
      action === "status" && ["canceled", "rained_out"].includes(bulkStatus)
        ? "\n\nAssigned officials will be notified of this change."
        : "";
    if (
      !window.confirm(
        `${labels[action]} ${selectedIds.length} selected game${selectedIds.length === 1 ? "" : "s"}?${officialNotificationWarning}`,
      )
    )
      return;
    setBulkWorking(true);
    setError("");
    setNotice("");
    let succeeded = 0;
    const failures: string[] = [];
    const undoOperationIds: string[] = [];
    try {
      if (action === "unassign") {
        const { error: deleteError } = await supabase
          .from("assignments")
          .delete()
          .in("game_id", selectedIds);
        if (deleteError) failures.push(deleteError.message);
        else {
          succeeded = selectedAssignments.length;
          const { data: undoRows } = await supabase.rpc(
            "latest_undo_operation",
          );
          const undoId = (undoRows as { id: string }[] | null)?.[0]?.id;
          if (undoId) undoOperationIds.push(undoId);
        }
      } else if (action === "closeSelfAssign") {
        const openSlots = selfAssignSlots.filter((slot) =>
          selectedIds.includes(slot.game_id),
        );
        for (const slot of openSlots) {
          const { error: closeError } = await supabase.rpc(
            "withdraw_self_assign_position",
            {
              p_game_id: slot.game_id,
              p_position_id: slot.position_id,
            },
          );
          if (closeError) failures.push(closeError.message);
          else succeeded++;
        }
      } else if (action === "status") {
        for (const gameId of selectedIds) {
          const response = await fetch("/api/games/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId, status: bulkStatus }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (response.ok) {
            succeeded++;
            const { data: undoRows } = await supabase.rpc(
              "latest_undo_operation",
            );
            const undoId = (undoRows as { id: string }[] | null)?.[0]?.id;
            if (undoId && !undoOperationIds.includes(undoId))
              undoOperationIds.push(undoId);
          } else failures.push(body.error || `Could not update game ${gameId}`);
        }
      } else if (action === "publish") {
        for (const gameId of selectedIds) {
          const response = await fetch("/api/assignments/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            failed?: number;
            failures?: string[];
          };
          if (response.ok) {
            succeeded++;
            if (body.failed) failures.push(...(body.failures || []));
          } else
            failures.push(body.error || `Could not publish game ${gameId}`);
        }
      } else if (action === "confirm") {
        const eligible = selectedAssignments.filter(
          (a) => a.published_at && a.status !== "confirmed",
        );
        for (const a of eligible) {
          const response = await fetch("/api/assignments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignmentId: a.id }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (response.ok) succeeded++;
          else
            failures.push(body.error || `Could not confirm assignment ${a.id}`);
        }
      }
      if (failures.length)
        setError(
          `Bulk action completed with ${failures.length} issue${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 4).join(" | ")}${failures.length > 4 ? " | …" : ""}`,
        );
      setNotice(
        `Bulk action complete: ${succeeded} ${action === "status" ? "game" : action === "confirm" || action === "unassign" ? "assignment" : "game"}${succeeded === 1 ? "" : "s"} processed.`,
      );
      if (succeeded && (action === "status" || action === "unassign")) {
        await supabase.rpc("group_undo_operations", {
          p_operation_ids: undoOperationIds,
          p_description:
            action === "status"
              ? "Bulk game-status change"
              : "Bulk unassignment",
        });
        announceUndoAvailable();
      }
      setLinkSelected([]);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete the bulk action.",
      );
    } finally {
      setBulkWorking(false);
    }
  }
  const filters: [Range, string][] = [
    ["all", "All Games"],
    ["today", "Today's Games"],
    ["tomorrow", "Tomorrow's Games"],
    ["thisWeek", "This Week"],
    ["nextWeek", "Next Week"],
  ];
  const attentionQueue = {
    needsAction: rangeGames.filter(
      (listedGame) => assignmentCompleteness(listedGame).key === "attention",
    ).length,
    unassigned: rangeGames.filter(
      (listedGame) => assignmentCompleteness(listedGame).key === "unassigned",
    ).length,
    awaiting: rangeGames.filter(
      (listedGame) => assignmentCompleteness(listedGame).key === "awaiting",
    ).length,
    unpublished: rangeGames.filter(isUnpublishedGame).length,
  };
  function shortPositionName(name: string) {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (["assistantreferee1", "assistant1", "ar1"].includes(normalized))
      return "AR1";
    if (
      ["assistantreferee2", "assistant2", "assistantreferee", "ar2"].includes(
        normalized,
      )
    )
      return "AR2";
    if (
      ["centerreferee", "center", "referee", "cr", "ref"].includes(normalized)
    )
      return "REF";
    return name;
  }
  const overdueGroups = Array.from(
    assignments
      .filter((assignment) => {
        const overdueGame = games.find(
          (listedGame) => listedGame.id === assignment.game_id,
        );
        return Boolean(
          overdueGame &&
          assignment.status === "proposed" &&
          assignment.published_at &&
          assignment.accept_by &&
          new Date(assignment.accept_by).getTime() < Date.now() &&
          !assignment.overdue_reviewed_at &&
          new Date(overdueGame.starts_at).getTime() > Date.now() &&
          !["canceled", "rained_out"].includes(overdueGame.status),
        );
      })
      .reduce((groups, assignment) => {
        const group = groups.get(assignment.official_id) || [];
        group.push(assignment);
        groups.set(assignment.official_id, group);
        return groups;
      }, new Map<string, Assignment[]>()),
  ).sort((a, b) => {
    const aDeadline = Math.min(
      ...a[1].map((assignment) => new Date(assignment.accept_by!).getTime()),
    );
    const bDeadline = Math.min(
      ...b[1].map((assignment) => new Date(assignment.accept_by!).getTime()),
    );
    return aDeadline - bDeadline;
  });
  const overdueGroup = overdueGroups[0] || null;
  const overdueGroupAssignmentIds = overdueGroup
    ? overdueGroup[1].map((assignment) => assignment.id)
    : [];
  const overdueGroupSelectionKey = overdueGroupAssignmentIds.join(",");
  useEffect(() => {
    setOverdueSelected(
      overdueGroupSelectionKey ? overdueGroupSelectionKey.split(",") : [],
    );
  }, [overdueGroupSelectionKey]);
  function toggleOverdueSelection(assignmentId: string) {
    setOverdueSelected((current) =>
      current.includes(assignmentId)
        ? current.filter((id) => id !== assignmentId)
        : [...current, assignmentId],
    );
  }
  async function resolveOverdue(
    action: "keep" | "remove" | "remove_and_block",
  ) {
    if (!overdueGroup || overdueSelected.length === 0) return;
    setOverdueResolving(true);
    setError("");
    setNotice("");
    const { data, error: resolveError } = await supabase.rpc(
      "resolve_overdue_assignments",
      {
        p_assignment_ids: overdueSelected,
        p_action: action,
      },
    );
    if (resolveError) setError(resolveError.message);
    else {
      const result = data as {
        assignments_resolved?: number;
        blocks_created?: number;
      } | null;
      const official = officials.find((item) => item.id === overdueGroup[0]);
      const name = official
        ? `${official.first_name} ${official.last_name}`
        : "Official";
      setNotice(
        action === "keep"
          ? `${name} was kept on ${result?.assignments_resolved || overdueSelected.length} selected overdue game assignment(s).`
          : `${name} was removed from ${result?.assignments_resolved || overdueSelected.length} selected unaccepted game(s)${action === "remove_and_block" ? ` and ${result?.blocks_created || 0} time block(s) were created` : " without creating blocks"}.`,
      );
      setOverduePromptClosed(false);
      await load();
      if (action !== "keep") announceUndoAvailable();
    }
    setOverdueResolving(false);
  }
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
    return (
      <div
        key={g.id}
        className="assignmentGameRow"
        style={{
          borderBottom: `1px solid ${statusBorder || (linked ? "#bfdbfe" : "#e2e8f0")}`,
          background:
            statusBackground ||
            (linked ? "#eff6ff" : selected === g.id ? "#f8fafc" : "#fff"),
          color: isRainOut ? "#fff" : "inherit",
        }}
      >
        <label
          title="Select game for bulk actions or linking"
          style={{ display: "flex", justifyContent: "center" }}
        >
          <input
            type="checkbox"
            aria-label={`Select game ${g.game_number}`}
            checked={linkSelected.includes(g.id)}
            disabled={linking || bulkWorking}
            onChange={() => toggleLinkSelection(g.id)}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            requestSelectedGame(g.id);
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
          <span className="assignmentGameName">
            {showChain && (
              <span aria-hidden="true" className="assignmentLinkedArrow">
                ↳
              </span>
            )}
            {g.home?.name || "TBD"} vs {g.away?.name || "TBD"}
            {selfAssignOpenCount(g.id) > 0 && (
              <span
                className="badge green"
                style={{ marginLeft: 8, verticalAlign: "middle" }}
              >
                Self Assign • {selfAssignOpenCount(g.id)} Open
              </span>
            )}
          </span>
          <small style={{ color: isRainOut ? "#dbeafe" : undefined }}>
            {g.game_number}
          </small>
        </button>
        <span
          style={{
            color: isRainOut ? "#fff" : "#475569",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {g.location?.name || "TBD"}
        </span>
        <span className="assignmentGameDate" style={{ color: isRainOut ? "#fff" : undefined }}>
          <span>{d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
          <small>{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
        </span>
        <span
          title="Average of the home and away team power rankings"
          style={{
            color: isRainOut ? "#fff" : "#7c3aed",
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          {gamePower(g).toFixed(1)}
        </span>
        <select
          aria-label={`Status for game ${g.game_number}`}
          disabled={!canManage || gameStatusSaving === g.id}
          value={g.status === "open" ? "active" : g.status}
          onChange={(event) => requestGameStatusChange(g.id, event.target.value)}
          style={{
            width: "100%",
            minWidth: 0,
            padding: "5px 4px",
            fontSize: 11,
          }}
        >
          {gameStatusOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="assignmentStatusCell">
          <span
            title={completeness.detail}
            className="assignmentStatusBadge"
            style={{
              border: `1px solid ${completeness.color}`,
              color: isRainOut ? "#fff" : completeness.color,
              background: isRainOut ? "rgba(255,255,255,.12)" : "#fff",
            }}
          >
            {completeness.label}
          </span>
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
              Assign, review and publish officials for upcoming games.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canManage && (
              <>
                <button
                  className="secondary"
                  disabled={!filteredGames.length}
                  onClick={() => void exportAssignments()}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="success"
                  disabled={
                    selfAssignSaving ||
                    (!selfAssignSelected.length &&
                      !linkSelected.length &&
                      !game)
                  }
                  onClick={prepareSelfAssignPositions}
                >
                  {selfAssignSaving
                    ? "Opening…"
                    : "Open Positions for Self Assign"}
                </button>
              </>
            )}
            <button
              className="primary"
              disabled={!game || unpublishedCount === 0 || publishing}
              onClick={() => setShowPublishReview(true)}
            >
              {publishing
                ? "Publishing & Sending…"
                : `Publish${unpublishedCount ? ` (${unpublishedCount})` : ""}`}
            </button>
          </div>
        </div>
        {error && (
          <div className="errorBox assignmentFeedback" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
          </div>
        )}
        {notice && (
          <div className="assignmentToast assignmentFeedback" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {pendingGameStatus && (
          <div className="assignmentDialogBackdrop" role="presentation" onMouseDown={() => !gameStatusSaving && setPendingGameStatus(null)}>
            <div className="assignmentDialog assignmentConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="gameStatusConfirmTitle" onMouseDown={(event) => event.stopPropagation()}>
              <div className="assignmentDialogHead">
                <div>
                  <h3 id="gameStatusConfirmTitle">Confirm Game Status</h3>
                  <p>
                    Change Game #{games.find((item) => item.id === pendingGameStatus.gameId)?.game_number || ""} to {gameStatusOptions.find(([value]) => value === pendingGameStatus.status)?.[1] || pendingGameStatus.status}?
                  </p>
                </div>
                <button type="button" aria-label="Close" disabled={Boolean(gameStatusSaving)} onClick={() => setPendingGameStatus(null)}>×</button>
              </div>
              <div className="assignmentConfirmMessage">
                Assigned officials will be notified of this change.
              </div>
              <div className="assignmentDialogFooter">
                <button type="button" className="secondary" disabled={Boolean(gameStatusSaving)} onClick={() => setPendingGameStatus(null)}>Keep Current Status</button>
                <button type="button" className="danger" disabled={Boolean(gameStatusSaving)} onClick={() => void changeGameStatus(pendingGameStatus.gameId, pendingGameStatus.status)}>
                  {gameStatusSaving ? "Updating…" : `Confirm ${gameStatusOptions.find(([value]) => value === pendingGameStatus.status)?.[1] || "Change"}`}
                </button>
              </div>
            </div>
          </div>
        )}
        {showPublishReview && game && (
          <div className="assignmentDialogBackdrop" role="presentation" onMouseDown={() => !publishing && setShowPublishReview(false)}>
            <div className="assignmentDialog assignmentPublishReview" role="dialog" aria-modal="true" aria-labelledby="publishReviewTitle" onMouseDown={(event) => event.stopPropagation()}>
              <div className="assignmentDialogHead">
                <div>
                  <h3 id="publishReviewTitle">Review Before Publishing</h3>
                  <p>Game #{game.game_number} — {game.home?.name || "TBD"} vs {game.away?.name || "TBD"}</p>
                </div>
                <button type="button" aria-label="Close" disabled={publishing} onClick={() => setShowPublishReview(false)}>×</button>
              </div>
              <div className="publishReviewSummary">
                <span><b>{unpublishedCount}</b> official{unpublishedCount === 1 ? "" : "s"} will be notified</span>
                <span className={openPositionCount ? "warning" : "ready"}><b>{openPositionCount}</b> open position{openPositionCount === 1 ? "" : "s"}</span>
              </div>
              <div className="publishRecipientList">
                {unpublishedAssignments.map((assignment) => {
                  const official = officials.find((item) => item.id === assignment.official_id);
                  const position = positions.find((item) => item.id === assignment.position_id);
                  return <div key={assignment.id}><span><b>{official ? `${official.first_name} ${official.last_name}` : "Unknown official"}</b><small>{position ? shortPositionName(position.name) : "Official"}</small></span><span className={official?.email ? "recipientReady" : "recipientMissing"}>{official?.email || "Email missing"}</span></div>;
                })}
              </div>
              <p className="publishReviewNote">Publishing sends each listed official an assignment email with their response deadline. Open positions are not included.</p>
              <div className="assignmentDialogFooter">
                <button type="button" className="secondary" disabled={publishing} onClick={() => setShowPublishReview(false)}>Go Back</button>
                <button type="button" className="primary" disabled={publishing || !unpublishedCount} onClick={() => void publishAssignments()}>{publishing ? "Publishing & Sending…" : `Publish ${unpublishedCount} Assignment${unpublishedCount === 1 ? "" : "s"}`}</button>
              </div>
            </div>
          </div>
        )}
        {showActivityTimeline && game && (
          <div className="assignmentDialogBackdrop" role="presentation" onMouseDown={() => setShowActivityTimeline(false)}>
            <div className="assignmentDialog assignmentActivityDialog" role="dialog" aria-modal="true" aria-labelledby="activityTimelineTitle" onMouseDown={(event) => event.stopPropagation()}>
              <div className="assignmentDialogHead">
                <div><h3 id="activityTimelineTitle">Activity Timeline</h3><p>Game #{game.game_number} — visible only while this window is open.</p></div>
                <button type="button" aria-label="Close" onClick={() => setShowActivityTimeline(false)}>×</button>
              </div>
              {activityError && <div className="errorBox">{activityError}</div>}
              {activityLoading ? <p>Loading activity…</p> : activityRows.length ? <div className="gameActivityTimeline">{activityRows.map((row) => <article key={row.id}><i/><div><b>{row.summary}</b><span>{row.actor_name || "System"} • {new Date(row.occurred_at).toLocaleString()}</span></div><em>{row.action.replaceAll("_", " ")}</em></article>)}</div> : <div className="emptyState"><p>No recorded activity for this game yet.</p></div>}
              <div className="assignmentDialogFooter"><button type="button" className="secondary" onClick={() => setShowActivityTimeline(false)}>Close</button></div>
            </div>
          </div>
        )}
        {showSelfAssignDialog && (
          <div className="assignmentDialogBackdrop" role="presentation" onMouseDown={() => !selfAssignSaving && setShowSelfAssignDialog(false)}>
            <div className="assignmentDialog" role="dialog" aria-modal="true" aria-labelledby="selfAssignDialogTitle" onMouseDown={(event) => event.stopPropagation()}>
              <div className="assignmentDialogHead">
                <div>
                  <h3 id="selfAssignDialogTitle">Open Positions for Self Assign</h3>
                  <p>Select the positions officials may claim.</p>
                </div>
                <button type="button" aria-label="Close" disabled={selfAssignSaving} onClick={() => setShowSelfAssignDialog(false)}>×</button>
              </div>
              <div className="selfAssignDialogActions">
                <button type="button" className="secondary" onClick={() => {
                  const gameIds = linkSelected.length ? linkSelected : game ? [game.id] : [];
                  setSelfAssignSelected(selfAssignOptionsForGames(gameIds).map((option) => option.key));
                }}>Select All</button>
                <button type="button" className="secondary" onClick={() => setSelfAssignSelected([])}>Clear All</button>
              </div>
              <div className="selfAssignPositionList">
                {selfAssignOptionsForGames(linkSelected.length ? linkSelected : game ? [game.id] : []).map((option) => (
                  <label key={option.key}>
                    <input
                      type="checkbox"
                      checked={selfAssignSelected.includes(option.key)}
                      disabled={selfAssignSaving}
                      onChange={() => toggleSelfAssignSelection(option.gameId, option.positionId)}
                    />
                    <span>
                      <b>{option.positionName}</b>
                      <small>Game #{option.game.game_number} — {option.game.home?.name || "TBD"} vs {option.game.away?.name || "TBD"}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="assignmentDialogFooter">
                <button type="button" className="secondary" disabled={selfAssignSaving} onClick={() => setShowSelfAssignDialog(false)}>Cancel</button>
                <button type="button" className="success" disabled={selfAssignSaving || !selfAssignSelected.length} onClick={() => void openSelfAssignPositions()}>
                  {selfAssignSaving ? "Opening…" : `Open ${selfAssignSelected.length} Position${selfAssignSelected.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}
        {canManage && overdueGroup && !overduePromptClosed && (
          <div
            className="overduePrompt"
            role="dialog"
            aria-labelledby="overduePromptTitle"
          >
            <div className="cardHead">
              <div>
                <h3 id="overduePromptTitle">Acceptance deadline passed</h3>
                <p>
                  {officials.find((official) => official.id === overdueGroup[0])
                    ?.first_name || "This official"}{" "}
                  {officials.find((official) => official.id === overdueGroup[0])
                    ?.last_name || ""}{" "}
                  has not accepted the following assigned game
                  {overdueGroup[1].length === 1 ? "" : "s"}. Official {1} of{" "}
                  {overdueGroups.length} requiring review.
                </p>
              </div>
            </div>
            <div className="overdueGameList">
              {overdueGroup[1].map((assignment) => {
                const overdueGame = games.find(
                  (listedGame) => listedGame.id === assignment.game_id,
                );
                const position = positions.find(
                  (item) => item.id === assignment.position_id,
                );
                if (!overdueGame) return null;
                return (
                  <label key={assignment.id}>
                    <input
                      type="checkbox"
                      checked={overdueSelected.includes(assignment.id)}
                      disabled={overdueResolving}
                      onChange={() => toggleOverdueSelection(assignment.id)}
                      aria-label={`Select game ${overdueGame.game_number}`}
                    />
                    <span>
                      <b>
                        {overdueGame.game_number} —{" "}
                        {overdueGame.home?.name || "TBD"} vs{" "}
                        {overdueGame.away?.name || "TBD"}
                      </b>
                      <small>
                        {new Date(overdueGame.starts_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {" • "}
                        {position
                          ? shortPositionName(position.name)
                          : "Official"}
                        {" • Acceptance was due "}
                        {new Date(assignment.accept_by!).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="overduePromptQuestion">
              Select the unaccepted games to update. Accepted assignments are
              never included or removed.
            </p>
            <div className="overduePromptActions">
              <button
                className="secondary"
                disabled={overdueResolving || overdueSelected.length === 0}
                onClick={() => void resolveOverdue("keep")}
              >
                Keep Official
              </button>
              <button
                className="dangerButton"
                disabled={overdueResolving || overdueSelected.length === 0}
                onClick={() => void resolveOverdue("remove")}
              >
                Remove — No Block
              </button>
              <button
                className="primary"
                disabled={overdueResolving || overdueSelected.length === 0}
                onClick={() => void resolveOverdue("remove_and_block")}
              >
                Remove + Create Blocks
              </button>
              <button
                className="secondary"
                disabled={overdueResolving}
                onClick={() => setOverduePromptClosed(true)}
              >
                Review Later
              </button>
              {overdueResolving && <span>Updating…</span>}
            </div>
          </div>
        )}
        {canManage && (
          <section className="assignmentAttentionQueue" aria-labelledby="attentionQueueTitle">
            <div><h3 id="attentionQueueTitle">Needs Attention</h3><p>Open the work that should be handled next.</p></div>
            <button type="button" onClick={() => chooseCompleteness("attention")}><b>{attentionQueue.needsAction}</b><span>Declined or overdue</span></button>
            <button type="button" onClick={() => chooseCompleteness("unassigned")}><b>{attentionQueue.unassigned}</b><span>Unassigned games</span></button>
            <button type="button" onClick={() => chooseCompleteness("awaiting")}><b>{attentionQueue.awaiting}</b><span>Awaiting response</span></button>
            <button type="button" onClick={() => { setUnpublishedOnly(true); setCompletenessFilter("all"); setSelected(""); }}><b>{attentionQueue.unpublished}</b><span>Not published</span></button>
          </section>
        )}
        <div className="assignmentFilterPanel">
        <div
          className="assignmentDateFilters"
          style={{ paddingBottom: 10, borderBottom: "1px solid #dbeafe" }}
        >
          <span className="assignmentFilterLabel">View</span>
          <button
            type="button"
            className={selfAssignOnly ? "success" : "secondary"}
            aria-pressed={selfAssignOnly}
            onClick={() => {
              const next = !selfAssignOnly;
              setSelfAssignOnly(next);
              setLinkSelected([]);
              if (next && selected && selfAssignOpenCount(selected) === 0)
                setSelected("");
            }}
          >
            {selfAssignOnly ? "✓ " : ""}Open for Self Assign ({selfAssignGameCount})
          </button>
          {selfAssignOnly && (
            <button
              type="button"
              className="secondary"
              onClick={() => setSelfAssignOnly(false)}
            >
              Show All Games
            </button>
          )}
        </div>
        <div className="assignmentDateFilters">
          <span className="assignmentFilterLabel">Date</span>
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={range === key ? "primary" : "secondary"}
              onClick={() => chooseRange(key)}
            >
              {label} (
              {
                games.filter(
                  (g) =>
                    inRange(g, key, customDate) && matchesOfficialFilter(g),
                ).length
              }
              )
            </button>
          ))}
          <button
            type="button"
            className="assignmentCalendarButton"
            onClick={() => setShowCalendar(!showCalendar)}
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
        {canManage && (
          <div className="assignmentDirectFilters">
            <span className="assignmentFilterLabel">Filters</span>
            <label>
              Location
              <select
                aria-label="Show games at location"
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(event.target.value);
                  setLinkSelected([]);
                  setSelected("");
                }}
              >
                <option value="">All Locations</option>
                {Array.from(
                  new Map(
                    games
                      .filter((listedGame) => listedGame.location)
                      .map((listedGame) => [listedGame.location!.id, listedGame.location!.name]),
                  ).entries(),
                )
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
              </select>
            </label>
            <label>
              Official
              <select
                aria-label="Show games assigned to official"
                value={officialFilter}
                onChange={(event) => {
                  setOfficialFilter(event.target.value);
                  setLinkSelected([]);
                  setSelected("");
                }}
              >
                <option value="">All Officials</option>
                {officials
                  .filter((official) => assignments.some(
                    (assignment) =>
                      assignment.official_id === official.id &&
                      assignment.status !== "declined",
                  ))
                  .map((official) => (
                    <option key={official.id} value={official.id}>
                      {official.last_name}, {official.first_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Assignment Status
              <select
                aria-label="Filter by assignment status"
                value={completenessFilter}
                onChange={(event) =>
                  chooseCompleteness(event.target.value as Completeness)
                }
              >
                <option value="all">All Assignment Statuses ({rangeGames.length})</option>
                <option value="unassigned">Unassigned</option>
                <option value="partial">Partially Assigned</option>
                <option value="full">Fully Assigned</option>
                <option value="awaiting">Awaiting Confirmation</option>
                <option value="confirmed">Confirmed</option>
                <option value="attention">Needs Attention</option>
              </select>
            </label>
            <label className="assignmentCheckboxFilter">
              <input
                type="checkbox"
                checked={unpublishedOnly}
                onChange={toggleUnpublished}
              />
              Show not published only ({rangeGames.filter(isUnpublishedGame).length})
            </label>
            {hasDirectGameFilter && (
              <span>Showing matching games across all dates and assignment statuses.</span>
            )}
          </div>
        )}
        {canManage && (
          <div className="assignmentSavedViews">
            <span className="assignmentFilterLabel">Saved Views</span>
            {savedViews.map((view) => <span className="savedViewChip" key={view.id}><button type="button" onClick={() => applySavedView(view)}>{view.name}</button><button type="button" aria-label={`Delete saved view ${view.name}`} title="Delete saved view" onClick={() => deleteSavedView(view.id)}>×</button></span>)}
            <button type="button" className="secondary" onClick={saveCurrentView}>+ Save Current View</button>
          </div>
        )}
        </div>
        {canManage && linkSelected.length > 0 && (
          <div className="assignmentSelectionBar">
            <div className="assignmentSelectionSummary">
              <b>
                {assignmentSelectionIsLinked
                  ? "1 linked group selected"
                  : assignmentSelectionTarget
                    ? `Game #${assignmentSelectionTarget.game_number} — ${assignmentSelectionTarget.home?.name || "TBD"} vs ${assignmentSelectionTarget.away?.name || "TBD"}`
                    : `${linkSelected.length} games selected`}
              </b>
              {assignmentSelectionTarget && (
                <span>
                  {assignmentSelectionTarget.officials_needed} positions • {assignments.filter((item) => item.game_id === assignmentSelectionTarget.id && item.status !== "declined").length} assigned • {Math.max(0, assignmentSelectionTarget.officials_needed - assignments.filter((item) => item.game_id === assignmentSelectionTarget.id && item.status !== "declined").length)} open
                </span>
              )}
            </div>
            <button className="success" disabled={bulkWorking || selfAssignSaving || !assignmentSelectionTarget} onClick={prepareSelfAssignPositions}>Open Positions for Self Assign</button>
            <button className="secondary" disabled={bulkWorking} onClick={() => void runBulkAction("publish")}>Publish</button>
            <button className="secondary" disabled={bulkWorking} onClick={() => void runBulkAction("confirm")}>Confirm Officials</button>
            <details className="assignmentMoreActions">
              <summary>More Actions</summary>
              <div>
                <button className="secondary" disabled={bulkWorking} onClick={() => void runBulkAction("unassign")}>Unassign Officials</button>
                <button className="secondary" disabled={bulkWorking || !selfAssignSlots.some((slot) => linkSelected.includes(slot.game_id))} onClick={() => void runBulkAction("closeSelfAssign")}>Close Self Assign</button>
                <label>Game Status<select aria-label="Bulk game status" value={bulkStatus} disabled={bulkWorking} onChange={(e) => setBulkStatus(e.target.value)}>{gameStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <button className="secondary" disabled={bulkWorking} onClick={() => void runBulkAction("status")}>Apply Status</button>
                <button className="secondary" disabled={linking || bulkWorking || linkSelected.length < 2} onClick={() => void linkGames()}>Link Selected Games</button>
                <button className="secondary" disabled={bulkWorking} onClick={() => void exportAssignments(linkSelected)}>Export Selected</button>
              </div>
            </details>
            <button className="assignmentClearSelection" disabled={bulkWorking} onClick={() => setLinkSelected([])}>Clear selection</button>
            {bulkWorking && <span>Working…</span>}
          </div>
        )}
        <div
          className="assignmentGameTable"
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
              Games <small>{filteredGames.length} results</small>
            </b>
            <span
              style={{
                display: "flex",
                gap: 7,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="secondary"
                disabled={!filteredGames.length || bulkWorking}
                onClick={() =>
                  setLinkSelected(
                    linkSelected.length === filteredGames.length
                      ? []
                      : filteredGames.map((g) => g.id),
                  )
                }
              >
                {linkSelected.length === filteredGames.length
                  ? "Clear Selection"
                  : "Select All Games"}
              </button>
            </span>
          </div>
          <div
            className="assignmentGameTableHeader"
          >
            <span />
            <button
              type="button"
              onClick={() => sortGames("game")}
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
              Date &amp; Time{sortArrow("time")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("power")}
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
              Power{sortArrow("power")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("status")}
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
              Game Status{sortArrow("status")}
            </button>
            <button
              type="button"
              onClick={() => sortGames("assignments")}
              style={{
                border: 0,
                background: "none",
                padding: 0,
                textAlign: "right",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Assignment Status{sortArrow("assignments")}
            </button>
          </div>
          <div className="assignmentGameRows" style={{ maxHeight: 420, overflowY: "auto" }}>
            {gameUnits.length ? (
              gameUnits.map((unit) => {
                const warnings = unit.groupId
                  ? linkedGroupWarnings(unit.games)
                  : [];
                return (
                  <div key={unit.key}>
                    {unit.groupId && (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 12px",
                            background: "#dbeafe",
                            color: "#1e3a8a",
                            borderBottom: "1px solid #93c5fd",
                            fontWeight: 900,
                          }}
                        >
                          <span>
                            🔗 Linked Games{" "}
                            <small style={{ fontWeight: 600 }}>
                              • Drag games to set crew order
                            </small>
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            disabled={linking}
                            onClick={() => void unlinkGames(unit.groupId!)}
                            style={{ padding: "5px 9px", fontSize: 11 }}
                          >
                            Unlink Group
                          </button>
                        </div>
                        {warnings.map((warning) => (
                          <div
                            key={warning}
                            role="alert"
                            style={{
                              padding: "8px 12px",
                              background: "#fff7ed",
                              color: "#9a3412",
                              borderBottom: "1px solid #fdba74",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            ⚠️ {warning}
                          </div>
                        ))}
                      </>
                    )}
                    {unit.games.map((listedGame, index) => {
                      const previous = index > 0 ? unit.games[index - 1] : null;
                      const travel = previous
                        ? travelDetails(previous, listedGame)
                        : null;
                      return (
                        <div
                          key={listedGame.id}
                          draggable={
                            Boolean(unit.groupId) && canManage && !linking
                          }
                          onDragStart={() => setDraggingGame(listedGame.id)}
                          onDragEnd={() => setDraggingGame("")}
                          onDragOver={(event) => {
                            if (unit.groupId) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (unit.groupId)
                              void reorderLinkedGame(
                                unit.groupId,
                                draggingGame,
                                listedGame.id,
                              );
                          }}
                          style={{
                            opacity: draggingGame === listedGame.id ? 0.7 : 1,
                            position: "relative",
                          }}
                        >
                          {unit.groupId && previous && travel && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "5px 12px 5px 50px",
                                background:
                                  travel.impossible && travel.shared.length
                                    ? "#fff7ed"
                                    : "#f8fafc",
                                color:
                                  travel.impossible && travel.shared.length
                                    ? "#9a3412"
                                    : "#475569",
                                borderBottom: "1px dashed #cbd5e1",
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              <span>↳</span>
                              <span>
                                {travel.travel
                                  ? `Estimated travel: ${travel.travel.minutes} min (${travel.travel.miles.toFixed(1)} mi)`
                                  : "Travel time unavailable — location coordinates needed"}
                              </span>
                              <span>
                                • Schedule gap: {travel.gapMinutes} min
                              </span>
                            </div>
                          )}
                          {unit.groupId && canManage && (
                            <div
                              style={{
                                position: "absolute",
                                right: 8,
                                top: 8,
                                zIndex: 2,
                                display: "flex",
                                gap: 4,
                              }}
                            >
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Move ${listedGame.game_number} earlier`}
                                title="Move earlier"
                                disabled={linking || index === 0}
                                onClick={() =>
                                  void moveLinkedGame(
                                    unit.groupId!,
                                    listedGame.id,
                                    -1,
                                  )
                                }
                                style={{ padding: "3px 6px", fontSize: 10 }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Move ${listedGame.game_number} later`}
                                title="Move later"
                                disabled={
                                  linking || index === unit.games.length - 1
                                }
                                onClick={() =>
                                  void moveLinkedGame(
                                    unit.groupId!,
                                    listedGame.id,
                                    1,
                                  )
                                }
                                style={{ padding: "3px 6px", fontSize: 10 }}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                aria-label={`Unlink ${listedGame.game_number}`}
                                title="Unlink this game"
                                disabled={linking}
                                onClick={() =>
                                  void unlinkOneGame(
                                    unit.groupId!,
                                    listedGame.id,
                                  )
                                }
                                style={{ padding: "3px 6px", fontSize: 10 }}
                              >
                                Unlink
                              </button>
                            </div>
                          )}
                          {renderGameRow(
                            listedGame,
                            Boolean(unit.groupId),
                            Boolean(unit.groupId) && index > 0,
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <div style={{ padding: 14, color: "#64748b" }}>
                {selfAssignOnly
                  ? "No games are currently open for Self Assign in this selection."
                  : "No games in this selection."}
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
                              {shortPositionName(pos.name)}
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
            onChange={(e) => requestSelectedGame(e.target.value)}
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
          <section
            id="selected-game-assignment"
            className="card assignmentMain"
          >
            <div className="cardHead selectedGameStickyHeader">
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
                <div className="selectedGameSummary" aria-label="Assignment summary">
                  <span><b>{game.officials_needed}</b> Positions</span>
                  <span><b>{activeAssignmentCount}</b> Assigned</span>
                  <span><b>{openPositionCount}</b> Open</span>
                  <span><b>{gameAssignments.filter((item) => item.status === "proposed" && item.published_at).length}</b> Awaiting</span>
                  <span><b>{gameAssignments.filter((item) => ["accepted", "confirmed"].includes(item.status)).length}</b> Confirmed</span>
                </div>
                <button type="button" className="assignmentActivityLink" onClick={() => void openActivityTimeline()}>View activity timeline</button>
                <div
                  className="assignmentConfirmMessage"
                  style={{ marginTop: 10 }}
                  aria-label="Notification history"
                >
                  <b>Notification history:</b>{" "}
                  {["canceled", "rained_out"].includes(game.status)
                    ? `${cancellationEmailsSent} cancellation notice${cancellationEmailsSent === 1 ? "" : "s"} sent`
                    : `${assignmentEmailsSent} assignment email${assignmentEmailsSent === 1 ? "" : "s"} sent`}
                  {(cancellationEmailIssues || assignmentEmailIssues) > 0 && (
                    <>
                      {" • "}
                      <b style={{ color: "#b91c1c" }}>
                        {["canceled", "rained_out"].includes(game.status)
                          ? cancellationEmailIssues
                          : assignmentEmailIssues}{" "}
                        need attention
                      </b>
                      <button
                        type="button"
                        className="secondary"
                        disabled={retryingNotifications}
                        onClick={() => void retryNotificationIssues()}
                        style={{ marginLeft: 10 }}
                      >
                        {retryingNotifications ? "Retrying…" : "Retry Failed Notifications"}
                      </button>
                    </>
                  )}
                </div>
                {openPositionCount > 0 && (
                  <div className="errorBox" style={{ marginTop: 10 }}>
                    Publish readiness: {openPositionCount} required position
                    {openPositionCount === 1 ? " is" : "s are"} still open.
                    You can publish the assigned officials now or fill the open
                    positions first.
                  </div>
                )}
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
                      <th>Self Assign</th>
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
                            a.game_id === game.id &&
                            a.position_id === pos.id &&
                            a.status !== "declined",
                        ),
                        declined = assignments.find(
                          (a) =>
                            a.game_id === game.id &&
                            a.position_id === pos.id &&
                            a.status === "declined",
                        ),
                        list = candidates(pos),
                        label = rankLabel(pos),
                        status = current ? assignmentStatus(current) : null;
                      return (
                        <tr
                          key={pos.id}
                          style={{
                            background:
                              declined && !current ? "#fff1f2" : undefined,
                          }}
                        >
                          <td>
                            {!current && !isSelfAssignOpen(game.id, pos.id) ? (
                              <input
                                type="checkbox"
                                checked={selfAssignSelected.includes(
                                  selfAssignKey(game.id, pos.id),
                                )}
                                disabled={!canManage || selfAssignSaving}
                                aria-label={`Select ${pos.name} for Self Assign`}
                                onChange={() =>
                                  toggleSelfAssignSelection(game.id, pos.id)
                                }
                              />
                            ) : !current ? (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  alignItems: "center",
                                }}
                              >
                                <span className="badge green">Open</span>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={!canManage || selfAssignSaving}
                                  onClick={() =>
                                    void withdrawSelfAssignPosition(
                                      game.id,
                                      pos.id,
                                    )
                                  }
                                  style={{ padding: "4px 7px", fontSize: 10 }}
                                >
                                  Close Self Assign
                                </button>
                              </div>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
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
                                <b>{shortPositionName(pos.name)}</b>
                                {declined && !current && (
                                  <span
                                    className="badge red"
                                    style={{ marginLeft: 6 }}
                                  >
                                    Replacement Needed
                                  </span>
                                )}
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
                                    className="assignmentPositionControls"
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
                                          : "Confirm Official"}
                                      </button>
                                    </div>
                                  )}
                              </div>
                            ) : declined ? (
                              <div>
                                <b style={{ color: "#b91c1c" }}>
                                  Open — official declined
                                </b>
                                <small>
                                  {
                                    officials.find(
                                      (o) => o.id === declined.official_id,
                                    )?.first_name
                                  }{" "}
                                  {
                                    officials.find(
                                      (o) => o.id === declined.official_id,
                                    )?.last_name
                                  }
                                  {declined.decline_reason
                                    ? ` • ${declined.decline_reason}`
                                    : ""}
                                  {declined.responded_at
                                    ? ` • ${new Date(declined.responded_at).toLocaleString()}`
                                    : ""}
                                </small>
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
                            ) : declined ? (
                              <span className="badge red">Declined</span>
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
                              <option value="">Select Official / Leave Open</option>
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
                            <details className="mobileAssignmentDetails">
                              <summary>More Details</summary>
                              <div>
                                <small>Slot {index + 1} of {game.officials_needed} • {label}</small>
                                <small>Self Assign: {isSelfAssignOpen(game.id, pos.id) ? "Open" : "Closed"}</small>
                                {!current && isSelfAssignOpen(game.id, pos.id) && (
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={!canManage || selfAssignSaving}
                                    onClick={() => void withdrawSelfAssignPosition(game.id, pos.id)}
                                  >
                                    Close Self Assign
                                  </button>
                                )}
                                {current && canManage && (
                                  <div className="mobilePositionMove">
                                    <span>Move official:</span>
                                    <button type="button" aria-label="Move official to previous position" disabled={index === 0 || movingAssignment === current.id} onClick={() => void moveAssignment(game.id, current.id, -1)}>←</button>
                                    <button type="button" aria-label="Move official to next position" disabled={index === gamePositions.length - 1 || movingAssignment === current.id} onClick={() => void moveAssignment(game.id, current.id, 1)}>→</button>
                                  </div>
                                )}
                              </div>
                            </details>
                            {declined && !current && (
                              <div
                                style={{
                                  marginTop: 7,
                                  padding: 8,
                                  background: "#fff",
                                  border: "1px solid #fecaca",
                                  borderRadius: 7,
                                }}
                              >
                                <b style={{ fontSize: 11, color: "#991b1b" }}>
                                  Recommended qualified replacements
                                </b>
                                {list
                                  .filter(
                                    (candidate) =>
                                      candidate.reasons.length === 0,
                                  )
                                  .slice(0, 3)
                                  .map((candidate, recommendationIndex) => (
                                    <button
                                      key={candidate.id}
                                      type="button"
                                      disabled={saving === pos.id}
                                      onClick={() =>
                                        void assign(pos.id, candidate.id)
                                      }
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        textAlign: "left",
                                        marginTop: 5,
                                        padding: "6px 8px",
                                        border: "1px solid #e2e8f0",
                                        borderRadius: 6,
                                        background: "#f8fafc",
                                        cursor: "pointer",
                                        fontSize: 11,
                                      }}
                                    >
                                      <b>
                                        {recommendationIndex + 1}.{" "}
                                        {candidate.first_name}{" "}
                                        {candidate.last_name}
                                      </b>{" "}
                                      — {label} {candidate.rank.toFixed(1)}
                                      {candidate.distance != null
                                        ? ` • ${candidate.distance.toFixed(1)} mi`
                                        : ""}
                                    </button>
                                  ))}
                                {list.every(
                                  (candidate) => candidate.reasons.length > 0,
                                ) && (
                                  <small
                                    style={{ display: "block", marginTop: 5 }}
                                  >
                                    No fully qualified, conflict-free
                                    replacements are currently available.
                                  </small>
                                )}
                              </div>
                            )}
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
                <div className="ineligibleOfficialsSection">
                  <button
                    type="button"
                    className="ineligibleOfficialsToggle"
                    aria-expanded={showIneligibleOfficials}
                    onClick={() => setShowIneligibleOfficials((visible) => !visible)}
                  >
                    <span>INELIGIBLE ({ineligibleOfficials.length})</span>
                    <span>{showIneligibleOfficials ? "Hide" : "Show"}</span>
                  </button>
                  {showIneligibleOfficials && (
                    <>
                      <div className="ineligibleOfficialFilters">
                        <input
                          type="search"
                          value={ineligibleSearch}
                          onChange={(event) => setIneligibleSearch(event.target.value)}
                          placeholder="Search official"
                          aria-label="Search ineligible officials"
                        />
                        <select
                          value={ineligibleReasonFilter}
                          onChange={(event) => setIneligibleReasonFilter(event.target.value)}
                          aria-label="Filter ineligible officials by reason"
                        >
                          <option value="all">All reasons</option>
                          <option value="eligibility">League or level</option>
                          <option value="availability">Unavailable</option>
                          <option value="conflict">Assignment conflict</option>
                        </select>
                      </div>
                      {visibleIneligibleOfficials.map((o) => (
                    <div
                      className="availableOfficial ineligibleOfficial"
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
                                  : "Override Eligibility"}
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
                      {!visibleIneligibleOfficials.length && (
                        <div className="emptyState"><p>No ineligible officials match the filters.</p></div>
                      )}
                    </>
                  )}
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
