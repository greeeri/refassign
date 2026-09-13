"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Person = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  profile_picture_url: string | null;
  is_mentor: boolean;
  note_count: number;
};
type OfficialOption = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
};
type Note = {
  id: string;
  official_id: string;
  author_name: string;
  note: string;
  created_at: string;
};
async function listAllProgramOfficials(
  supabase: ReturnType<typeof createClient>,
  programId: string,
) {
  const pageSize = 1000,
    officials: OfficialOption[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .rpc("list_development_program_officials", { p_program_id: programId })
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = (data || []) as OfficialOption[];
    officials.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: officials, error: null };
}
async function listAllIowaDevelopmentPeople(
  supabase: ReturnType<typeof createClient>,
) {
  const pageSize = 1000,
    people: Person[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .rpc("list_iowa_development_people")
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = (data || []) as Person[];
    people.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: people, error: null };
}
export default function IowaProgramReferees({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []),
    [people, setPeople] = useState<Person[]>([]),
    [availableOfficials, setAvailableOfficials] = useState<OfficialOption[]>(
      [],
    ),
    [selectedOfficial, setSelectedOfficial] = useState(""),
    [addSearch, setAddSearch] = useState(""),
    [rosterSearch, setRosterSearch] = useState(""),
    [programId, setProgramId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [openCard, setOpenCard] = useState(""),
    [notes, setNotes] = useState<Note[]>([]),
    [channel, setChannel] = useState<"email" | "text">("email"),
    [subject, setSubject] = useState("Iowa Soccer Referee Development Program"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setError("");
    const { data, error: e } = await listAllIowaDevelopmentPeople(supabase);
    if (e) {
      setError(e.message);
      return;
    }
    const current = (data || []) as Person[];
    setPeople(current);
    if (canManage) {
      const { data: program, error: pe } = await supabase
        .from("registration_programs")
        .select("id")
        .eq("slug", "iowa-soccer")
        .single();
      if (pe) {
        setError(pe.message);
        return;
      }
      setProgramId(program.id);
      const { data: all, error: ae } = await listAllProgramOfficials(
        supabase,
        program.id,
      );
      if (ae) {
        setError(ae.message);
        return;
      }
      const memberIds = new Set(current.map((person) => person.id));
      setAvailableOfficials(
        ((all || []) as OfficialOption[])
          .filter((o) => !memberIds.has(o.id))
          .sort((a, b) =>
            `${a.last_name} ${a.first_name}`.localeCompare(
              `${b.last_name} ${b.first_name}`,
            ),
          ),
      );
    } else {
      setAvailableOfficials([]);
    }
  }
  useEffect(() => {
    void load();
  }, [canManage]);
  async function addOfficial() {
    if (!canManage || !programId || !selectedOfficial) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/development/officials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ officialId: selectedOfficial }),
        }),
        result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Unable to add official.");
      setNotice("Official added to Iowa Soccer Program Referees.");
      setSelectedOfficial("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to add official.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openDevelopmentCard(id: string) {
    setOpenCard(id);
    const { data, error: e } = await supabase
      .from("official_development_notes")
      .select("id,official_id,author_name,note,created_at")
      .eq("official_id", id)
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setNotes((data || []) as Note[]);
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openCard) return;
    setBusy(true);
    const form = new FormData(event.currentTarget),
      {
        data: { user },
      } = await supabase.auth.getUser();
    if (!user) {
      setError("Unable to identify the signed-in user.");
      setBusy(false);
      return;
    }
    const [{ data: profile }, { data: authorOfficial }, { data: program }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("officials")
          .select("first_name,last_name")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
        supabase
          .from("registration_programs")
          .select("id")
          .eq("slug", "iowa-soccer")
          .single(),
      ]);
    const officialName = authorOfficial
        ? [authorOfficial.first_name, authorOfficial.last_name]
            .filter(Boolean)
            .join(" ")
            .trim()
        : "",
      profileName = String(profile?.full_name || "").trim(),
      authorName = officialName || profileName;
    if (!authorName) {
      setError(
        "Your first and last name must be added to your profile before saving a development note.",
      );
      setBusy(false);
      return;
    }
    const { error: e } = await supabase
      .from("official_development_notes")
      .insert({
        program_id: program?.id,
        official_id: openCard,
        author_user_id: user.id,
        author_name: authorName,
        note: String(form.get("note") || ""),
      });
    if (e) setError(e.message);
    else {
      event.currentTarget.reset();
      await openDevelopmentCard(openCard);
      await load();
    }
    setBusy(false);
  }
  async function send() {
    if (!selected.length || !message.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/development/communications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officialIds: selected,
          channel,
          subject,
          message,
        }),
      }),
      result = (await response.json()) as {
        sent?: number;
        failed?: number;
        error?: string;
        failures?: string[];
      };
    if (!response.ok) setError(result.error || "Unable to send message.");
    else {
      setNotice(
        `${result.sent || 0} message${result.sent === 1 ? "" : "s"} sent.${result.failed ? ` ${result.failed} failed.` : ""}`,
      );
      if (result.failures?.length) setError(result.failures.join(" | "));
      setSelected([]);
      setMessage("");
    }
    setBusy(false);
  }
  function toggle(id: string) {
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
    );
  }
  const current = people.find((person) => person.id === openCard),
    addQuery = addSearch.trim().toLowerCase(),
    addMatches = addQuery
      ? availableOfficials
          .filter((person) =>
            `${person.first_name} ${person.last_name} ${person.email || ""}`
              .toLowerCase()
              .includes(addQuery),
          )
          .slice(0, 100)
      : [],
    rosterQuery = rosterSearch.trim().toLowerCase(),
    visiblePeople = rosterQuery
      ? people.filter((person) =>
          `${person.first_name} ${person.last_name} ${person.email || ""} ${person.phone || ""}`
            .toLowerCase()
            .includes(rosterQuery),
        )
      : people,
    allVisibleSelected =
      visiblePeople.length > 0 &&
      visiblePeople.every((person) => selected.includes(person.id));
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Program Referees</h2>
            <p>
              Select one referee or a group to send an Iowa Soccer development
              message.
            </p>
          </div>
          <button
            className="secondary"
            onClick={() =>
              setSelected((old) =>
                allVisibleSelected
                  ? old.filter(
                      (id) => !visiblePeople.some((person) => person.id === id),
                    )
                  : [
                      ...new Set([
                        ...old,
                        ...visiblePeople.map((person) => person.id),
                      ]),
                    ],
              )
            }
          >
            {allVisibleSelected ? "Clear Visible" : "Select Visible"}
          </button>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        {canManage && (
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <label>
              Search Officials
              <input
                type="search"
                value={addSearch}
                onChange={(e) => {
                  setAddSearch(e.target.value);
                  setSelectedOfficial("");
                }}
                placeholder="Name or email"
              />
              <small>
                {addQuery
                  ? `${addMatches.length}${addMatches.length === 100 ? "+" : ""} matches`
                  : `${availableOfficials.length} available`}
              </small>
            </label>
            <label>
              Add Official to Program
              <select
                value={selectedOfficial}
                disabled={!addQuery}
                onChange={(e) => setSelectedOfficial(e.target.value)}
              >
                <option value="">
                  {addQuery
                    ? "Select an official"
                    : "Search by name or email first"}
                </option>
                {addMatches.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.first_name} {o.last_name}
                    {o.email ? ` — ${o.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !selectedOfficial}
              onClick={() => void addOfficial()}
            >
              {busy ? "Adding…" : "Add Official"}
            </button>
          </div>
        )}
        <div className="formGrid">
          <label>
            Send By
            <select
              value={channel}
              onChange={(event) =>
                setChannel(event.target.value as "email" | "text")
              }
            >
              <option value="email">Email</option>
              <option value="text">Text Message</option>
            </select>
          </label>
          <label>
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="fullSpan">
            Message
            <textarea
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a message to the selected referees…"
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={busy || !selected.length || !message.trim()}
          onClick={() => void send()}
        >
          {busy ? "Sending…" : `Send to ${selected.length} Selected`}
        </button>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <label>
            Search Program Referees
            <input
              type="search"
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              placeholder="Name, email, or phone"
            />
            <small>
              Showing {visiblePeople.length} of {people.length}
            </small>
          </label>
        </div>
        <div className="tableWrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Referee</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Development</th>
              </tr>
            </thead>
            <tbody>
              {visiblePeople.map((person) => (
                <tr key={person.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(person.id)}
                      onChange={() => toggle(person.id)}
                      aria-label={`Select ${person.first_name} ${person.last_name}`}
                    />
                  </td>
                  <td>
                    <b>
                      {person.first_name} {person.last_name}
                    </b>
                    {person.is_mentor && <small>Mentor</small>}
                  </td>
                  <td>{person.email || "Missing email"}</td>
                  <td>{person.phone || "Missing mobile number"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => void openDevelopmentCard(person.id)}
                    >
                      Development Card ({person.note_count})
                    </button>
                  </td>
                </tr>
              ))}
              {!visiblePeople.length && (
                <tr>
                  <td colSpan={5}>No program referees match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {current && (
        <section className="card" style={{ width: "100%" }}>
          <div className="cardHead" style={{ alignItems: "flex-start" }}>
            <div>
              <h2>
                {current.first_name} {current.last_name} — Development Card
              </h2>
              <p>
                Shared notes are visible to Iowa Soccer development staff and
                mentors.
              </p>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="secondary"
                onClick={() => setOpenCard("")}
              >
                Close
              </button>
              <button
                type="submit"
                form="development-note-form"
                className="primary"
                disabled={busy}
                style={{ width: "auto", padding: "7px 12px", fontSize: 13 }}
              >
                {busy ? "Saving…" : "Save Note"}
              </button>
            </div>
          </div>
          <form
            id="development-note-form"
            onSubmit={addNote}
            style={{ width: "100%", display: "block" }}
          >
            <label style={{ display: "block", width: "100%" }}>
              New Development Note
              <textarea
                name="note"
                required
                maxLength={5000}
                rows={8}
                placeholder="Record observations, strengths, goals, and recommended next steps…"
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: 190,
                  boxSizing: "border-box",
                  marginTop: 8,
                  resize: "vertical",
                }}
              />
            </label>
          </form>
          <div style={{ width: "100%", marginTop: 20 }}>
            <h3 style={{ marginBottom: 10 }}>Development Notes</h3>
            <div
              className="developmentModules"
              style={{ display: "block", width: "100%" }}
            >
              {notes.length ? (
                notes.map((note) => (
                  <article
                    key={note.id}
                    style={{
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      className="moduleBody"
                      style={{ width: "100%", maxWidth: "none" }}
                    >
                      <span>
                        {new Date(note.created_at).toLocaleString()} •{" "}
                        {note.author_name}
                      </span>
                      <p style={{ width: "100%", maxWidth: "none" }}>
                        {note.note}
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <p>No development notes have been added.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
