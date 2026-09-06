"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Person = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  is_mentor: boolean;
};
type InboxItem = {
  item_type: "mentor_request" | "question";
  id: string;
  official_id: string;
  official_name: string;
  body: string;
  status: string;
  created_at: string;
  response: string | null;
  responder_name: string | null;
};
type MentorGameRequest = {
  request_id: string;
  official_id: string;
  official_name: string;
  status: string;
  requested_at: string;
  request_details: string | null;
  game_id: string | null;
  game_number: string | null;
  starts_at: string | null;
  duration_minutes: number | null;
  home_name: string | null;
  away_name: string | null;
  location_name: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  league_name: string | null;
  level_name: string | null;
  accepted_by_official_id: string | null;
  accepted_mentor_name: string | null;
  accepted_at: string | null;
  field_number: string | null;
};
export default function IowaDevelopmentMentors() {
  const supabase = useMemo(() => createClient(), []),
    [people, setPeople] = useState<Person[]>([]),
    [inbox, setInbox] = useState<InboxItem[]>([]),
    [mentorRequests, setMentorRequests] = useState<MentorGameRequest[]>([]),
    [selected, setSelected] = useState(""),
    [programId, setProgramId] = useState(""),
    [isStaff, setIsStaff] = useState(false),
    [replying, setReplying] = useState(""),
    [accepting, setAccepting] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setError("");
    const [
      { data, error: e },
      { data: program },
      { data: staff },
      { data: items, error: inboxError },
      { data: requests, error: requestsError },
    ] = await Promise.all([
      supabase.rpc("list_iowa_development_people"),
      supabase
        .from("registration_programs")
        .select("id")
        .eq("slug", "iowa-soccer")
        .single(),
      supabase.rpc("is_iowa_soccer_development_staff"),
      supabase.rpc("list_iowa_development_inbox"),
      supabase.rpc("list_iowa_development_mentor_requests"),
    ]);
    if (e || inboxError || requestsError)
      setError((e || inboxError || requestsError)!.message);
    else {
      setPeople((data || []) as Person[]);
      setInbox((items || []) as InboxItem[]);
      setMentorRequests((requests || []) as MentorGameRequest[]);
    }
    if (program) setProgramId(program.id);
    setIsStaff(Boolean(staff));
  }
  useEffect(() => {
    void load();
  }, []);
  async function add() {
    if (!selected) return;
    setBusy(true);
    const {
        data: { user },
      } = await supabase.auth.getUser(),
      { error: e } = await supabase
        .from("development_mentors")
        .insert({
          program_id: programId,
          official_id: selected,
          added_by: user?.id,
        });
    if (e) setError(e.message);
    else {
      setNotice("Mentor added.");
      setSelected("");
      await load();
    }
    setBusy(false);
  }
  async function remove(id: string) {
    if (
      !window.confirm(
        "Remove this mentor from the Iowa Soccer development team?",
      )
    )
      return;
    const { error: e } = await supabase
      .from("development_mentors")
      .delete()
      .eq("program_id", programId)
      .eq("official_id", id);
    if (e) setError(e.message);
    else await load();
  }
  async function respond(event: FormEvent<HTMLFormElement>, item: InboxItem) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget),
      response = String(form.get("response") || ""),
      {
        data: { user },
      } = await supabase.auth.getUser(),
      { data: mentor } = await supabase
        .from("officials")
        .select("first_name,last_name")
        .eq("auth_user_id", user?.id || "")
        .maybeSingle(),
      mentorName = mentor
        ? [mentor.first_name, mentor.last_name].filter(Boolean).join(" ").trim()
        : "",
      now = new Date().toISOString();
    const result =
      item.item_type === "question"
        ? await supabase
            .from("development_questions")
            .update({
              response,
              status: "answered",
              responded_by: user?.id,
              responder_name: mentorName || "Iowa Soccer Mentor",
              responded_at: now,
            })
            .eq("id", item.id)
        : await supabase
            .from("development_mentor_requests")
            .update({
              response,
              status: "assigned",
              handled_by: user?.id,
              responded_at: now,
            })
            .eq("id", item.id);
    if (result.error) setError(result.error.message);
    else {
      setNotice("Response sent to " + item.official_name + ".");
      setReplying("");
      await load();
    }
    setBusy(false);
  }
  async function acceptRequest(request: MentorGameRequest) {
    if (
      !window.confirm(
        `Accept the mentor visit for ${request.official_name} at ${request.starts_at ? new Date(request.starts_at).toLocaleString() : "the selected game time"}? This will add it to your schedule and block the game time.`,
      )
    )
      return;
    setAccepting(request.request_id);
    setError("");
    setNotice("");
    const { error: e } = await supabase.rpc(
      "accept_iowa_development_mentor_request",
      { p_request_id: request.request_id },
    );
    if (e) setError(e.message);
    else {
      setNotice(
        `Mentor visit accepted for ${request.official_name}. It is now on your schedule and the time is blocked.`,
      );
      await load();
    }
    setAccepting("");
  }
  const mentors = people.filter((person) => person.is_mentor),
    available = people.filter((person) => !person.is_mentor),
    openItems = inbox.filter(
      (item) => item.status === "open" || item.status === "pending",
    );
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Mentor Inbox</h2>
            <p>
              Every Iowa Soccer mentor can see observation requests. Accepting
              one reserves the visit on your schedule.
            </p>
          </div>
          <span className="badge yellow">{openItems.length} open</span>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        <div className="developmentModules mentorInbox">
          {inbox.length ? (
            inbox.map((item) => {
              const request =
                item.item_type === "mentor_request"
                  ? mentorRequests.find((row) => row.request_id === item.id)
                  : null;
              return (
                <article key={item.id}>
                  <div className="moduleBody">
                    <span>
                      {new Date(item.created_at).toLocaleString()} •{" "}
                      {item.item_type === "question"
                        ? "Question"
                        : "Mentor Request"}{" "}
                      • {item.status}
                    </span>
                    <h3>{item.official_name}</h3>
                    {item.item_type === "question" && <p>{item.body}</p>}
                    {request && (
                      <div className="mentorGameDetails">
                        <b>
                          {request.game_id
                            ? `${request.home_name || "TBD"} vs ${request.away_name || "TBD"}`
                            : "Requested Mentor Visit"}
                        </b>
                        <span>
                          {request.starts_at
                            ? new Date(request.starts_at).toLocaleString()
                            : "Time TBD"}{" "}
                          • {request.duration_minutes || 110} minutes
                        </span>
                        <span>
                          {request.location_name || "Location TBD"}
                          {request.location_address
                            ? ` — ${request.location_address}`
                            : ""}
                          {request.location_city
                            ? `, ${request.location_city}, ${request.location_state || ""}`
                            : ""}
                          {request.field_number
                            ? ` • Field ${request.field_number}`
                            : ""}
                        </span>
                        <span>
                          {[
                            request.league_name,
                            request.level_name,
                            request.game_number &&
                              `Game ${request.game_number}`,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </span>
                        {request.request_details && (
                          <p>
                            <b>Development focus:</b> {request.request_details}
                          </p>
                        )}
                      </div>
                    )}
                    {item.response && (
                      <p>
                        <b>Response:</b> {item.response}
                      </p>
                    )}
                    {item.item_type === "mentor_request" &&
                      request?.status === "pending" && (
                        <button
                          className="acceptButton"
                          disabled={accepting === request.request_id}
                          onClick={() => void acceptRequest(request)}
                        >
                          {accepting === request.request_id
                            ? "Accepting…"
                            : "Accept Mentor Visit"}
                        </button>
                      )}
                    {item.item_type === "mentor_request" &&
                      request?.accepted_mentor_name && (
                        <p>
                          <b>Accepted by:</b> {request.accepted_mentor_name}
                        </p>
                      )}
                    {item.item_type === "question" && !item.response && (
                      <button
                        className="secondary"
                        onClick={() => setReplying(item.id)}
                      >
                        Respond
                      </button>
                    )}
                    {replying === item.id && (
                      <form
                        className="officialForm"
                        onSubmit={(event) => void respond(event, item)}
                      >
                        <label className="fullSpan">
                          Response
                          <textarea
                            name="response"
                            required
                            maxLength={5000}
                            rows={5}
                          />
                        </label>
                        <div className="headerActions">
                          <button className="primary" disabled={busy}>
                            Send Response
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setReplying("")}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p>No mentor requests or questions have been submitted.</p>
          )}
        </div>
      </section>
      {isStaff && (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Development Mentors</h2>
              <p>
                Mentors can view program referees, answer questions, and add
                shared developmental notes.
              </p>
            </div>
          </div>
          <div className="toolbar">
            <label>
              Add Program Referee as Mentor
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Select a referee</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.last_name}, {person.first_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !selected}
              onClick={() => void add()}
            >
              Add Mentor
            </button>
          </div>
          <div className="developmentRoster">
            {mentors.length ? (
              mentors.map((person) => (
                <div key={person.id}>
                  <span>
                    <b>
                      {person.first_name} {person.last_name}
                    </b>
                    <small>{person.email}</small>
                  </span>
                  <button
                    className="secondary"
                    onClick={() => void remove(person.id)}
                  >
                    Remove Mentor
                  </button>
                </div>
              ))
            ) : (
              <p>No mentors have been added yet.</p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
