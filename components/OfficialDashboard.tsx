"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { crewPositionLabel, orderedCrew } from "../lib/crewDisplay";
import CrewChatButton from "./CrewChatButton";
import CalendarSync from "./CalendarSync";
import VenueDetailsButton from "./VenueDetailsButton";
type Assignment = {
  assignment_id: string;
  game_id: string;
  game_number: string | null;
  game_status: string | null;
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
type Crew = {
  assignment_id: string;
  position: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
};
const declineReasons = [
    "Schedule Conflict",
    "Travel / Distance",
    "Team Conflict",
    "Injury / Illness",
    "Already Assigned",
    "Other",
  ],
  changedStatuses = ["canceled", "suspended", "rained_out"];
function mapsUrl(a: Assignment) {
  const query =
    [a.location_address, a.location_city, a.location_state]
      .filter(Boolean)
      .join(", ") ||
    a.location_name ||
    "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function icsEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function icsDate(value: Date) {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
export default function OfficialDashboard({
  onNavigate,
}: {
  onNavigate: (section: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []),
    [rows, setRows] = useState<Assignment[]>([]),
    [crew, setCrew] = useState<Crew[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false),
    [declining, setDeclining] = useState(false),
    [reason, setReason] = useState(declineReasons[0]),
    [otherReason, setOtherReason] = useState("");
  const future = useMemo(
      () =>
        rows
          .filter((row) => new Date(row.starts_at).getTime() >= Date.now())
          .sort(
            (a, b) =>
              new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
          ),
      [rows],
    ),
    active = useMemo(
      () =>
        future.filter(
          (row) =>
            !changedStatuses.includes(row.game_status || "") &&
            row.status !== "cancelled",
        ),
      [future],
    ),
    next = active[0],
    actionable = active.filter((row) => row.status === "proposed"),
    accepted = active.filter((row) =>
      ["accepted", "confirmed"].includes(row.status),
    ),
    changed = future.filter(
      (row) =>
        changedStatuses.includes(row.game_status || "") ||
        row.status === "cancelled",
    );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc(
      "my_official_assignments",
    );
    if (loadError) setError(loadError.message);
    else setRows((data || []) as Assignment[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    async function loadCrew() {
      if (!next) {
        setCrew([]);
        return;
      }
      const { data } = await supabase.rpc("get_game_report_bundle", {
        p_game_id: next.game_id,
      });
      setCrew(orderedCrew((data?.crew || []) as Crew[]));
    }
    void loadCrew();
  }, [next?.game_id, supabase]);
  async function respond(response: "accepted" | "declined") {
    if (!next) return;
    const why =
      response === "declined"
        ? reason === "Other"
          ? otherReason.trim()
          : reason
        : null;
    if (response === "declined" && !why) {
      setError("Please enter a decline reason.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    const { error: responseError } = await supabase.rpc(
      "respond_to_assignment",
      {
        p_token: next.response_token,
        p_response: response,
        p_decline_reason: why,
      },
    );
    if (responseError) setError(responseError.message);
    else {
      setNotice(
        response === "accepted"
          ? "Assignment accepted."
          : "Assignment declined and removed from your active schedule.",
      );
      setDeclining(false);
      setOtherReason("");
      setReason(declineReasons[0]);
      await load();
    }
    setWorking(false);
  }
  function downloadCalendar() {
    if (!next) return;
    const start = new Date(next.starts_at),
      end = new Date(start.getTime() + 120 * 60_000),
      location = [
        next.location_name,
        next.location_address,
        next.location_city,
        next.location_state,
      ]
        .filter(Boolean)
        .join(", "),
      description = [
        `${crewPositionLabel(next.position_name)} assignment`,
        next.league_name,
        next.level_name,
        next.notes,
      ]
        .filter(Boolean)
        .join(" • "),
      ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//RefAssign//Official Schedule//EN",
        "BEGIN:VEVENT",
        `UID:${next.assignment_id}@refassign`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsEscape(`${next.home_team || "TBD"} vs ${next.away_team || "TBD"}`)}`,
        `LOCATION:${icsEscape(location)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      url = URL.createObjectURL(
        new Blob([ics], { type: "text/calendar;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `refassign-${next.game_number || next.assignment_id}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (loading)
    return (
      <section className="card">
        <p>Loading your next assignment…</p>
      </section>
    );
  return (
    <div className="officialMobileExperience">
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      <section className="officialQuickStats">
        <button type="button" onClick={() => onNavigate("My Schedule")}>
          <b>{actionable.length}</b>
          <span>Need response</span>
        </button>
        <button type="button" onClick={() => onNavigate("My Schedule")}>
          <b>{accepted.length}</b>
          <span>Upcoming</span>
        </button>
        <button type="button" onClick={() => onNavigate("My Schedule")}>
          <b>{changed.length}</b>
          <span>Game changes</span>
        </button>
      </section>
      {!next ? (
        <section className="card emptyState">
          <h2>No upcoming assignments</h2>
          <p>Your next published assignment will appear here.</p>
          <button
            className="primary"
            type="button"
            onClick={() => onNavigate("Self Assign")}
          >
            View Self-Assign Games
          </button>
        </section>
      ) : (
        <section className="card nextAssignmentCard">
          <div className="nextAssignmentTop">
            <div>
              <small>NEXT ASSIGNMENT</small>
              <h2>
                {next.home_team || "TBD"} vs {next.away_team || "TBD"}
              </h2>
              <p>{next.game_number || "Game number pending"}</p>
            </div>
            <span
              className={`badge ${next.status === "proposed" ? "yellow" : "green"}`}
            >
              {next.status === "proposed" ? "Needs Response" : "Accepted"}
            </span>
          </div>
          <div className="nextAssignmentFacts">
            <div>
              <small>DATE & TIME</small>
              <b>
                {new Date(next.starts_at).toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </b>
              <span>
                {new Date(next.starts_at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div>
              <small>POSITION</small>
              <b>{crewPositionLabel(next.position_name)}</b>
              <span>
                {[next.league_name, next.level_name]
                  .filter(Boolean)
                  .join(" • ") || "—"}
              </span>
            </div>
            <div>
              <small>LOCATION</small>
              <b>{next.location_name || "TBD"}</b>
              <span>
                {[next.location_city, next.location_state]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          </div>
          {next.status === "proposed" && !declining && (
            <div className="mobileResponseActions">
              <button
                className="acceptButton"
                type="button"
                disabled={working}
                onClick={() => void respond("accepted")}
              >
                ✓ Confirm Assignment
              </button>
              <button
                className="dangerButton"
                type="button"
                disabled={working}
                onClick={() => setDeclining(true)}
              >
                Decline
              </button>
            </div>
          )}
          {declining && (
            <div className="declinePanel">
              <b>Why are you declining?</b>
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {declineReasons.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              {reason === "Other" && (
                <textarea
                  aria-label="Decline reason"
                  value={otherReason}
                  onChange={(event) => setOtherReason(event.target.value)}
                  placeholder="Enter the reason"
                />
              )}
              <div className="mobileResponseActions">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setDeclining(false)}
                >
                  Go Back
                </button>
                <button
                  className="dangerButton"
                  type="button"
                  disabled={working}
                  onClick={() => void respond("declined")}
                >
                  {working ? "Declining…" : "Confirm Decline"}
                </button>
              </div>
            </div>
          )}
          <div className="mobileToolGrid">
            <a href={mapsUrl(next)} target="_blank" rel="noreferrer">
              ↗ Directions
            </a>
            <VenueDetailsButton gameId={next.game_id} />
            <button type="button" onClick={downloadCalendar}>
              ＋ Calendar
            </button>
            <CrewChatButton
              gameId={next.game_id}
              title={`${next.home_team || "TBD"} vs ${next.away_team || "TBD"}`}
            />
          </div>
          <div className="mobileInfoSection">
            <h3>Crew Contacts</h3>
            {crew.length ? (
              <div className="crewContactList">
                {crew.map((member) => (
                  <div key={member.assignment_id}>
                    <div>
                      <b>{crewPositionLabel(member.position)}</b>
                      <span>{member.name}</span>
                    </div>
                    <div>
                      {member.phone && (
                        <a
                          aria-label={`Call ${member.name}`}
                          href={`tel:${member.phone}`}
                        >
                          Call
                        </a>
                      )}
                      {member.email && (
                        <a
                          aria-label={`Email ${member.name}`}
                          href={`mailto:${member.email}`}
                        >
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>Crew contacts are not available yet.</p>
            )}
          </div>
          <div className="mobileInfoSection">
            <h3>Uniform & Game Notes</h3>
            <p>
              <b>Uniform:</b> Approved referee uniform; bring alternate jersey
              colors and required equipment.
            </p>
            <p>
              <b>Game notes:</b> {next.notes || "No additional game notes."}
            </p>
          </div>
        </section>
      )}
      <button
        className="secondary mobileFullSchedule"
        type="button"
        onClick={() => onNavigate("My Schedule")}
      >
        View Full Schedule
      </button>
      <CalendarSync />
    </div>
  );
}
