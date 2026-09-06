"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import GameReport from "./GameReport";
import CrewProfileLink from "./CrewProfileLink";
import LocationContactLink from "./LocationContactLink";
import CrewChatButton from "./CrewChatButton";
import VenueDetailsButton from "./VenueDetailsButton";
import { crewPositionLabel, orderedCrew } from "../lib/crewDisplay";
type Assignment = {
  assignment_id: string;
  game_id: string;
  game_number: string | null;
  game_status: string;
  position_name: string | null;
  starts_at: string;
  home_team: string | null;
  away_team: string | null;
  location_name: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  league_name: string | null;
  level_name: string | null;
  notes: string | null;
  status: string;
  published_at: string;
  accept_by: string | null;
  responded_at: string | null;
  decline_reason: string | null;
  response_token: string;
};
type Block = {
  id: string;
  block_type: "date" | "location" | "team" | "time";
  start_date: string | null;
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location_id: string | null;
  team_id: string | null;
  notes: string | null;
  source_assignment_id: string | null;
};
type MentorObservation = {
  request_id: string;
  game_id: string;
  game_number: string | null;
  starts_at: string;
  duration_minutes: number;
  official_name: string;
  home_name: string | null;
  away_name: string | null;
  location_name: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  league_name: string | null;
  level_name: string | null;
  request_details: string | null;
  availability_block_id: string | null;
};
type Choice = { id: string; name: string };
type Filter =
  | "All"
  | "Needs Response"
  | "Accepted"
  | "Game Changes"
  | "Past Games"
  | "Mentor Visits"
  | "Availability Blocks";
