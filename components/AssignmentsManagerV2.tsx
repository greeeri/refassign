Warning: truncated output (original token count: 89236)
Total output lines: 9176

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  gameAcceptsAssignments,
  inactiveGameStatusLabel,
  normalizeGameStatus,
} from "../lib/game-status";
import { createClient } from "../lib/supabase/client";
import { announceUndoAvailable } from "./UndoCenter";
import SelfAssignOverrideRequests from "./SelfAssignOverrideRequests";
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
  time_tbd: boolean;
  duration_minutes: number;
  officials_needed: number;
  sports: { name: string } | null;
  leagues: {
    name: string;
    assignment_fill_target_days: number;
    assignment_acceptance_hours: number;
    assignment_escalation_days: number;
    assignment_reminder_hours: number;
  } | null;
  levels: { id: string; name: string } | null;
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
  mentor_certified: boolean;
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
type LinkGroup = {
  id: string;
  name: string;
  created_at: string;
  organization_id: string;
};
type LinkMember = { group_id: string; game_id: string; sort_order: number };
type SelfAssignSlot = {
  id: string;
  game_id: string;
  position_id: string;
  status: "open" | "claimed" | "withdrawn";
};
type AssignmentTemplateSlot = {
  id: string;
  position_id: string;
  official_id: string;
  sort_order: number;
};
type AssignmentTemplate = {
  id: string;
  name: string;
  sport_id: string;
  league_id: string | null;
  created_by: string;
  updated_at: string;
  organization_id: string;
  assignment_template_slots: AssignmentTemplateSlot[];
};
type AuditEvent = {
  id: number;
  action: string;
  actor_name: string | null;
  summary: string;
  occurred_at: string;
};
type UnassignmentAudit = {
  game_id: string | null;
  old_data: { position_id?: string } | null;
};
type SavedAssignmentView = {
  id: string;
  name: string;
  range: Range;
  customDate: string;
  locationFilter: string;
  officialFilter: string;
  leagueFilter?: string;
  levelFilter?: string;
  completenessFilter: Completeness;
  unpublishedOnly: boolean;
  selfAssignOnly: boolean;
};
type QuickEditDraft = {
  gameId: string;
  startsAt: string;
  durationMinutes: number;
  locationId: string;
  levelId: string;
};
type BulkActionResult = {
  action: string;
  succeeded: number;
  failures: string[];
};
type BulkAssignmentItem = {
  gameId: string;
  gameNumber: string;
  matchup: string;
  positionId: string;
  positionName: string;
  officialId: string;
  officialName: string;
  status: "success" | "failed" | "skipped";
  error: string;
};
type BulkAssignmentResult = {
  officialId: string;
  officialName: string;
  items: BulkAssignmentItem[];
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
function assignmentOccupiesPosition(status: string) {
  return !["declined", "cancelled", "canceled"].includes(status);
}
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
function localDateKey(d: Date) {
  const year = d.getFullYear(),
    month = `${d.getMonth() + 1}`.padStart(2, "0"),
    day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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
export default function AssignmentsManagerV2({
  organizationId,
  focusGameId,
  returnToListRequest = 0,
}: {
  organizationId?: string;
  focusGameId?: string;
  returnToListRequest?: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const handledReportFocus = useRef("");
  const handledListReturnRequest = useRef(returnToListRequest);
  const [inlineAssignmentHost, setInlineAssignmentHost] =
    useState<HTMLDivElement | null>(null);
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
    [replacementOnly, setReplacementOnly] = useState(false),
    [completenessFilter, setCompletenessFilter] = useState<Completeness>("all"),
    [officialFilter, setOfficialFilter] = useState(""),
    [locationFilter, setLocationFilter] = useState(""),
    [leagueFilter, setLeagueFilter] = useState(""),
    [levelFilter, setLevelFilter] = useState(""),
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
    [draggingOfficial, setDraggingOfficial] = useState(""),
    [officialDropGame, setOfficialDropGame] = useState(""),
    [pickedOfficial, setPickedOfficial] = useState(""),
    [pendingTapAssignment, setPendingTapAssignment] = useState<{
      gameId: string;
      officialId: string;
      positionId: string;
    } | null>(null),
    [bulkWorking, setBulkWorking] = useState(false),
    [bulkStatus, setBulkStatus] = useState("active"),
    [showBulkAssign, setShowBulkAssign] = useState(false),
    [bulkAssignOfficial, setBulkAssignOfficial] = useState(""),
    [bulkAssignPositions, setBulkAssignPositions] = useState<
      Record<string, string>
    >({}),
    [bulkAssignMessage, setBulkAssignMessage] = useState(""),
    [bulkOfficialSearch, setBulkOfficialSearch] = useState(""),
    [bulkOfficialStatus, setBulkOfficialStatus] = useState<
      "eligible" | "all" | "warning" | "blocked"
    >("eligible"),
    [bulkAssignmentResult, setBulkAssignmentResult] =
      useState<BulkAssignmentResult | null>(null),
    [bulkRetryingGame, setBulkRetryingGame] = useState(""),
    [showBulkCrew, setShowBulkCrew] = useState(false),
    [bulkCrewSelections, setBulkCrewSelections] = useState<
      Record<string, string>
    >({}),
    [bulkCrewWorking, setBulkCrewWorking] = useState(false),
    [bulkCrewMessage, setBulkCrewMessage] = useState(""),
    [bulkCrewOverrideConfirmed, setBulkCrewOverrideConfirmed] = useState(false),
    [assignmentTemplates, setAssignmentTemplates] = useState<
      AssignmentTemplate[]
    >([]),
    [showCrewTemplates, setShowCrewTemplates] = useState(false),
    [crewTemplateName, setCrewTemplateName] = useState(""),
    [copyCrewSourceGameId, setCopyCrewSourceGameId] = useState(""),
    [crewTemplateWorking, setCrewTemplateWorking] = useState(false),
    [crewTemplateMessage, setCrewTemplateMessage] = useState(""),
    [selfAssignSlots, setSelfAssignSlots] = useState<SelfAssignSlot[]>([]),
    [selfAssignSelected, setSelfAssignSelected] = useState<string[]>([]),
    [selfAssignSaving, setSelfAssignSaving] = useState(false),
    [showSelfAssignDialog, setShowSelfAssignDialog] = useState(false),
    [showIneligibleOfficials, setShowIneligibleOfficials] = useState(false),
    [officialListSearch, setOfficialListSearch] = useState(""),
    [officialListSort, setOfficialListSort] = useState<
      "best" | "distance" | "rank" | "leastRecent" | "name"
    >("best"),
    [candidateSearch, setCandidateSearch] = useState(""),
    [candidateSort, setCandidateSort] = useState<
      "best" | "distance" | "rank" | "leastRecent" | "name"
    >("best"),
    [needsAssignmentView, setNeedsAssignmentView] = useState<
      Record<string, boolean>
    >({}),
    [ineligibleSearch, setIneligibleSearch] = useState(""),
    [ineligibleReasonFilter, setIneligibleReasonFilter] = useState("all"),
    [overduePromptClosed, setOverduePromptClosed] = useState(false),
    [overdueResolving, setOverdueResolving] = useState(false),
    [overdueSelected, setOverdueSelected] = useState<string[]>([]),
    [showPublishReview, setShowPublishReview] = useState(false),
    [showBroadcastReview, setShowBroadcastReview] = useState(false),
    [broadcasting, setBroadcasting] = useState(false),
    [showActivityTimeline, setShowActivityTimeline] = useState(false),
    [activityRows, setActivityRows] = useState<AuditEvent[]>([]),
    [activityLoading, setActivityLoading] = useState(false),
    [activityError, setActivityError] = useState(""),
    [savedViews, setSavedViews] = useState<SavedAssignmentView[]>([]),
    [quickEdit, setQuickEdit] = useState<QuickEditDraft | null>(null),
    [quickEditSaving, setQuickEditSaving] = useState(false),
    [showDeadlineSettings, setShowDeadlineSettings] = useState(false),
    [deadlineLeagueId, setDeadlineLeagueId] = useState(""),
    [deadlineDraft, setDeadlineDraft] = useState({
      fill: 14,
      acceptance: 24,
      escalation: 3,
      reminder: 24,
    }),
    [deadlineSaving, setDeadlineSaving] = useState(false),
    [showCoverageForecast, setShowCoverageForecast] = useState(false),
    [candidatePositionId, setCandidatePositionId] = useState(""),
    [scheduleOfficialId, setScheduleOfficialId] = useState(""),
    [replacementPublishing, setReplacementPublishing] = useState(""),
    [unassignedSlotKeys, setUnassignedSlotKeys] = useState<string[]>([]),
    [pendingReplacement, setPendingReplacement] = useState<{
      positionId: string;
      officialId: string;
      nextPositionId?: string;
      override?: boolean;
    } | null>(null),
    [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
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
    const gamesQuery = supabase
      .from("games")
      .select(
        "id,game_number,status,sport_id,league_id,level_id,location_id,starts_at,time_tbd,duration_minutes,officials_needed,sports(name),leagues(name,assignment_fill_target_days,assignment_acceptance_hours,assignment_escalation_days,assignment_reminder_hours),levels(id,name),home:teams!games_home_team_id_fkey(id,name),away:teams!games_away_team_id_fkey(id,name),location:locations(id,name,city,state,latitude,longitude)",
      )
      .order("starts_at");
    const [g, oo, o, p, a, r, pr, pw, le, ve, bl, lg, lm, sas, ah, at] =
      await Promise.all([
        organizationId
          ? gamesQuery.eq("organization_id", organizationId)
          : gamesQuery,
        organizationId
          ? supabase
              .from("organization_officials")
              .select("official_id")
              .eq("organization_id", organizationId)
              .eq("active", true)
          : Promise.resolve({ data: null, error: null }),
        organizationId
          ? Promise.resolve({ data: [], error: null })
          : supabase
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
        supabase.from("my_assignment_rankings").select("official_id,rank"),
        supabase
          .from("my_assignment_rankings")
          .select(
            "official_id,ref_rank,ar1_rank,ar2_rank,fourth_rank,mentor_certified",
          ),
        supabase.from("assignor_team_power_rankings").select("team_id,power"),
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
          .select("id,name,created_at,organization_id")
          .eq("organization_id", organizationId || "")
          .order("created_at", { ascending: false }),
        supabase
          .from("game_link_members")
          .select("group_id,game_id,sort_order")
          .order("sort_order"),
        supabase
          .from("assignment_self_assign_slots")
          .select("id,game_id,position_id,status")
          .eq("status", "open"),
        supabase
          .from("audit_history")
          .select("game_id,old_data")
          .eq("action", "unassigned"),
        supabase
          .from("assignment_templates")
          .select(
            "id,name,sport_id,league_id,created_by,updated_at,organization_id,assignment_template_slots(id,position_id,official_id,sort_order)",
          )
          .eq("organization_id", organizationId || "")
          .order("updated_at", { ascending: false }),
      ]);
    const err =
      g.error ||
      oo.error ||
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
      sas.error ||
      ah.error ||
      at.error;
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
          mentor_certified: Boolean(x.mentor_certified),
        }),
    );
    ((pw.data || []) as Power[]).forEach(
      (x) => (pm[x.team_id] = Number(x.power)),
    );
    setRanks(rm);
    setPositionRanks(prm);
    setPowers(pm);
    let officialRows = (o.data || []) as Official[];
    if (organizationId) {
      const organizationOfficialIds = (oo.data || []).map(
        (link) => link.official_id,
      );
      officialRows = [];
      for (let index = 0; index < organizationOfficialIds.length; index += 200) {
        const { data: page, error: pageError } = await supabase
          .from("officials")
          .select(
            "id,first_name,last_name,email,phone,sports,active,home_city,home_state,home_latitude,home_longitude",
          )
          .in("id", organizationOfficialIds.slice(index, index + 200))
          .eq("active", true)
          .order("last_name")
          .order("first_name");
        if (pageError) {
          setError(pageError.message);
          return;
        }
        officialRows.push(...((page || []) as Official[]));
      }
      officialRows.sort(
        (a, b) =>
          a.last_name.localeCompare(b.last_name) ||
          a.first_name.localeCompare(b.first_name),
      );
    }
    setOfficials(officialRows);
    setPositions((p.data || []) as Position[]);
    const scopedGames = (g.data || []) as unknown as Game[];
    const scopedGameIds = new Set(scopedGames.map((game) => game.id));
    setAssignments(
      ((a.data || []) as Assignment[]).filter((assignment) =>
        scopedGameIds.has(assignment.game_id),
      ),
    );
    setLeagueElig((le.data || []) as EligL[]);
    setLevelElig((ve.data || []) as EligV[]);
    setBlocks((bl.data || []) as Block[]);
    setLinkGroups((lg.data || []) as LinkGroup[]);
    setLinkMembers(
      ((lm.data || []) as LinkMember[]).filter((member) =>
        scopedGameIds.has(member.game_id),
      ),
    );
    setSelfAssignSlots(
      ((sas.data || []) as SelfAssignSlot[]).filter((slot) =>
        scopedGameIds.has(slot.game_id),
      ),
    );
    setAssignmentTemplates((at.data || []) as AssignmentTemplate[]);
    setUnassignedSlotKeys([
      ...new Set(
        ((ah.data || []) as UnassignmentAudit[]).flatMap((row) =>
          row.game_id &&
          scopedGameIds.has(row.game_id) &&
          row.old_data?.position_id
            ? [`${row.game_id}:${row.old_data.position_id}`]
            : [],
        ),
      ),
    ]);
    const sorted = scopedGames.sort(
      (x, y) =>
        gamePower(y, pm) - gamePower(x, pm) ||
        new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime(),
    );
    setGames(sorted);
    setLinkSelected((current) =>
      current.filter((gameId) => scopedGameIds.has(gameId)),
    );
    setSelfAssignSelected((current) =>
      current.filter((slotKey) => scopedGameIds.has(slotKey.split(":")[0])),
    );
    setSelected((current) =>
      scopedGameIds.has(current) ? current : sorted[0]?.id || "",
    );
  }
  useEffect(() => {
    setLinkSelected([]);
    setSelfAssignSelected([]);
    setSelected("");
    setReplacementOnly(false);
    void load();
  }, [organizationId]);
  useEffect(() => {
    if (handledListReturnRequest.current === returnToListRequest) return;
    handledListReturnRequest.current = returnToListRequest;
    const previousGameId = selected;
    setCandidatePositionId("");
    setPendingReplacement(null);
    setPendingTapAssignment(null);
    setScheduleOfficialId("");
    setShowActivityTimeline(false);
    setShowPublishReview(false);
    setShowBroadcastReview(false);
    setShowCrewTemplates(false);
    setShowSelfAssignDialog(false);
    setShowBulkAssign(false);
    setShowBulkCrew(false);
    setSelected("");
    setOverrideOfficial("");
    setLinkSelected([]);
    window.setTimeout(() => {
      const previousGame = previousGameId
        ? document.getElementById(`assignment-game-${previousGameId}`)
        : null;
      (previousGame || document.getElementById("assignment-filtered-games"))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }, [returnToListRequest, selected]);
  useEffect(() => {
    if (!focusGameId || handledReportFocus.current === focusGameId || !games.some((item) => item.id === focusGameId)) return;
    handledReportFocus.current = focusGameId;
    setRange("all");
    setCustomDate("");
    setUnpublishedOnly(false);
    setSelfAssignOnly(false);
    setCompletenessFilter("all");
    setOfficialFilter("");
    setLocationFilter("");
    setLeagueFilter("");
    setLevelFilter("");
    setSelected(focusGameId);
    window.setTimeout(
      () => document.getElementById("selected-game-assignment")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }, [focusGameId, games]);
  useEffect(() => {
    void loadSavedViews();
  }, []);
  async function refreshAssignmentState() {
    const [assignmentResult, selfAssignResult, unassignmentResult] =
      await Promise.all([
        supabase
          .from("assignments")
          .select(
            "id,game_id,official_id,position_id,status,published_at,accept_by,responded_at,decline_reason,overdue_reviewed_at,assignment_source,email_sent_at,email_error,resend_email_id,cancellation_notified_at,cancellation_email_error,cancellation_email_id",
          ),
        supabase
          .from("assignment_self_assign_slots")
          .select("id,game_id,position_id,status")
          .eq("status", "open"),
        supabase
          .from("audit_history")
          .select("game_id,old_data")
          .eq("action", "unassigned"),
      ]);
    const refreshError =
      assignmentResult.error ||
      selfAssignResult.error ||
      unassignmentResult.error;
    if (refreshError) {
      setError(refreshError.message);
      return false;
    }
    const visibleGameIds = new Set(games.map((game) => game.id));
    setAssignments(
      ((assignmentResult.data || []) as Assignment[]).filter((assignment) =>
        visibleGameIds.has(assignment.game_id),
      ),
    );
    setSelfAssignSlots(
      ((selfAssignResult.data || []) as SelfAssignSlot[]).filter((slot) =>
        visibleGameIds.has(slot.game_id),
      ),
    );
    setUnassignedSlotKeys([
      ...new Set(
        ((unassignmentResult.data || []) as UnassignmentAudit[]).flatMap(
          (row) =>
            row.game_id &&
            visibleGameIds.has(row.game_id) &&
            row.old_data?.position_id
              ? [`${row.game_id}:${row.old_data.position_id}`]
              : [],
        ),
      ),
    ]);
    return true;
  }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function gamePower(g: Game, map = powers) {
    return (
      ((g.home ? (map[g.home.id] ?? 1) : 1) +
        (g.away ? (map[g.away.id] ?? 1) : 1)) /
      2
    );
  }
  function isReplacementNeeded(gameId: string, positionId: string) {
    const hasActiveAssignment = assignments.some(
      (assignment) =>
        assignment.game_id === gameId &&
        assignment.position_id === positionId &&
        assignment.status !== "declined",
    );
    if (hasActiveAssignment) return false;
    return (
      unassignedSlotKeys.includes(`${gameId}:${positionId}`) ||
      assignments.some(
        (assignment) =>
          assignment.game_id === gameId &&
          assignment.position_id === positionId &&
          assignment.status === "declined",
      )
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
      replacementCount = slots.filter((slot) =>
        isReplacementNeeded(g.id, slot.id),
      ).length;
    if (replacementCount)
      return {
        key: "attention" as const,
        label: "Needs Attention",
        color: "#dc2626",
        detail: `${replacementCount} position${replacementCount === 1 ? "" : "s"} need replacement`,
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
  function staffingCounts(g: Game) {
    const slots = positions
      .filter((position) => position.sport_id === g.sport_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .slice(0, Math.max(0, g.officials_needed));
    const filled = new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.game_id === g.id &&
            assignment.status !== "declined" &&
            slots.some((slot) => slot.id === assignment.position_id),
        )
        .map((assignment) => assignment.position_id),
    ).size;
    return {
      filled,
      total: slots.length,
      open: Math.max(0, slots.length - filled),
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
  function matchesLeagueFilter(g: Game) {
    return !leagueFilter || g.league_id === leagueFilter;
  }
  function matchesLevelFilter(g: Game) {
    return !levelFilter || g.level_id === levelFilter;
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
  function gameNeedsReplacement(listedGame: Game) {
    return positions
      .filter((position) => position.sport_id === listedGame.sport_id)
      .slice(0, listedGame.officials_needed)
      .some((position) =>
        isReplacementNeeded(listedGame.id, position.id),
      );
  }
  const hasDirectGameFilter = Boolean(
    locationFilter || officialFilter || leagueFilter || levelFilter,
  );
  const rangeGames = games.filter((g) => inRange(g, range, customDate));
  const baseFilteredGames = games.filter((g) => {
    const matchesSelfAssign = !selfAssignOnly || selfAssignOpenCount(g.id) > 0;
    const matchesReplacement = !replacementOnly || gameNeedsReplacement(g);
    if (hasDirectGameFilter)
      return (
        matchesLocationFilter(g) &&
        matchesOfficialFilter(g) &&
        matchesLeagueFilter(g) &&
        matchesLevelFilter(g) &&
        matchesSelfAssign &&
        matchesReplacement
      );
    return (
      inRange(g, range, customDate) &&
      matchesSelfAssign &&
      matchesReplacement &&
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
  const assignmentSelection = games.filter((listedGame) =>
    linkSelected.includes(listedGame.id),
  );
  const broadcastOpenPositions = assignmentSelection.flatMap((selectedGame) =>
    positions
      .filter((position) => position.sport_id === selectedGame.sport_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .slice(0, selectedGame.officials_needed)
      .filter(
        (position) =>
          !assignments.some(
            (assignment) =>
              assignment.game_id === selectedGame.id &&
              assignment.position_id === position.id &&
              !["declined", "cancelled", "canceled"].includes(assignment.status),
          ),
      ),
  );
  const broadcastOfficials = officials.filter((official) => official.active);
  const broadcastMissingEmails = broadcastOfficials.filter((official) => !official.email).length;
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
      .insert({
        name: "Linked Games",
        created_by: userData.user?.id || null,
        organization_id: organizationId,
      })
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
    const gameIds = linkSelected.length ? linkSelected : game ? [game.id] : [];
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
  const needsAssignmentOnly = game
    ? Boolean(needsAssignmentView[game.id])
    : false;
  function positionNeedsAssignment(position: Position) {
    if (!game) return false;
    return !assignments.some(
      (assignment) =>
        assignment.game_id === game.id &&
        assignment.position_id === position.id &&
        !["declined", "cancelled"].includes(assignment.status),
    );
  }
  const visibleGamePositions = needsAssignmentOnly
    ? gamePositions.filter(positionNeedsAssignment)
    : gamePositions;
  const unpublishedCount = gameAssignments.filter(
    (a) => !a.published_at && a.status !== "declined",
  ).length;
  const unpublishedAssignments = gameAssignments.filter(
    (assignment) =>
      !assignment.published_at && assignment.status !== "declined",
  );
  const publishMissingEmails = unpublishedAssignments.filter(
    (assignment) =>
      !officials.find((item) => item.id === assignment.official_id)?.email,
  ).length;
  const publishAcceptanceHours =
    game?.leagues?.assignment_acceptance_hours ?? 24;
  const activeAssignmentCount = gameAssignments.filter(
    (a) => !["declined", "cancelled"].includes(a.status),
  ).length;
  const openPositionCount = Math.max(
    0,
    gamePositions.length - activeAssignmentCount,
  );
  const assignmentEmailsSent = gameAssignments.filter(
    (a) => a.email_sent_at,
  ).length;
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
  function workloadWindow(officialId: string, days: number) {
    const now = Date.now(),
      end = now + days * 86400000;
    return assignments
      .filter(
        (item) =>
          item.official_id === officialId &&
          !["declined", "cancelled"].includes(item.status),
      )
      .filter((item) => {
        const start = new Date(
          games.find((listed) => listed.id === item.game_id)?.starts_at || 0,
        ).getTime();
        return start >= now && start <= end;
      }).length;
  }
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
    setSelected("");
    setLinkSelected([]);
  }
  function chooseDate(value: string) {
    setCustomDate(value);
    setRange("custom");
    setOverrideOfficial("");
    setSelected("");
    setLinkSelected([]);
  }
  function toggleUnpublished() {
    const next = !unpublishedOnly;
    setUnpublishedOnly(next);
    setReplacementOnly(false);
    setOverrideOfficial("");
    setSelected("");
    setLinkSelected([]);
  }
  function chooseCompleteness(value: Completeness) {
    setCompletenessFilter(value);
    setReplacementOnly(false);
    setOverrideOfficial("");
    setSelected("");
    setLinkSelected([]);
  }
  function clearGameFilters() {
    setRange("all");
    setCustomDate("");
    setShowCalendar(false);
    setUnpublishedOnly(false);
    setSelfAssignOnly(false);
    setReplacementOnly(false);
    setCompletenessFilter("all");
    setOfficialFilter("");
    setLocationFilter("");
    setLeagueFilter("");
    setLevelFilter("");
    setSelected("");
    setLinkSelected([]);
  }
  async function loadSavedViews() {
    const { data, error: viewError } = await supabase
      .from("assignment_saved_views")
      .select("id,name,filters")
      .order("updated_at", { ascending: false });
    if (viewError) return;
    setSavedViews(
      (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.filters as Omit<SavedAssignmentView, "id" | "name">),
      })),
    );
  }
  async function saveCurrentView() {
    const name = window.prompt("Name this Assignment Center view:")?.trim();
    if (!name) return;
    const filters = {
      range,
      customDate,
      locationFilter,
      officialFilter,
      leagueFilter,
      levelFilter,
      completenessFilter,
      unpublishedOnly,
      selfAssignOnly,
    };
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setError("Sign in to save a shared view.");
    const { error: saveError } = await supabase
      .from("assignment_saved_views")
      .upsert(
        {
          user_id: auth.user.id,
          name,
          filters,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,name" },
      );
    if (saveError) return setError(saveError.message);
    await loadSavedViews();
    setNotice(`Saved shared view “${name}”.`);
  }
  function applySavedView(view: SavedAssignmentView) {
    setRange(view.range);
    setCustomDate(view.customDate);
    setLocationFilter(view.locationFilter);
    setOfficialFilter(view.officialFilter);
    setLeagueFilter(view.leagueFilter || "");
    setLevelFilter(view.levelFilter || "");
    setCompletenessFilter(view.completenessFilter);
    setReplacementOnly(false);
    setUnpublishedOnly(view.unpublishedOnly);
    setSelfAssignOnly(view.selfAssignOnly);
    setLinkSelected([]);
    setSelected("");
    setNotice(`Showing saved view “${view.name}”.`);
  }
  async function deleteSavedView(viewId: string) {
    const { error: deleteError } = await supabase
      .from("assignment_saved_views")
      .delete()
      .eq("id", viewId);
    if (deleteError) return setError(deleteError.message);
    setSavedViews((current) => current.filter((view) => view.id !== viewId));
  }
  function linkedAssignmentGames() {
    if (!game) return [];
    const groupId = linkGroupByGame.get(game.id);
    return groupId
      ? games.filter(
          (listedGame) => linkGroupByGame.get(listedGame.id) === groupId,
        )
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
        .sort(
          (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
        )[sourceSlot]?.id || ""
    );
  }
  function assignmentConflictReasonsForGame(
    o: Official,
    targetGame: Game,
    ignorePositionId = "",
  ) {
    const reasons: string[] = [];
    const targetPosition = positions.find((position) => position.id === ignorePositionId);
    if (targetPosition && isMentor(targetPosition) && !positionRanks[o.id]?.mentor_certified) {
      reasons.push("Mentor certification required");
    }
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
  function conflictingAssignedGamesForGame(
    officialId: string,
    targetGame: Game,
    ignorePositionId = "",
  ) {
    return assignments.flatMap((assignment) => {
      if (
        assignment.official_id !== officialId ||
        ["declined", "cancelled"].includes(assignment.status) ||
        (ignorePositionId &&
          assignment.game_id === targetGame.id &&
          assignment.position_id === ignorePositionId)
      )
        return [];
      const otherGame = games.find((item) => item.id === assignment.game_id);
      return otherGame &&
        otherGame.id !== targetGame.id &&
        overlaps(
          targetGame.starts_at,
          targetGame.duration_minutes || 110,
          otherGame.starts_at,
          otherGame.duration_minutes || 110,
        )
        ? [otherGame]
        : [];
    });
  }
  function duplicateAssignmentReasonsForGame(
    officialId: string,
    targetGame: Game,
    positionId: string,
  ) {
    return assignments.some(
      (assignment) =>
        assignment.game_id === targetGame.id &&
        assignment.official_id === officialId &&
        assignment.position_id !== positionId &&
        assignment.status !== "declined",
    )
      ? ["Already assigned to another position on this game"]
      : [];
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
      !ol.some((x) => x.league_id === targetGame.league_id)
    )
      reasons.push(
        `Not eligible for league ${targetGame.leagues?.name || "selected league"}`,
      );
    if (
      targetGame.level_id &&
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
    if (isMentor(pos)) return 1;
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
  function positionRatingText(officialId: string, pos: Position) {
    if (isMentor(pos)) return positionRanks[officialId]?.mentor_certified ? "Mentor certified" : "Mentor certification required";
    return `${rankLabel(pos)} ${positionRankFor(officialId, pos).toFixed(1)}`;
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
          (eligible(o) || canManage || current?.official_id === o.id) &&
          !used.has(o.id) &&
          (!isMentor(pos) ||
            positionRanks[o.id]?.mentor_certified === true ||
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
        conflictingGames: conflictingAssignedGamesForGame(o.id, game, pos.id),
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
  function lastAssignmentTime(officialId: string) {
    if (!game) return 0;
    const currentGameTime = new Date(game.starts_at).getTime();
    return assignments.reduce((latest, assignment) => {
      if (
        assignment.official_id !== officialId ||
        assignment.status === "declined"
      )
        return latest;
      const assignedGame = games.find((item) => item.id === assignment.game_id);
      if (!assignedGame) return latest;
      const time = new Date(assignedGame.starts_at).getTime();
      return time < currentGameTime ? Math.max(latest, time) : latest;
    }, 0);
  }
  function sortOfficials<
    T extends Official & { rank: number; distance: number | null },
  >(items: T[], sort: typeof officialListSort) {
    return [...items].sort((a, b) => {
      if (sort === "distance")
        return (a.distance ?? 9999) - (b.distance ?? 9999) || b.rank - a.rank;
      if (sort === "rank")
        return b.rank - a.rank || (a.distance ?? 9999) - (b.distance ?? 9999);
      if (sort === "leastRecent")
        return (
          lastAssignmentTime(a.id) - lastAssignmentTime(b.id) || b.rank - a.rank
        );
      if (sort === "name")
        return `${a.last_name} ${a.first_name}`.localeCompare(
          `${b.last_name} ${b.first_name}`,
        );
      return b.rank - a.rank || (a.distance ?? 9999) - (b.distance ?? 9999);
    });
  }
  const availableOfficialsBase = game
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
  const availableOfficials = sortOfficials(
    availableOfficialsBase.filter((official) =>
      `${official.first_name} ${official.last_name}`
        .toLowerCase()
        .includes(officialListSearch.trim().toLowerCase()),
    ),
    officialListSort,
  );
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
  function openPositionsForGame(targetGame: Game) {
    return positions
      .filter((position) => position.sport_id === targetGame.sport_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, targetGame.officials_needed))
      .filter(
        (position) =>
          !assignments.some(
            (assignment) =>
              assignment.game_id === targetGame.id &&
              assignment.position_id === position.id &&
              assignmentOccupiesPosition(assignment.status),
          ),
      );
  }
  function openPositionForGame(targetGame: Game) {
    return openPositionsForGame(targetGame)[0];
  }
  async function assignToGame(
    targetGame: Game,
    positionId: string,
    officialId: string,
    assignmentReviewed = false,
  ) {
    const official = officials.find((o) => o.id === officialId);
    const conflictReasons = official
      ? [
          ...assignmentConflictReasonsForGame(official, targetGame, positionId),
          ...duplicateAssignmentReasonsForGame(
            official.id,
            targetGame,
            positionId,
          ),
        ]
      : [];
    if (officialId && official && conflictReasons.length) {
      setError(
        `${official.first_name} ${official.last_name} cannot be assigned: ${conflictReasons.join("; ")}.`,
      );
      return false;
    }
    const reasons = official
      ? ineligibleReasonsForGame(official, targetGame, positionId).filter(
          (r) => {
            if (r !== "Already assigned to this game") return true;
            return !assignments.some(
              (assignment) =>
                assignment.game_id === targetGame.id &&
                assignment.position_id === positionId &&
                assignment.official_id === official.id &&
                assignment.status !== "declined",
            );
          },
        )
      : [];
    if (officialId && reasons.length) {
      if (!canManage) {
        setError("This official is not eligible for this game.");
        return false;
      }
      if (
        !assignmentReviewed &&
        !window.confirm(
          `Override eligibility and assign ${official?.first_name} ${official?.last_name}?\n\nWarning: ${reasons.join(", ")}`,
        )
      )
        return false;
    }
    setSaving(positionId);
    setError("");
    setNotice("");
    const existing = assignments.find(
      (a) => a.game_id === targetGame.id && a.position_id === positionId,
    );
    let result;
    if (!officialId && existing)
      result = await supabase
        .from("assignments")
        .delete()
        .eq("id", existing.id);
    else if (officialId)
      result = await supabase.rpc("assign_official_to_linked_games", {
        p_game_id: targetGame.id,
        p_position_id: positionId,
        p_official_id: officialId,
      });
    if (!result) {
      setSaving("");
      return false;
    }
    if (result.error) setError(result.error.message);
    else if (officialId) {
      const linkedCount = Number(result.data || 1);
      const position = positions.find((item) => item.id === positionId);
      setNotice(
        `${official?.first_name} ${official?.last_name} assigned to ${position ? shortPositionName(position.name) : "the position"}${linkedCount > 1 ? ` across ${linkedCount} linked games` : ` on Game #${targetGame.game_number}`}${reasons.length ? " with an eligibility override" : ""}.`,
      );
      announceUndoAvailable(
        `${official?.first_name || "Official"} ${official?.last_name || ""} assigned to ${position ? shortPositionName(position.name) : "the position"} on Game #${targetGame.game_number}.`.replace(
          /\s+/g,
          " ",
        ),
      );
    } else {
      const removedAssignment = existing;
      const removedOfficial = officials.find(
        (official) => official.id === removedAssignment?.official_id,
      );
      const removedPosition = positions.find(
        (position) => position.id === positionId,
      );
      announceUndoAvailable(
        `${removedOfficial ? `${removedOfficial.first_name} ${removedOfficial.last_name}` : "Official"} unassigned from ${removedPosition ? shortPositionName(removedPosition.name) : "the position"}.`,
      );
    }
    await refreshAssignmentState();
    setSaving("");
    setOverrideOfficial("");
    return !result.error;
  }
  async function assign(positionId: string, officialId: string) {
    if (!game) return;
    await assignToGame(game, positionId, officialId);
  }
  function nextOpenPositionAfter(positionId: string) {
    if (!game) return undefined;
    const currentIndex = gamePositions.findIndex(
      (item) => item.id === positionId,
    );
    const ordered = [
      ...gamePositions.slice(currentIndex + 1),
      ...gamePositions.slice(0, Math.max(0, currentIndex)),
    ];
    return ordered.find(
      (position) =>
        !assignments.some(
          (assignment) =>
            assignment.game_id === game.id &&
            assignment.position_id === position.id &&
            assignmentOccupiesPosition(assignment.status),
        ),
    );
  }
  function openConflictingGame(targetGameId: string) {
    setCandidatePositionId("");
    setRange("all");
    setCustomDate("");
    setUnpublishedOnly(false);
    setSelfAssignOnly(false);
    setCompletenessFilter("all");
    setOfficialFilter("");
    setLocationFilter("");
    setLeagueFilter("");
    setLevelFilter("");
    setSelected(targetGameId);
    window.setTimeout(
      () =>
        document
          .getElementById("selected-game-assignment")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  }
  async function assignFromCandidate(positionId: string, officialId: string) {
    if (!game) return;
    const nextPosition = nextOpenPositionAfter(positionId);
    const assigned = await assignToGame(game, positionId, officialId);
    if (assigned) {
      setCandidateSearch("");
      setCandidatePositionId(nextPosition?.id || positionId);
    }
  }
  async function dropOfficialOnGame(gameId: string, officialId: string) {
    const targetGame = games.find((listedGame) => listedGame.id === gameId);
    if (!targetGame || !officialId || !canManage) return;
    const openPositions = openPositionsForGame(targetGame);
    setOfficialDropGame("");
    setDraggingOfficial("");
    if (!openPositions.length) {
      setError(
        `Game #${targetGame.game_number} has no open assignment positions.`,
      );
      return;
    }
    setSelected(targetGame.id);
    setPendingTapAssignment({
      gameId: targetGame.id,
      officialId,
      positionId: openPositions[0].id,
    });
  }
  async function confirmTapAssignment() {
    if (!pendingTapAssignment) return;
    const targetGame = games.find(
      (item) => item.id === pendingTapAssignment.gameId,
    );
    if (!targetGame) return;
    const assigned = await assignToGame(
      targetGame,
      pendingTapAssignment.positionId,
      pendingTapAssignment.officialId,
      true,
    );
    if (assigned) {
      setPendingTapAssignment(null);
      setPickedOfficial("");
    }
  }
  function prepareBulkAssignment() {
    const selectedGames = games.filter((item) =>
      linkSelected.includes(item.id),
    );
    const assignableGames = selectedGames.filter(gameAcceptsAssignments);
    const excludedGames = selectedGames.filter(
      (item) => !gameAcceptsAssignments(item),
    );
    setBulkAssignOfficial("");
    setBulkAssignPositions(
      Object.fromEntries(
        assignableGames.map((item) => [
          item.id,
          openPositionForGame(item)?.id || "",
        ]),
      ),
    );
    setBulkAssignMessage(
      excludedGames.length
        ? `${excludedGames.length} inactive game${excludedGames.length === 1 ? " was" : "s were"} excluded from bulk assignment: ${excludedGames.map((item) => `Game #${item.game_number} (${inactiveGameStatusLabel(item.status)})`).join(", ")}.`
        : "",
    );
    setBulkOfficialSearch("");
    setBulkOfficialStatus("eligible");
    setShowBulkAssign(true);
  }
  function bulkAssignmentReview(officialId = bulkAssignOfficial) {
    const official = officials.find((item) => item.id === officialId);
    const targets = games.filter(
      (item) =>
        gameAcceptsAssignments(item) &&
        linkSelected.includes(item.id) &&
        bulkAssignPositions[item.id],
    );
    const blocking: { gameId: string; reason: string }[] = [];
    const warnings: { gameId: string; reason: string }[] = [];
    if (!official) return { targets, blocking, warnings };
    for (const target of targets) {
      const positionId = bulkAssignPositions[target.id];
      for (const reason of [
        ...assignmentConflictReasonsForGame(official, target, positionId),
        ...duplicateAssignmentReasonsForGame(official.id, target, positionId),
      ])
        blocking.push({ gameId: target.id, reason });
      for (const reason of ineligibleReasonsForGame(
        official,
        target,
        positionId,
      )) {
        if (reason !== "Already assigned to this game")
          warnings.push({ gameId: target.id, reason });
      }
      const position = positions.find((item) => item.id === positionId);
      if (
        position &&
        isMentor(position) &&
        positionRanks[official.id]?.mentor_certified !== true
      )
        blocking.push({
          gameId: target.id,
          reason: "Mentor certification required",
        });
    }
    for (let index = 0; index < targets.length; index += 1) {
      for (
        let otherIndex = index + 1;
        otherIndex < targets.length;
        otherIndex += 1
      ) {
        const first = targets[index],
          second = targets[otherIndex];
        if (
          overlaps(
            first.starts_at,
            first.duration_minutes || 110,
            second.starts_at,
            second.duration_minutes || 110,
          )
        ) {
          blocking.push({
            gameId: second.id,
            reason: `Overlaps selected Game #${first.game_number}`,
          });
        }
      }
    }
    return {
      targets,
      blocking: [
        ...new Map(
          blocking.map((item) => [`${item.gameId}:${item.reason}`, item]),
        ).values(),
      ],
      warnings: [
        ...new Map(
          warnings.map((item) => [`${item.gameId}:${item.reason}`, item]),
        ).values(),
      ],
    };
  }
  async function confirmBulkAssignment() {
    const review = bulkAssignmentReview();
    if (!bulkAssignOfficial) {
      setBulkAssignMessage("Choose an official before assigning the games.");
      return;
    }
    if (!review.targets.length) {
      setBulkAssignMessage(
        "None of the selected games has an open position to assign.",
      );
      return;
    }
    if (review.blocking.length) {
      setBulkAssignMessage(
        "This official cannot be assigned until the conflicts shown below are resolved.",
      );
      return;
    }
    setBulkWorking(true);
    setBulkAssignMessage(`Assigning 0 of ${review.targets.length} games…`);
    const selectedOfficial = officials.find(
      (item) => item.id === bulkAssignOfficial,
    );
    const results: BulkAssignmentItem[] = [];
    let assigned = 0;
    try {
      for (const target of review.targets) {
        const positionId = bulkAssignPositions[target.id];
        const position = positions.find((item) => item.id === positionId);
        if (!gameAcceptsAssignments(target)) {
          results.push({
            gameId: target.id,
            gameNumber: target.game_number,
            matchup: `${target.home?.name || "TBD"} vs ${target.away?.name || "TBD"}`,
            positionId,
            positionName: position?.name || "Position",
            officialId: bulkAssignOfficial,
            officialName: selectedOfficial
              ? `${selectedOfficial.first_name} ${selectedOfficial.last_name}`
              : "Selected official",
            status: "skipped",
            error: `${inactiveGameStatusLabel(target.status)} games cannot receive assignments.`,
          });
          continue;
        }
        const result = await supabase.rpc("assign_official_to_linked_games", {
          p_game_id: target.id,
          p_position_id: positionId,
          p_official_id: bulkAssignOfficial,
        });
        const item: BulkAssignmentItem = {
          gameId: target.id,
          gameNumber: target.game_number,
          matchup: `${target.home?.name || "TBD"} vs ${target.away?.name || "TBD"}`,
          positionId,
          positionName: position?.name || "Position",
          officialId: bulkAssignOfficial,
          officialName: selectedOfficial
            ? `${selectedOfficial.first_name} ${selectedOfficial.last_name}`
            : "Selected official",
          status: result.error ? "failed" : "success",
          error: result.error?.message || "",
        };
        results.push(item);
        if (!result.error) assigned += 1;
        setBulkAssignMessage(
          `Processed ${results.length} of ${review.targets.length} games…`,
        );
      }
      await refreshAssignmentState();
      setShowBulkAssign(false);
      if (assigned === review.targets.length) setLinkSelected([]);
      setBulkAssignmentResult({
        officialId: bulkAssignOfficial,
        officialName: selectedOfficial
          ? `${selectedOfficial.first_name} ${selectedOfficial.last_name}`
          : "Selected official",
        items: results,
      });
      setNotice(
        `${assigned} of ${review.targets.length} selected game${review.targets.length === 1 ? "" : "s"} assigned successfully.`,
      );
    } catch (assignmentError) {
      const message =
        assignmentError instanceof Error
          ? assignmentError.message
          : "Unexpected assignment error";
      const completedIds = new Set(results.map((item) => item.gameId));
      const remaining = review.targets
        .filter((item) => !completedIds.has(item.id))
        .map((target) => {
          const positionId = bulkAssignPositions[target.id];
          return {
            gameId: target.id,
            gameNumber: target.game_number,
            matchup: `${target.home?.name || "TBD"} vs ${target.away?.name || "TBD"}`,
            positionId,
            positionName:
              positions.find((item) => item.id === positionId)?.name ||
              "Position",
            officialId: bulkAssignOfficial,
            officialName: selectedOfficial
              ? `${selectedOfficial.first_name} ${selectedOfficial.last_name}`
              : "Selected official",
            status: "skipped" as const,
            error: message,
          };
        });
      setShowBulkAssign(false);
      setBulkAssignmentResult({
        officialId: bulkAssignOfficial,
        officialName: selectedOfficial
          ? `${selectedOfficial.first_name} ${selectedOfficial.last_name}`
          : "Selected official",
        items: [...results, ...remaining],
      });
    } finally {
      setBulkWorking(false);
    }
  }
  async function retryBulkAssignmentItem(item: BulkAssignmentItem) {
    if (!bulkAssignmentResult || bulkRetryingGame) return;
    const target = games.find((game) => game.id === item.gameId);
    if (!target || !gameAcceptsAssignments(target)) {
      setBulkAssignmentResult((current) =>
        current
          ? {
              ...current,
              items: current.items.map((listedItem) =>
                listedItem.gameId === item.gameId
                  ? {
                      ...listedItem,
                      status: "skipped",
                      error: `${inactiveGameStatusLabel(target?.status || "")} games cannot receive assignments.`,
                    }
                  : listedItem,
              ),
            }
          : current,
      );
      return;
    }
    setBulkRetryingGame(item.gameId);
    const result = await supabase.rpc("assign_official_to_linked_games", {
      p_game_id: item.gameId,
      p_position_id: item.positionId,
      p_official_id: item.officialId || bulkAssignmentResult.officialId,
    });
    setBulkAssignmentResult((current) =>
      current
        ? {
            ...current,
            items: current.items.map((listedItem) =>
              listedItem.gameId === item.gameId
                ? {
                    ...listedItem,
                    status: result.error ? "failed" : "success",
                    error: result.error?.message || "",
                  }
                : listedItem,
            ),
          }
        : current,
    );
    if (!result.error) await refreshAssignmentState();
    setBulkRetryingGame("");
  }
  function crewSlotKey(gameId: string, positionId: string) {
    return `${gameId}:${positionId}`;
  }
  function bulkCrewSlots() {
    return games
      .filter(
        (item) =>
          gameAcceptsAssignments(item) && linkSelected.includes(item.id),
      )
      .flatMap((target) =>
        openPositionsForGame(target).map((position) => ({
          target,
          position,
          key: crewSlotKey(target.id, position.id),
        })),
      );
  }
  function crewCandidatesForSlot(
    target: Game,
    position: Position,
    selections = bulkCrewSelections,
  ) {
    const key = crewSlotKey(target.id, position.id);
    return officials
      .map((official) => {
        const blocking = [
          ...assignmentConflictReasonsForGame(official, target, position.id),
          ...duplicateAssignmentReasonsForGame(
            official.id,
            target,
            position.id,
          ),
        ];
        const warnings = ineligibleReasonsForGame(
          official,
          target,
          position.id,
        ).filter(
          (reason) =>
            !blocking.includes(reason) &&
            reason !== "Already assigned to this game",
        );
        if (isMentor(position) && positionRanks[official.id]?.mentor_certified !== true)
          blocking.push("Mentor certification required");
        for (const [otherKey, otherOfficialId] of Object.entries(selections)) {
          if (otherKey === key || otherOfficialId !== official.id) continue;
          const [otherGameId] = otherKey.split(":");
          const otherGame = games.find((item) => item.id === otherGameId);
          if (!otherGame) continue;
          if (otherGame.id === target.id)
            blocking.push("Already selected for another position on this game");
          else if (
            overlaps(
              target.starts_at,
              target.duration_minutes || 110,
              otherGame.starts_at,
              otherGame.duration_minutes || 110,
            )
          )
            blocking.push(`Overlaps selected Game #${otherGame.game_number}`);
        }
        const distance = miles(
          official.home_latitude,
          official.home_longitude,
          target.location?.latitude ?? null,
          target.location?.longitude ?? null,
        );
        const workload = assignments.filter(
          (assignment) =>
            assignment.official_id === official.id &&
            assignment.status !== "declined",
        ).length;
        const rank = positionRankFor(official.id, position);
        const score = rank * 100 - (distance ?? 100) - workload * 8;
        return {
          official,
          blocking: [...new Set(blocking)],
          warnings: [...new Set(warnings)],
          distance,
          workload,
          rank,
          score,
        };
      })
      .sort(
        (a, b) =>
          (a.blocking.length ? 1 : 0) - (b.blocking.length ? 1 : 0) ||
          (a.warnings.length ? 1 : 0) - (b.warnings.length ? 1 : 0) ||
          b.score - a.score ||
          a.official.last_name.localeCompare(b.official.last_name),
      );
  }
  function prepareBulkCrew() {
    const excludedGames = games.filter(
      (item) => linkSelected.includes(item.id) && !gameAcceptsAssignments(item),
    );
    setBulkCrewSelections({});
    setBulkCrewMessage(
      excludedGames.length
        ? `${excludedGames.length} inactive game${excludedGames.length === 1 ? " was" : "s were"} excluded from crew assignment: ${excludedGames.map((item) => `Game #${item.game_number} (${inactiveGameStatusLabel(item.status)})`).join(", ")}.`
        : "",
    );
    setBulkCrewOverrideConfirmed(false);
    setShowBulkCrew(true);
  }
  function applySmartCrewRecommendations() {
    const next: Record<string, string> = {};
    for (const slot of bulkCrewSlots()) {
      const recommended = crewCandidatesForSlot(
        slot.target,
        slot.position,
        next,
      ).find(
        (candidate) => !candidate.blocking.length && !candidate.warnings.length,
      );
      if (recommended) next[slot.key] = recommended.official.id;
    }
    setBulkCrewSelections(next);
    setBulkCrewOverrideConfirmed(false);
    setBulkCrewMessage(
      `${Object.keys(next).length} of ${bulkCrewSlots().length} open positions filled with recommendations.`,
    );
  }
  async function confirmBulkCrewAssignment() {
    const slots = bulkCrewSlots().filter(
      (slot) => bulkCrewSelections[slot.key],
    );
    if (!slots.length) {
      setBulkCrewMessage(
        "Choose at least one official or use Smart Fill first.",
      );
      return;
    }
    const reviews = slots.map((slot) => ({
      ...slot,
      candidate: crewCandidatesForSlot(slot.target, slot.position).find(
        (item) => item.official.id === bulkCrewSelections[slot.key],
      ),
    }));
    if (reviews.some((review) => review.candidate?.blocking.length)) {
      setBulkCrewMessage(
        "Resolve the highlighted conflicts before assigning this crew.",
      );
      return;
    }
    if (
      reviews.some((review) => review.candidate?.warnings.length) &&
      !bulkCrewOverrideConfirmed
    ) {
      setBulkCrewMessage(
        "Confirm the eligibility overrides before assigning this crew.",
      );
      return;
    }
    setBulkCrewWorking(true);
    setBulkCrewMessage(`Assigning 0 of ${reviews.length} positions…`);
    const results: BulkAssignmentItem[] = [];
    try {
      for (const review of reviews) {
        const officialId = bulkCrewSelections[review.key];
        const official = officials.find((item) => item.id === officialId);
        if (!gameAcceptsAssignments(review.target)) {
          results.push({
            gameId: review.target.id,
            gameNumber: review.target.game_number,
            matchup: `${review.target.home?.name || "TBD"} vs ${review.target.away?.name || "TBD"}`,
            positionId: review.position.id,
            positionName: review.position.name,
            officialId,
            officialName: official
              ? `${official.first_name} ${official.last_name}`
              : "Selected official",
            status: "skipped",
            error: `${inactiveGameStatusLabel(review.target.status)} games cannot receive assignments.`,
          });
          continue;
        }
        const result = await supabase.rpc("assign_official_to_linked_games", {
          p_game_id: review.target.id,
          p_position_id: review.position.id,
          p_official_id: officialId,
        });
        results.push({
          gameId: review.target.id,
          gameNumber: review.target.game_number,
          matchup: `${review.target.home?.name || "TBD"} vs ${review.target.away?.name || "TBD"}`,
          positionId: review.position.id,
          positionName: review.position.name,
          officialId,
          officialName: official
            ? `${official.first_name} ${official.last_name}`
            : "Selected official",
          status: result.error ? "failed" : "success",
          error: result.error?.message || "",
        });
        setBulkCrewMessage(
          `Processed ${results.length} of ${reviews.length} positions…`,
        );
      }
      await refreshAssignmentState();
      setShowBulkCrew(false);
      setBulkAssignmentResult({
        officialId: "",
        officialName: "Crew assignment",
        items: results,
      });
      if (results.every((item) => item.status === "success"))
        setLinkSelected([]);
    } catch (crewError) {
      setBulkCrewMessage(
        crewError instanceof Error
          ? crewError.message
          : "Unable to complete crew assignment.",
      );
    } finally {
      setBulkCrewWorking(false);
    }
  }
  function crewTemplateTargetGames() {
    const requested = linkSelected.length
      ? games.filter((item) => linkSelected.includes(item.id))
      : game
        ? [game]
        : [];
    const seen = new Set<string>();
    return requested.filter((target) => {
      const unitKey = linkGroupByGame.get(target.id) || target.id;
      if (seen.has(unitKey)) return false;
      seen.add(unitKey);
      return true;
    });
  }
  function availableCrewTemplates() {
    const target = crewTemplateTargetGames()[0];
    if (!target) return [];
    return assignmentTemplates.filter(
      (template) =>
        template.sport_id === target.sport_id &&
        (!template.league_id || template.league_id === target.league_id),
    );
  }
  function previousCrewGames() {
    const target = crewTemplateTargetGames()[0];
    if (!target) return [];
    const targetIds = new Set(linkSelected.length ? linkSelected : [target.id]);
    return games
      .filter(
        (listedGame) =>
          listedGame.sport_id === target.sport_id &&
          !targetIds.has(listedGame.id) &&
          assignments.some(
            (assignment) =>
              assignment.game_id === listedGame.id &&
              !["declined", "cancelled", "canceled"].includes(
                assignment.status,
              ),
          ),
      )
      .sort(
        (a, b) =>
          Math.abs(
            new Date(a.starts_at).getTime() -
              new Date(target.starts_at).getTime(),
          ) -
          Math.abs(
            new Date(b.starts_at).getTime() -
              new Date(target.starts_at).getTime(),
          ),
      )
      .slice(0, 40);
  }
  function openCrewTemplateTools() {
    const target = crewTemplateTargetGames()[0];
    if (!target) return;
    setCrewTemplateName(
      `${target.leagues?.name || target.sports?.name || "Saved"} Crew`,
    );
    setCopyCrewSourceGameId(previousCrewGames()[0]?.id || "");
    setCrewTemplateMessage("");
    setShowCrewTemplates(true);
  }
  async function refreshCrewTemplates() {
    const { data, error: templateError } = await supabase
      .from("assignment_templates")
      .select(
        "id,name,sport_id,league_id,created_by,updated_at,organization_id,assignment_template_slots(id,position_id,official_id,sort_order)",
      )
      .eq("organization_id", organizationId || "")
      .order("updated_at", { ascending: false });
    if (templateError) throw templateError;
    setAssignmentTemplates((data || []) as AssignmentTemplate[]);
  }
  async function saveCurrentCrewTemplate() {
    const source = crewTemplateTargetGames()[0];
    if (!source || !crewTemplateName.trim()) {
      setCrewTemplateMessage("Enter a template name first.");
      return;
    }
    const sourceAssignments = assignments.filter(
      (assignment) =>
        assignment.game_id === source.id &&
        !["declined", "cancelled", "canceled"].includes(assignment.status),
    );
    if (!sourceAssignments.length) {
      setCrewTemplateMessage(
        "Assign at least one official before saving this crew.",
      );
      return;
    }
    setCrewTemplateWorking(true);
    setCrewTemplateMessage("Saving crew template…");
    const { data: userData } = await supabase.auth.getUser();
    const { data: template, error: templateError } = await supabase
      .from("assignment_templates")
      .insert({
        name: crewTemplateName.trim(),
        sport_id: source.sport_id,
        league_id: source.league_id,
        created_by: userData.user?.id,
        organ…39236 tokens truncated…                  >
                                  Delete
                                </button>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="crewTemplateEmpty">
                            No saved crews match this game yet. Save the current
                            crew to create the first one.
                          </div>
                        )}
                      </section>
                      {crewTemplateMessage && (
                        <div className="crewTemplateMessage" role="status">
                          {crewTemplateMessage}
                        </div>
                      )}
                    </div>
                    <div className="assignmentDialogFooter">
                      <button
                        type="button"
                        className="secondary"
                        disabled={crewTemplateWorking}
                        onClick={() => setShowCrewTemplates(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          {showSelfAssignDialog && (
            <div
              className="assignmentDialogBackdrop"
              role="presentation"
              onMouseDown={() =>
                !selfAssignSaving && setShowSelfAssignDialog(false)
              }
            >
              <div
                className="assignmentDialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="selfAssignDialogTitle"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="assignmentDialogHead">
                  <div>
                    <h3 id="selfAssignDialogTitle">
                      Open Positions for Self Assign
                    </h3>
                    <p>Select the positions officials may claim.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    disabled={selfAssignSaving}
                    onClick={() => setShowSelfAssignDialog(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="selfAssignDialogActions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const gameIds = linkSelected.length
                        ? linkSelected
                        : game
                          ? [game.id]
                          : [];
                      setSelfAssignSelected(
                        selfAssignOptionsForGames(gameIds).map(
                          (option) => option.key,
                        ),
                      );
                    }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelfAssignSelected([])}
                  >
                    Clear All
                  </button>
                </div>
                <div className="selfAssignPositionList">
                  {selfAssignOptionsForGames(
                    linkSelected.length ? linkSelected : game ? [game.id] : [],
                  ).map((option) => (
                    <label key={option.key}>
                      <input
                        type="checkbox"
                        checked={selfAssignSelected.includes(option.key)}
                        disabled={selfAssignSaving}
                        onChange={() =>
                          toggleSelfAssignSelection(
                            option.gameId,
                            option.positionId,
                          )
                        }
                      />
                      <span>
                        <b>{option.positionName}</b>
                        <small>
                          Game #{option.game.game_number} —{" "}
                          {option.game.home?.name || "TBD"} vs{" "}
                          {option.game.away?.name || "TBD"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="assignmentDialogFooter">
                  <button
                    type="button"
                    className="secondary"
                    disabled={selfAssignSaving}
                    onClick={() => setShowSelfAssignDialog(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="success"
                    disabled={selfAssignSaving || !selfAssignSelected.length}
                    onClick={() => void openSelfAssignPositions()}
                  >
                    {selfAssignSaving
                      ? "Opening…"
                      : `Open ${selfAssignSelected.length} Position${selfAssignSelected.length === 1 ? "" : "s"}`}
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
                    {officials.find(
                      (official) => official.id === overdueGroup[0],
                    )?.first_name || "This official"}{" "}
                    {officials.find(
                      (official) => official.id === overdueGroup[0],
                    )?.last_name || ""}{" "}
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
                  style={{ backgroundColor: "#b91c1c", borderColor: "#b91c1c", color: "#ffffff" }}
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
            <section
              className="assignmentAttentionQueue"
              aria-labelledby="attentionQueueTitle"
            >
              <div>
                <h3 id="attentionQueueTitle">Needs Attention</h3>
                <p>Open the work that should be handled next.</p>
              </div>
              <button
                type="button"
                className={replacementOnly ? "selected" : ""}
                aria-pressed={replacementOnly}
                onClick={() => {
                  setReplacementOnly(true);
                  setCompletenessFilter("all");
                  setUnpublishedOnly(false);
                  setSelfAssignOnly(false);
                  setOverrideOfficial("");
                  setSelected("");
                  setLinkSelected([]);
                }}
              >
                <b>{attentionQueue.replacements}</b>
                <span>Replacement needed</span>
              </button>
              <button
                type="button"
                className={
                  !replacementOnly && completenessFilter === "unassigned"
                    ? "selected"
                    : ""
                }
                aria-pressed={
                  !replacementOnly && completenessFilter === "unassigned"
                }
                onClick={() => chooseCompleteness("unassigned")}
              >
                <b>{attentionQueue.unassigned}</b>
                <span>Unassigned games</span>
              </button>
              <button
                type="button"
                className={
                  !replacementOnly && completenessFilter === "awaiting"
                    ? "selected"
                    : ""
                }
                aria-pressed={
                  !replacementOnly && completenessFilter === "awaiting"
                }
                onClick={() => chooseCompleteness("awaiting")}
              >
                <b>{attentionQueue.awaiting}</b>
                <span>Awaiting response</span>
              </button>
              <button
                type="button"
                className={unpublishedOnly ? "selected" : ""}
                aria-pressed={unpublishedOnly}
                onClick={() => {
                  setUnpublishedOnly(true);
                  setReplacementOnly(false);
                  setCompletenessFilter("all");
                  setSelected("");
                }}
              >
                <b>{attentionQueue.unpublished}</b>
                <span>Not published</span>
              </button>
            </section>
          )}
          <div className="assignmentFilterPanel assignmentCompactToolbar">
            <label className="assignmentToolbarField">
              <span>View</span>
              <select
                aria-label="Game view"
                value={selfAssignOnly ? "selfAssign" : "all"}
                onChange={(event) => {
                  const next = event.target.value === "selfAssign";
                  setSelfAssignOnly(next);
                  setLinkSelected([]);
                  setSelected("");
                }}
              >
                <option value="all">All Games</option>
                <option value="selfAssign">
                  Open for Self Assign ({selfAssignGameCount})
                </option>
              </select>
            </label>
            <label className="assignmentToolbarField">
              <span>Date</span>
              <select
                aria-label="Date range"
                value={range}
                onChange={(event) => {
                  const next = event.target.value as Range;
                  if (next === "custom") {
                    setRange("custom");
                    setShowCalendar(true);
                  } else chooseRange(next);
                }}
              >
                {filters.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label} (
                    {
                      games.filter(
                        (g) =>
                          inRange(g, key, customDate) &&
                          matchesOfficialFilter(g),
                      ).length
                    }
                    )
                  </option>
                ))}
                <option value="custom">Choose a Date</option>
              </select>
            </label>
            {canManage && (
              <label className="assignmentToolbarField assignmentSavedViewField">
                <span>Saved View</span>
                <select
                  aria-label="Open a saved view"
                  defaultValue=""
                  onChange={(event) => {
                    const view = savedViews.find(
                      (item) => item.id === event.target.value,
                    );
                    if (view) applySavedView(view);
                    event.target.value = "";
                  }}
                >
                  <option value="">
                    {savedViews.length
                      ? "Choose a saved view"
                      : "No saved views yet"}
                  </option>
                  {savedViews.map((view) => (
                    <option value={view.id} key={view.id}>
                      {view.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {canManage && (
              <button
                type="button"
                className="secondary assignmentToolbarButton"
                onClick={saveCurrentView}
              >
                + Save View
              </button>
            )}
            {canManage && (
              <details className="assignmentMoreFilters">
                <summary>More Filters</summary>
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
                            .map((listedGame) => [
                              listedGame.location!.id,
                              listedGame.location!.name,
                            ]),
                        ).entries(),
                      )
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    League
                    <select
                      aria-label="Show games in league"
                      value={leagueFilter}
                      onChange={(event) => {
                        setLeagueFilter(event.target.value);
                        setLinkSelected([]);
                        setSelected("");
                      }}
                    >
                      <option value="">All Leagues</option>
                      {Array.from(
                        new Map(
                          games
                            .filter(
                              (listedGame) =>
                                listedGame.league_id &&
                                listedGame.leagues?.name,
                            )
                            .map((listedGame) => [
                              listedGame.league_id!,
                              listedGame.leagues!.name,
                            ]),
                        ).entries(),
                      )
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Level
                    <select
                      aria-label="Show games at level"
                      value={levelFilter}
                      onChange={(event) => {
                        setLevelFilter(event.target.value);
                        setLinkSelected([]);
                        setSelected("");
                      }}
                    >
                      <option value="">All Levels</option>
                      {Array.from(
                        new Map(
                          games
                            .filter(
                              (listedGame) =>
                                listedGame.level_id && listedGame.levels?.name,
                            )
                            .map((listedGame) => [
                              listedGame.level_id!,
                              listedGame.levels!.name,
                            ]),
                        ).entries(),
                      )
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
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
                        .filter((official) =>
                          assignments.some(
                            (assignment) =>
                              assignment.official_id === official.id &&
                              assignment.status !== "declined",
                          ),
                        )
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
                      <option value="all">
                        All Assignment Statuses ({rangeGames.length})
                      </option>
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
                    Show not published only (
                    {rangeGames.filter(isUnpublishedGame).length})
                  </label>
                  {hasDirectGameFilter && (
                    <span>
                      Showing matching games across all dates and assignment
                      statuses.
                    </span>
                  )}
                  {savedViews.length > 0 && (
                    <div className="assignmentManageSavedViews">
                      <b>Manage Saved Views</b>
                      <div>
                        {savedViews.map((view) => (
                          <button
                            type="button"
                            key={view.id}
                            onClick={() => deleteSavedView(view.id)}
                          >
                            Delete {view.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}
            {showCalendar && (
              <div className="assignmentCustomDateRow">
                <label className="assignmentToolbarField">
                  <span>Specific Date</span>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(event) => chooseDate(event.target.value)}
                  />
                </label>
                {customDate && (
                  <span className="assignmentCustomDateResult">
                    {new Date(`${customDate}T00:00:00`).toLocaleDateString()} ·{" "}
                    {filteredGames.length} games
                  </span>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowCalendar(false)}
                >
                  Done
                </button>
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
                    {assignmentSelectionTarget.officials_needed} positions •{" "}
                    {
                      assignments.filter(
                        (item) =>
                          item.game_id === assignmentSelectionTarget.id &&
                          item.status !== "declined",
                      ).length
                    }{" "}
                    assigned •{" "}
                    {Math.max(
                      0,
                      assignmentSelectionTarget.officials_needed -
                        assignments.filter(
                          (item) =>
                            item.game_id === assignmentSelectionTarget.id &&
                            item.status !== "declined",
                        ).length,
                    )}{" "}
                    open
                  </span>
                )}
              </div>
              <button
                className="primary"
                disabled={bulkWorking}
                onClick={prepareBulkAssignment}
              >
                Assign Official
              </button>
              <button
                className="primary assignmentCrewButton"
                disabled={bulkWorking}
                onClick={prepareBulkCrew}
              >
                Assign Crews
              </button>
              <button
                className="secondary assignmentTemplateButton"
                disabled={bulkWorking}
                onClick={openCrewTemplateTools}
              >
                Crew Templates
              </button>
              <button
                className="success"
                disabled={bulkWorking || selfAssignSaving}
                onClick={prepareSelfAssignPositions}
              >
                Open Positions for Self Assign
              </button>
              {!linkSelected.some(
                (gameId) => games.find((item) => item.id === gameId)?.time_tbd,
              ) && (
                <button
                  className="secondary"
                  disabled={bulkWorking}
                  onClick={() => void runBulkAction("publish")}
                >
                  Publish
                </button>
              )}
              <button
                className="primary assignmentBroadcastButton"
                disabled={bulkWorking || broadcasting || !broadcastOpenPositions.length}
                onClick={() => setShowBroadcastReview(true)}
              >
                Broadcast
              </button>
              <button
                className="secondary"
                disabled={bulkWorking}
                onClick={() => void runBulkAction("confirm")}
              >
                Confirm Officials
              </button>
              <details className="assignmentMoreActions">
                <summary>More Actions</summary>
                <div>
                  <button
                    className="secondary"
                    disabled={bulkWorking}
                    onClick={() => void runBulkAction("unassign")}
                  >
                    Unassign Officials
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      bulkWorking ||
                      !selfAssignSlots.some((slot) =>
                        linkSelected.includes(slot.game_id),
                      )
                    }
                    onClick={() => void runBulkAction("closeSelfAssign")}
                  >
                    Close Self Assign
                  </button>
                  <label>
                    Game Status
                    <select
                      aria-label="Bulk game status"
                      value={bulkStatus}
                      disabled={bulkWorking}
                      onChange={(e) => setBulkStatus(e.target.value)}
                    >
                      {gameStatusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary"
                    disabled={bulkWorking}
                    onClick={() => void runBulkAction("status")}
                  >
                    Apply Status
                  </button>
                  <button
                    className="secondary"
                    disabled={linking || bulkWorking || linkSelected.length < 2}
                    onClick={() => void linkGames()}
                  >
                    Link Selected Games
                  </button>
                  <button
                    className="secondary"
                    disabled={bulkWorking}
                    onClick={() => void exportAssignments(linkSelected)}
                  >
                    Export Selected
                  </button>
                </div>
              </details>
              <button
                className="assignmentClearSelection"
                disabled={bulkWorking}
                onClick={() => setLinkSelected([])}
              >
                Clear selection
              </button>
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
            {pickedOfficial && (
              <div className="assignmentPickedOfficial" role="status">
                <span>
                  Assigning{" "}
                  <b>
                    {
                      officials.find(
                        (official) => official.id === pickedOfficial,
                      )?.first_name
                    }{" "}
                    {
                      officials.find(
                        (official) => official.id === pickedOfficial,
                      )?.last_name
                    }
                  </b>
                  <small>
                    Click any game name below to fill its next open position.
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPickedOfficial("")}
                >
                  Cancel
                </button>
              </div>
            )}
            {showBroadcastReview && (
            <div
              className="assignmentDialogBackdrop"
              role="presentation"
              onMouseDown={() => !broadcasting && setShowBroadcastReview(false)}
            >
              <div
                className="assignmentDialog assignmentPublishReview"
                role="dialog"
                aria-modal="true"
                aria-labelledby="broadcastReviewTitle"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="assignmentDialogHead">
                  <div>
                    <h3 id="broadcastReviewTitle">Review Broadcast</h3>
                    <p>
                      Email active officials a link to review and claim the selected open games.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    disabled={broadcasting}
                    onClick={() => setShowBroadcastReview(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="publishReviewSummary">
                  <span><b>{linkSelected.length}</b> selected game{linkSelected.length === 1 ? "" : "s"}</span>
                  <span><b>{broadcastOfficials.length}</b> active official{broadcastOfficials.length === 1 ? "" : "s"}</span>
                  <span><b>{broadcastOpenPositions.length}</b> open position{broadcastOpenPositions.length === 1 ? "" : "s"}</span>
                  <span className={broadcastMissingEmails ? "warning" : "ready"}>
                    <b>{broadcastMissingEmails}</b> missing email{broadcastMissingEmails === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="publishRecipientList">
                  {broadcastOfficials.map((official) => (
                    <div key={official.id}>
                      <span>
                        <b>{official.first_name} {official.last_name}</b>
                        <small>Self-assign invitation</small>
                      </span>
                      <span className={official.email ? "recipientReady" : "recipientMissing"}>
                        {official.email || "Email missing"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="publishReviewNote">
                  Eligible officials can immediately self-assign and confirm. Officials who do not
                  meet league or level eligibility can request the position; the assignor will be
                  notified and may approve an override. Schedule conflicts cannot be overridden.
                </p>
                <div className="assignmentDialogFooter">
                  <button
                    type="button"
                    className="secondary"
                    disabled={broadcasting}
                    onClick={() => setShowBroadcastReview(false)}
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    className="primary assignmentBroadcastButton"
                    disabled={broadcasting || !broadcastOfficials.length || Boolean(broadcastMissingEmails)}
                    onClick={() => void broadcastAssignments()}
                  >
                    {broadcasting ? "Sending Broadcast…" : `Broadcast to ${broadcastOfficials.length} Official${broadcastOfficials.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
              </div>
            )}
            <div className="assignmentGameTableHeader">
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
            <div id="assignment-filtered-games" className="assignmentGameRows">
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
                        const previous =
                          index > 0 ? unit.games[index - 1] : null;
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
                            {selected === listedGame.id && (
                              <>
                                <div
                                  className="desktopInlineAssignmentHost"
                                  ref={setInlineAssignmentHost}
                                />
                                {renderMobileInlineAssignment()}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                <div className="assignmentNoGames">
                  <b>
                    {selfAssignOnly
                      ? "No games are open for Self Assign"
                      : "No games match these filters"}
                  </b>
                  <span>
                    Change the filters or reset them to see all games.
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={clearGameFilters}
                  >
                    Clear All Filters
                  </button>
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
                {filteredGames.length
                  ? "Select a game"
                  : "No games on this date"}
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
                  {g.game_number} — {new Date(g.starts_at).toLocaleDateString()}{" "}
                  — {g.home?.name || "TBD"} vs {g.away?.name || "TBD"} —{" "}
                  {g.duration_minutes || 110} min — Power{" "}
                  {gamePower(g).toFixed(1)}
                </option>
              ))}
            </select>
          </label>
        </section>
        {game &&
          filteredGames.some((g) => g.id === game.id) &&
          inlineAssignmentHost &&
          createPortal(
          <div className={`assignmentLayout selectedGameDetailStandalone${focusGameId === game.id ? " reportActionFocus" : ""}`}>
            <section
              id="selected-game-assignment"
              className="card assignmentMain"
            >
              <div className="cardHead selectedGameStickyHeader">
                <div>
                  <button
                    type="button"
                    className="assignmentBackToGames"
                    onClick={() => {
                      setSelected("");
                      setLinkSelected([]);
                    }}
                  >
                    ← Back to games
                  </button>
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
                  <div
                    className="selectedGameSummary"
                    aria-label="Assignment summary"
                  >
                    <span>
                      <b>
                        {activeAssignmentCount}/{game.officials_needed}
                      </b>{" "}
                      Filled
                    </span>
                    <span>
                      <b>{openPositionCount}</b> Open
                    </span>
                    <span>
                      <b>
                        {
                          gameAssignments.filter(
                            (item) =>
                              item.status === "proposed" && item.published_at,
                          ).length
                        }
                      </b>{" "}
                      Awaiting
                    </span>
                    <span>
                      <b>
                        {
                          gameAssignments.filter((item) =>
                            ["accepted", "confirmed"].includes(item.status),
                          ).length
                        }
                      </b>{" "}
                      Confirmed
                    </span>
                  </div>
                  <div className="selectedGameUtilities">
                    <button
                      type="button"
                      className="assignmentActivityLink"
                      onClick={() => void openActivityTimeline()}
                    >
                      Activity timeline
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        className="assignmentActivityLink"
                        onClick={openCrewTemplateTools}
                      >
                        Crew templates
                      </button>
                    )}
                    <div
                      className="assignmentConfirmMessage"
                      aria-label="Notification history"
                    >
                      <b>Notifications:</b>{" "}
                      {["canceled", "rained_out"].includes(game.status)
                        ? `${cancellationEmailsSent} cancellation notice${cancellationEmailsSent === 1 ? "" : "s"} sent`
                        : `${assignmentEmailsSent} assignment email${assignmentEmailsSent === 1 ? "" : "s"} sent`}
                      {(cancellationEmailIssues || assignmentEmailIssues) >
                        0 && (
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
                          >
                            {retryingNotifications ? "Retrying…" : "Retry"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {gamePositions.length === 0 ? (
                <div className="errorBox">
                  No assignment positions are configured for this sport.
                </div>
              ) : (
                <>
                  <div
                    className="positionFocusToggle desktopPositionFocus"
                    role="group"
                    aria-label="Positions shown"
                  >
                    <button
                      type="button"
                      className={!needsAssignmentOnly ? "active" : ""}
                      onClick={() =>
                        setNeedsAssignmentView((current) => ({
                          ...current,
                          [game.id]: false,
                        }))
                      }
                    >
                      All Positions
                    </button>
                    <button
                      type="button"
                      className={needsAssignmentOnly ? "active" : ""}
                      onClick={() =>
                        setNeedsAssignmentView((current) => ({
                          ...current,
                          [game.id]: true,
                        }))
                      }
                    >
                      Needs Assignment ({openPositionCount})
                    </button>
                  </div>
                  {visibleGamePositions.length ? (
                    <div className="tableWrap assignmentPositionsScroll" role="region" aria-label="Game assignment positions" tabIndex={0}>
                      <table className="assignmentPositionsTable">
                        <thead>
                          <tr>
                            <th>Self Assign</th>
                            <th>Position</th>
                            <th>Assigned Official</th>
                            <th>Status</th>
                            <th>Assign</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGamePositions.map((pos) => {
                            const index = gamePositions.findIndex(
                              (position) => position.id === pos.id,
                            );
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
                              replacementNeeded = isReplacementNeeded(
                                game.id,
                                pos.id,
                              ),
                              list = candidates(pos),
                              label = rankLabel(pos),
                              status = current
                                ? assignmentStatus(current)
                                : null;
                            return (
                              <tr
                                key={pos.id}
                                id={`assignment-position-${pos.id}`}
                                style={{
                                  background:
                                    declined && !current
                                      ? "#fff1f2"
                                      : undefined,
                                }}
                              >
                                <td>
                                  {!current &&
                                  !isSelfAssignOpen(game.id, pos.id) ? (
                                    <input
                                      type="checkbox"
                                      checked={selfAssignSelected.includes(
                                        selfAssignKey(game.id, pos.id),
                                      )}
                                      disabled={!canManage || selfAssignSaving}
                                      aria-label={`Select ${pos.name} for Self Assign`}
                                      onChange={() =>
                                        toggleSelfAssignSelection(
                                          game.id,
                                          pos.id,
                                        )
                                      }
                                    />
                                  ) : !current ? (
                                    <div className="selfAssignOpenControls">
                                      <button
                                        type="button"
                                        className="secondary selfAssignCloseButton"
                                        disabled={
                                          !canManage || selfAssignSaving
                                        }
                                        aria-label={`Close Self Assign for ${pos.name}`}
                                        title="Close Self Assign"
                                        onClick={() =>
                                          void withdrawSelfAssignPosition(
                                            game.id,
                                            pos.id,
                                          )
                                        }
                                      >
                                        Open <span aria-hidden="true">×</span>
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
                                        style={{
                                          padding: "5px 8px",
                                          fontSize: 11,
                                        }}
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
                                      <small>
                                        Slot {index + 1} of{" "}
                                        {game.officials_needed}
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
                                            title="Move up one position; swaps officials when occupied"
                                            aria-label="Move official up one position"
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
                                                index === 0
                                                  ? "#cbd5e1"
                                                  : "#2563eb",
                                              color: "#fff",
                                              fontSize: 14,
                                              fontWeight: 900,
                                            }}
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            title="Move down one position; swaps officials when occupied"
                                            aria-label="Move official down one position"
                                            disabled={
                                              index ===
                                                gamePositions.length - 1 ||
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
                                                index ===
                                                gamePositions.length - 1
                                                  ? "#cbd5e1"
                                                  : "#2563eb",
                                              color: "#fff",
                                              fontSize: 14,
                                              fontWeight: 900,
                                            }}
                                          >
                                            ↓
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
                                              disabled={
                                                confirming === current.id
                                              }
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
                                  ) : replacementNeeded ? (
                                    <div>
                                      <b style={{ color: "#b91c1c" }}>
                                        {declined
                                          ? "Open — official declined"
                                          : "Open — replacement needed"}
                                      </b>
                                      {declined && (
                                        <small>
                                          {
                                            officials.find(
                                              (o) =>
                                                o.id === declined.official_id,
                                            )?.first_name
                                          }{" "}
                                          {
                                            officials.find(
                                              (o) =>
                                                o.id === declined.official_id,
                                            )?.last_name
                                          }
                                          {declined.decline_reason
                                            ? ` • ${declined.decline_reason}`
                                            : ""}
                                          {declined.responded_at
                                            ? ` • ${new Date(declined.responded_at).toLocaleString()}`
                                            : ""}
                                        </small>
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
                                  ) : replacementNeeded ? (
                                    <span className="badge red">
                                      Replacement Needed
                                    </span>
                                  ) : (
                                    <span>—</span>
                                  )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="primary candidatePanelButton"
                                    disabled={saving === pos.id}
                                    onClick={() =>
                                      setCandidatePositionId(pos.id)
                                    }
                                  >
                                    {current
                                      ? "Change Official"
                                      : replacementNeeded
                                        ? "Find Replacement"
                                        : "View Candidates"}
                                    <small>
                                      {
                                        list.filter(
                                          (candidate) =>
                                            candidate.reasons.length === 0,
                                        ).length
                                      }{" "}
                                      eligible
                                    </small>
                                  </button>
                                  <details className="mobileAssignmentDetails">
                                    <summary>More Details</summary>
                                    <div>
                                      <small>
                                        Slot {index + 1} of{" "}
                                        {game.officials_needed} • {label}
                                      </small>
                                      <small>
                                        Self Assign:{" "}
                                        {isSelfAssignOpen(game.id, pos.id)
                                          ? "Open"
                                          : "Closed"}
                                      </small>
                                      {!current &&
                                        isSelfAssignOpen(game.id, pos.id) && (
                                          <button
                                            type="button"
                                            className="secondary"
                                            disabled={
                                              !canManage || selfAssignSaving
                                            }
                                            onClick={() =>
                                              void withdrawSelfAssignPosition(
                                                game.id,
                                                pos.id,
                                              )
                                            }
                                          >
                                            Close Self Assign
                                          </button>
                                        )}
                                      {current && canManage && (
                                        <div className="mobilePositionMove">
                                          <span>Move official:</span>
                                          <button
                                            type="button"
                                            aria-label="Move official up one position"
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
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            aria-label="Move official down one position"
                                            disabled={
                                              index ===
                                                gamePositions.length - 1 ||
                                              movingAssignment === current.id
                                            }
                                            onClick={() =>
                                              void moveAssignment(
                                                game.id,
                                                current.id,
                                                1,
                                              )
                                            }
                                          >
                                            ↓
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </details>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="positionsFilledMessage">
                      <b>Every position is filled</b>
                      <span>
                        Switch to All Positions to review or change the crew.
                      </span>
                    </div>
                  )}
                </>
              )}
              <p>
                <small>
                  <b>Future+</b> means the official already has a later
                  non-declined assignment involving the home or away team in
                  this game. <b>⚠ OVERRIDE</b> options are ineligible officials
                  that an Administrator or Assignor may manually assign after
                  confirming the warning. Officials already working during this
                  game time are hidden and cannot be overridden.
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
                Select an official, then choose a game to fill its next open
                position. Ineligible officials remain visible in red and require
                an override; overlapping assignments cannot be overridden.
              </p>
              <div className="officialListTools">
                <input
                  type="search"
                  value={officialListSearch}
                  onChange={(event) =>
                    setOfficialListSearch(event.target.value)
                  }
                  placeholder="Search officials"
                  aria-label="Search available officials"
                />
                <select
                  value={officialListSort}
                  onChange={(event) =>
                    setOfficialListSort(
                      event.target.value as typeof officialListSort,
                    )
                  }
                  aria-label="Sort available officials"
                >
                  <option value="best">Best qualified</option>
                  <option value="distance">Closest</option>
                  <option value="rank">Highest rank</option>
                  <option value="leastRecent">Least recently assigned</option>
                  <option value="name">Name</option>
                </select>
              </div>
              <div className="availableOfficialsList">
                {availableOfficials.map((o, i) => (
                  <div className="availableOfficial" key={o.id}>
                    <span className="availableOrder">{i + 1}</span>
                    <div>
                      <b>
                        {o.first_name} {o.last_name}
                        <ScheduleLink officialId={o.id} />
                      </b>
                      {futureBadge(o.id)}
                      <small>
                        My General Rank {o.rank.toFixed(1)}
                        {teamRecencyLabel(o.id)}
                        {o.distance != null
                          ? ` • ${o.distance.toFixed(1)} mi`
                          : ""}
                      </small>
                      {canManage && (
                        <button
                          type="button"
                          className="pickOfficialButton"
                          aria-pressed={pickedOfficial === o.id}
                          onClick={() => chooseOfficialToAssign(o.id)}
                        >
                          {pickedOfficial === o.id
                            ? "Selected"
                            : "Select to Assign"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {ineligibleOfficials.length > 0 && (
                  <div className="ineligibleOfficialsSection">
                    <button
                      type="button"
                      className="ineligibleOfficialsToggle"
                      aria-expanded={showIneligibleOfficials}
                      onClick={() =>
                        setShowIneligibleOfficials((visible) => !visible)
                      }
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
                            onChange={(event) =>
                              setIneligibleSearch(event.target.value)
                            }
                            placeholder="Search official"
                            aria-label="Search ineligible officials"
                          />
                          <select
                            value={ineligibleReasonFilter}
                            onChange={(event) =>
                              setIneligibleReasonFilter(event.target.value)
                            }
                            aria-label="Filter ineligible officials by reason"
                          >
                            <option value="all">All reasons</option>
                            <option value="eligibility">League or level</option>
                            <option value="availability">Unavailable</option>
                            <option value="conflict">
                              Assignment conflict
                            </option>
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
                                <ScheduleLink officialId={o.id} />
                              </b>
                              <small
                                style={{ color: "#b91c1c", fontWeight: 700 }}
                              >
                                {o.reasons.join(" • ")}
                              </small>
                              {canManage && (
                                <button
                                  type="button"
                                  className="pickOfficialButton ineligiblePick"
                                  aria-pressed={pickedOfficial === o.id}
                                  onClick={() => chooseOfficialToAssign(o.id)}
                                >
                                  {pickedOfficial === o.id
                                    ? "Selected"
                                    : "Select to Assign"}
                                </button>
                              )}
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
                                          <option value="">
                                            Select position…
                                          </option>
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
                                <small
                                  style={{ color: "#7f1d1d", fontWeight: 900 }}
                                >
                                  Cannot override an overlapping assignment
                                </small>
                              )}
                            </div>
                          </div>
                        ))}
                        {!visibleIneligibleOfficials.length && (
                          <div className="emptyState">
                            <p>No ineligible officials match the filters.</p>
                          </div>
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
          </div>,
          inlineAssignmentHost,
        )}
      </div>
    </>
  );
}