type View = "List" | "Calendar";
const reasons = [
  "Schedule Conflict",
  "Travel / Distance",
  "Team Conflict",
  "Injury / Illness",
  "Already Assigned",
  "Other",
];
export default function OfficialSchedule() {
  const sb = useMemo(() => createClient(), []);
  const [assignments, setAssignments] = useState<Assignment[]>([]),
    [blocks, setBlocks] = useState<Block[]>([]),
    [observations, setObservations] = useState<MentorObservation[]>([]),
    [locations, setLocations] = useState<Choice[]>([]),
    [teams, setTeams] = useState<Choice[]>([]),
    [crew, setCrew] = useState<Record<string, any[]>>({}),
    [filter, setFilter] = useState<Filter>("All"),
    [view, setView] = useState<View>("List"),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [working, setWorking] = useState(""),
    [declining, setDeclining] = useState<Assignment | null>(null),
    [reason, setReason] = useState(reasons[0]),
    [other, setOther] = useState(""),
    [reportGame, setReportGame] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    setError("");
    const { data: u } = await sb.auth.getUser();
    if (!u.user) {
      setLoading(false);
      return;
    }
    const { data: o, error: oe } = await sb
      .from("officials")
      .select("id")
      .eq("auth_user_id", u.user.id)
      .maybeSingle();
    if (oe || !o) {
      setError(
        oe?.message || "Your login is not linked to an official record.",
      );
      setLoading(false);
      return;
    }
    const [a, b, l, t, m] = await Promise.all([
      sb.rpc("my_official_assignments"),
      sb
        .from("official_availability_blocks")
        .select(
          "id,block_type,start_date,end_date,starts_at,ends_at,location_id,team_id,notes,source_assignment_id",
        )
        .eq("official_id", o.id),
      sb.from("locations").select("id,name"),
      sb.from("teams").select("id,name"),
      sb.rpc("list_my_mentor_observations"),
    ]);
    const e = a.error || b.error || l.error || t.error || m.error;
    if (e) setError(e.message);
    else {
      const rows = (a.data || []) as Assignment[];
      setAssignments(rows);
      setBlocks((b.data || []) as Block[]);
      setObservations((m.data || []) as MentorObservation[]);
      setLocations((l.data || []) as Choice[]);
      setTeams((t.data || []) as Choice[]);
      const ids = [...new Set(rows.map((x) => x.game_id).filter(Boolean))];
      const bundles = await Promise.all(
        ids.map(async (id) => {
          const { data } = await sb.rpc("get_game_report_bundle", {
            p_game_id: id,
          });
          return [id, orderedCrew(data?.crew || [])] as const;
        }),
      );
      setCrew(Object.fromEntries(bundles));
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);
  async function respond(r: Assignment, response: "accepted" | "declined") {
    const why =
      response === "declined"
        ? reason === "Other"
          ? other.trim()
          : reason
        : null;
    if (response === "declined" && !why) {
      setError("Please enter a decline reason.");
      return;
    }
    setWorking(r.assignment_id);
    setError("");
    const { error: e } = await sb.rpc("respond_to_assignment", {
      p_token: r.response_token,
      p_response: response,
      p_decline_reason: why,
    });
    if (e) setError(e.message);
    else {
      setDeclining(null);
      setReason(reasons[0]);
      setOther("");
      await load();
    }
    setWorking("");
  }
  if (reportGame)
    return (
      <GameReport gameId={reportGame} onClose={() => setReportGame(null)} />
    );
  const now = Date.now();
  function blockExpired(b: Block) {
    if (b.block_type === "time" && b.ends_at)
      return new Date(b.ends_at).getTime() < now;
    if (b.block_type === "date" && b.end_date)
      return new Date(`${b.end_date}T23:59:59`).getTime() < now;
    return false;
  }
  const activeBlocks = blocks.filter((b) => !blockExpired(b));
  function altered(a: Assignment) {
    return (
      ["canceled", "rained_out"].includes(a.game_status) ||
      a.status === "cancelled"
    );
  }
  function aStatus(a: Assignment) {
    return altered(a)
      ? a.game_status === "rained_out"
        ? "Rained Out"
        : "Cancelled"
      : ["accepted", "confirmed"].includes(a.status)
        ? "Accepted"
        : "Needs Response";
  }
  function showA(a: Assignment) {
    const past = new Date(a.starts_at).getTime() < now;
    if (filter === "Past Games") return past;
    if (past) return false;
    if (filter === "Game Changes") return altered(a);
    if (altered(a)) return false;
    if (filter === "All") return true;
    if (filter === "Accepted") return aStatus(a) === "Accepted";
    if (filter === "Needs Response") return aStatus(a) === "Needs Response";
    return false;
  }
  function blockLabel(b: Block) {
    if (b.block_type === "time")
      return `${b.starts_at ? new Date(b.starts_at).toLocaleString() : "Blocked time"}${b.ends_at ? ` – ${new Date(b.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`;
    if (b.block_type === "date")
      return b.start_date === b.end_date
        ? b.start_date || "Date"
        : `${b.start_date} through ${b.end_date}`;
    if (b.block_type === "location")
      return locations.find((x) => x.id === b.location_id)?.name || "Location";
    return teams.find((x) => x.id === b.team_id)?.name || "Team";
  }
  const events = [
    ...assignments
      .filter(showA)
      .map((a) => ({
        kind: "assignment" as const,
        date: new Date(a.starts_at),
        a,
      })),
    ...observations
      .filter((observation) => {
        const past = new Date(observation.starts_at).getTime() < now;
        if (filter === "Past Games") return past;
        return (filter === "All" || filter === "Mentor Visits") && !past;
      })
      .map((observation) => ({
        kind: "mentor" as const,
        date: new Date(observation.starts_at),
        observation,
      })),
    ...(filter === "All" || filter === "Availability Blocks"
      ? activeBlocks.flatMap((b) => {
          if (filter === "All" && b.notes?.startsWith("Mentor observation:")) return [];
          if (b.block_type === "time" && b.starts_at)
            return [{ kind: "block" as const, date: new Date(b.starts_at), b }];
          if (b.block_type === "date" && b.start_date)
            return [
              {
                kind: "block" as const,
                date: new Date(`${b.start_date}T12:00:00`),
                b,
              },
            ];
          return [];
        })
      : []),
  ].sort((x, y) => x.date.getTime() - y.date.getTime());
  const first = new Date(month.getFullYear(), month.getMonth(), 1),
    last = new Date(month.getFullYear(), month.getMonth() + 1, 0),
    startOffset = first.getDay(),
    cells = Array.from(
      { length: Math.ceil((startOffset + last.getDate()) / 7) * 7 },
      (_, i) => i - startOffset + 1,
    );
  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>My Schedule</h2>
          <p>Assignments, game crew, reports, and availability in one place.</p>
        </div>
        <div className="headerActions">
          <button
            className={view === "List" ? "primary" : "secondary"}
            onClick={() => setView("List")}
          >
            List
          </button>
          <button
            className={view === "Calendar" ? "primary" : "secondary"}
            onClick={() => setView("Calendar")}
          >
            Calendar
          </button>
        </div>
      </div>
      <div className="headerActions" style={{ marginBottom: 16 }}>
        {(
          [
            "All",
            "Needs Response",
            "Accepted",
            "Past Games",
            "Mentor Visits",
            "Availability Blocks",
          ] as Filter[]
        ).map((x) => (
          <button
            key={x}
            className={filter === x ? "primary" : "secondary"}
            onClick={() => setFilter(x)}
          >
            {x}
          </button>
        ))}
      </div>
      {error && <div className="errorBox">{error}</div>}
      {declining && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>
            Decline {declining.home_team || "TBD"} vs{" "}
            {declining.away_team || "TBD"}
          </h3>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {reason === "Other" && (
            <label>
              Reason
              <textarea
                value={other}
                onChange={(e) => setOther(e.target.value)}
              />
            </label>
          )}
          <div className="responseActions">
            <button className="secondary" onClick={() => setDeclining(null)}>
              Cancel
            </button>
            <button
              className="dangerButton"
              disabled={working === declining.assignment_id}
              onClick={() => void respond(declining, "declined")}
            >
              Confirm Decline
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <p>Loading schedule…</p>
      ) : view === "List" ? (
        <div style={{ display: "grid", gap: 10 }}>
          {events.length ? (
            events.map((e, i) =>
              e.kind === "assignment" ? (
                <div
                  key={`a-${e.a.assignment_id}`}
                  className="officialScheduleCard"
                >
                  <div className="officialScheduleDate">
                    <b>{e.date.toLocaleDateString()}</b>
                    <small>
                      {e.date.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                  <div className="officialScheduleGame">
                    <b>
                      {e.a.home_team || "TBD"} vs {e.a.away_team || "TBD"}
                    </b>
                    <small style={{ display: "block", color: "#64748b" }}>
                      {e.a.game_number ? `${e.a.game_number} • ` : ""}
                      {crewPositionLabel(e.a.position_name)} •{" "}
                      {e.a.location_name ? (
                        <LocationContactLink
                          gameId={e.a.game_id}
                          name={e.a.location_name}
                        />
                      ) : (
                        <span>TBD</span>
                      )}
                      {e.a.league_name ? ` • ${e.a.league_name}` : ""}
                    </small>
                  </div>
                  <div className="officialScheduleCrew">
                    {(crew[e.a.game_id] || []).map((c: any) => (
                      <small key={c.assignment_id} style={{ display: "block" }}>
                        <b>{crewPositionLabel(c.position)}:</b>{" "}
                        <CrewProfileLink member={c} />
                      </small>
                    ))}
                  </div>
                  <div className="officialScheduleControls">
                    <span
                      className={`badge ${aStatus(e.a) === "Accepted" ? "green" : "yellow"}`}
                    >
                      {aStatus(e.a)}
                    </span>
                    {e.a.accept_by && aStatus(e.a) === "Needs Response" && (
                      <small
                        style={{
                          display: "block",
                          color: "#64748b",
                          marginTop: 4,
                        }}
                      >
                        Respond by {new Date(e.a.accept_by).toLocaleString()}
                      </small>
                    )}
                    <div className="officialScheduleActions">
                    <VenueDetailsButton gameId={e.a.game_id} />
                    {aStatus(e.a) === "Needs Response" &&
                    new Date(e.a.starts_at).getTime() >= now ? (
                      <>
                        <button
                          className="acceptButton"
                          disabled={working === e.a.assignment_id}
                          onClick={() => void respond(e.a, "accepted")}
                        >
                          Accept
                        </button>
                        <button
                          className="dangerButton"
                          disabled={working === e.a.assignment_id}
                          onClick={() => setDeclining(e.a)}
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <button
                        className="tableButton"
                        onClick={() => setReportGame(e.a.game_id)}
                      >
                        Game Report
                      </button>
                    )}
                    </div>
                    <div className="officialScheduleChat">
                      <CrewChatButton
                        gameId={e.a.game_id}
                        title={`${e.a.home_team || "TBD"} vs ${e.a.away_team || "TBD"}`}
                      />
                    </div>
                  </div>
                </div>
              ) : e.kind === "mentor" ? (
                <div
                  key={`m-${e.observation.request_id}`}
                  className="mentorScheduleItem"
                >
                  <div>
                    <b>{e.date.toLocaleDateString()}</b>
                    <small>{e.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
                  </div>
                  <div>
                    <b>Mentor Visit — {e.observation.official_name}</b>
                    <small>{e.observation.home_name || "TBD"} vs {e.observation.away_name || "TBD"}</small>
                    <small>{e.observation.game_number ? `Game ${e.observation.game_number} • ` : ""}{e.observation.league_name || ""}{e.observation.level_name ? ` • ${e.observation.level_name}` : ""}</small>
                    {e.observation.request_details && <p><b>Development focus:</b> {e.observation.request_details}</p>}
                  </div>
                  <div>
                    <b>{e.observation.location_name || "Location TBD"}</b>
                    <small>{[e.observation.location_address, e.observation.location_city, e.observation.location_state].filter(Boolean).join(", ")}</small>
                  </div>
                  <span className="badge blue">Schedule Blocked</span>
                </div>
              ) : (
                <div
                  key={`b-${e.b.id}-${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "105px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px",
                    border: "1px solid #fecaca",
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <b>Blocked</b>
                  </div>
                  <div>
                    <b>{blockLabel(e.b)}</b>
                    <small style={{ display: "block", color: "#64748b" }}>
                      {e.b.notes || "Availability block"}
                    </small>
                  </div>
                  <span
                    className={`badge ${e.b.source_assignment_id ? "yellow" : "red"}`}
                  >
                    {e.b.source_assignment_id ? "Decline Block" : "Unavailable"}
                  </span>
                </div>
              ),
            )
          ) : (
            <div className="emptyState">
              <p>No schedule items in this view.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <button
              className="secondary"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
              }
            >
              ‹ Previous
            </button>
            <h3 style={{ margin: 0 }}>
              {month.toLocaleDateString([], { month: "long", year: "numeric" })}
            </h3>
            <button
              className="secondary"
              onClick={() =>
                setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
              }
            >
              Next ›
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7,1fr)",
              gap: 4,
            }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => (
              <div
                key={x}
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#64748b",
                  padding: 6,
                  textAlign: "center",
                }}
              >
                {x}
              </div>
            ))}
            {cells.map((day, i) => {
              const valid = day >= 1 && day <= last.getDate(),
                date = valid
                  ? new Date(month.getFullYear(), month.getMonth(), day)
                  : null,
                dayEvents = date
                  ? events.filter(
                      (e) =>
                        e.date.getFullYear() === date.getFullYear() &&
                        e.date.getMonth() === date.getMonth() &&
                        e.date.getDate() === date.getDate(),
                    )
                  : [];
              return (
                <div
                  key={i}
                  style={{
                    minHeight: 92,
                    border: "1px solid #e2e8f0",
                    borderRadius: 7,
                    padding: 6,
                    background: valid ? "#fff" : "#f8fafc",
                  }}
                >
                  {valid && (
                    <>
                      <b style={{ fontSize: 12 }}>{day}</b>
                      {dayEvents.map((e, j) => (
                        <div
                          key={j}
                          onClick={() =>
                            e.kind === "assignment" &&
                            setReportGame(e.a.game_id)
                          }
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            marginTop: 4,
                            padding: "3px 4px",
                            borderRadius: 5,
                            background:
                              e.kind === "assignment"
                                ? aStatus(e.a) === "Accepted"
                                  ? "#dcfce7"
                                  : "#fef9c3"
                                : e.kind === "mentor" ? "#dbeafe" : "#fee2e2",
                            color:
                              e.kind === "assignment"
                                ? aStatus(e.a) === "Accepted"
                                  ? "#166534"
                                  : "#854d0e"
                                : e.kind === "mentor" ? "#1d4ed8" : "#991b1b",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            cursor:
                              e.kind === "assignment" ? "pointer" : "default",
                          }}
                        >
                          {e.kind === "assignment"
                            ? `${e.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${crewPositionLabel(e.a.position_name)} — ${e.a.home_team || "TBD"}`
                            : e.kind === "mentor"
                              ? `${e.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} Mentor — ${e.observation.official_name}`
                              : "Unavailable"}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
