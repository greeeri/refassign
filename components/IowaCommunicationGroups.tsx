"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Person = { id: string; first_name: string; last_name: string; email: string | null; phone: string | null };
type Group = { id: string; name: string; development_communication_group_members: { official_id: string }[] | null };

const quote = (value: string | null) => `"${String(value || "").replace(/"/g, '""')}"`;
const email = (value: string) => value.trim().toLowerCase();

function cells(line: string) {
  const result: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { result.push(value.trim()); value = ""; }
    else value += character;
  }
  result.push(value.trim());
  return result;
}

function IowaCommunicationGroups({ programId, people }: { programId: string; people: Person[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState<"email" | "text">("email");
  const [subject, setSubject] = useState("Iowa Soccer Referee Development Program");
  const [message, setMessage] = useState("");

  async function load(preferredId?: string) {
    if (!programId) return;
    const { data, error: loadError } = await supabase.from("development_communication_groups").select("id,name,development_communication_group_members(official_id)").eq("program_id", programId).order("name");
    if (loadError) { setError(loadError.message); return; }
    const next = (data || []) as Group[];
    setGroups(next);
    const id = preferredId || activeId;
    const active = next.find((group) => group.id === id);
    if (active) setDraft((active.development_communication_group_members || []).map((member) => member.official_id));
  }

  useEffect(() => { void load(); }, [programId]);

  function choose(id: string) {
    setActiveId(id);
    const group = groups.find((item) => item.id === id);
    setDraft((group?.development_communication_group_members || []).map((member) => member.official_id));
    setError(""); setNotice("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(""); setNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Unable to identify the signed-in user."); setBusy(false); return; }
    const { data, error: createError } = await supabase.from("development_communication_groups").insert({ program_id: programId, name: name.trim(), created_by: user.id }).select("id,name").single();
    if (createError) setError(createError.code === "23505" ? "A group with that name already exists." : createError.message);
    else { setName(""); setActiveId(data.id); setDraft([]); setNotice(`${data.name} created. Select officials and save the group.`); await load(data.id); }
    setBusy(false);
  }

  async function save() {
    const group = groups.find((item) => item.id === activeId);
    if (!group) return;
    setBusy(true); setError(""); setNotice("");
    const original = new Set((group.development_communication_group_members || []).map((member) => member.official_id));
    const next = new Set(draft);
    const add = [...next].filter((id) => !original.has(id));
    const remove = [...original].filter((id) => !next.has(id));
    const operations = [];
    if (remove.length) operations.push(supabase.from("development_communication_group_members").delete().eq("group_id", group.id).in("official_id", remove));
    if (add.length) operations.push(supabase.from("development_communication_group_members").insert(add.map((officialId) => ({ group_id: group.id, program_id: programId, official_id: officialId }))));
    const results = await Promise.all(operations);
    const saveError = results.find((result) => result.error)?.error;
    if (saveError) setError(saveError.message);
    else { setNotice(`${group.name} saved with ${draft.length} official${draft.length === 1 ? "" : "s"}.`); await load(group.id); }
    setBusy(false);
  }

  async function remove() {
    const group = groups.find((item) => item.id === activeId);
    if (!group || !window.confirm(`Delete the ${group.name} communication group?`)) return;
    setBusy(true); setError("");
    const { error: deleteError } = await supabase.from("development_communication_groups").delete().eq("id", group.id);
    if (deleteError) setError(deleteError.message);
    else { setActiveId(""); setDraft([]); setNotice(`${group.name} deleted.`); await load(); }
    setBusy(false);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeId) return;
    const rows = (await file.text()).split(/\r?\n/).filter(Boolean).map(cells);
    if (!rows.length) { setError("The uploaded CSV is empty."); return; }
    const header = rows[0].map((value) => value.toLowerCase().replace(/[^a-z]/g, ""));
    const emailColumn = header.indexOf("email");
    const requested = new Set((emailColumn >= 0 ? rows.slice(1).map((row) => row[emailColumn] || "") : rows.flat()).map(email).filter((value) => value.includes("@")));
    const matched = people.filter((person) => person.email && requested.has(email(person.email))).map((person) => person.id);
    const found = new Set(people.filter((person) => matched.includes(person.id) && person.email).map((person) => email(person.email!)));
    const missing = [...requested].filter((value) => !found.has(value)).length;
    setDraft(matched);
    setNotice(`${matched.length} official${matched.length === 1 ? "" : "s"} matched. Review and save the group.${missing ? ` ${missing} email${missing === 1 ? " was" : "s were"} not found in Iowa Soccer.` : ""}`);
  }

  function download() {
    const group = groups.find((item) => item.id === activeId);
    if (!group) return;
    const ids = new Set(draft);
    const rows = people.filter((person) => ids.has(person.id)).map((person) => [person.first_name, person.last_name, person.email, person.phone].map(quote).join(","));
    const url = URL.createObjectURL(new Blob([["First Name,Last Name,Email,Phone", ...rows].join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "communication-group"}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function send() {
    if (!draft.length || !message.trim()) return;
    setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/development/communications/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officialIds: draft, channel, subject, message }) });
    const result = await response.json() as { sent?: number; failed?: number; error?: string; failures?: string[] };
    if (!response.ok) setError(result.error || "Unable to send message.");
    else { setNotice(`${result.sent || 0} group message${result.sent === 1 ? "" : "s"} sent.${result.failed ? ` ${result.failed} failed.` : ""}`); if (result.failures?.length) setError(result.failures.join(" | ")); setMessage(""); }
    setBusy(false);
  }

  return <section className="communicationGroups">
    <div className="communicationGroupsHead"><div><h3>Custom communication groups</h3><p>Create a reusable audience, or upload a CSV containing an Email column.</p></div><form onSubmit={create}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="New group name" aria-label="New group name"/><button className="primary" disabled={busy || !name.trim()}>Create group</button></form></div>
    {error && <div className="errorBox">{error}</div>}{notice && <div className="loginMessage">{notice}</div>}
    <div className="communicationGroupControls"><label>Saved group<select value={activeId} onChange={(event) => choose(event.target.value)}><option value="">Select a group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.development_communication_group_members?.length || 0})</option>)}</select></label><div className="headerActions"><label className={`secondary uploadGroupButton ${!activeId ? "disabled" : ""}`}>Upload CSV<input type="file" accept=".csv,text/csv" disabled={!activeId || busy} onChange={(event) => void upload(event)}/></label><button className="secondary" disabled={!activeId} onClick={download}>Download CSV</button><button className="secondary dangerButton" disabled={!activeId || busy} onClick={() => void remove()}>Delete</button></div></div>
    {activeId && <><div className="communicationGroupMembers">{people.map((person) => <label key={person.id} className={draft.includes(person.id) ? "selected" : ""}><input type="checkbox" checked={draft.includes(person.id)} onChange={() => setDraft((old) => old.includes(person.id) ? old.filter((id) => id !== person.id) : [...old, person.id])}/><span><b>{person.first_name} {person.last_name}</b><small>{person.email || "No email"}</small></span></label>)}</div><div className="communicationGroupSave"><span>{draft.length} official{draft.length === 1 ? "" : "s"} selected</span><button className="secondary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save group"}</button></div><div className="communicationGroupComposer"><label>Send by<select value={channel} onChange={(event) => setChannel(event.target.value as "email" | "text")}><option value="email">Email</option><option value="text">Text message</option></select></label><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)}/></label><label className="wide">Message<textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message to this group…"/></label><button className="primary" disabled={busy || !draft.length || !message.trim()} onClick={() => void send()}>{busy ? "Sending…" : `Send to ${draft.length} official${draft.length === 1 ? "" : "s"}`}</button></div></>}
  </section>;
}

export default function IowaCommunicationGroupsLoader() {
  const supabase = useMemo(() => createClient(), []);
  const [programId, setProgramId] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      supabase.from("registration_programs").select("id").eq("slug", "iowa-soccer").single(),
      supabase.rpc("list_iowa_development_people"),
    ]).then(([program, roster]) => {
      const loadError = program.error || roster.error;
      if (loadError) setError(loadError.message);
      else { setProgramId(program.data.id); setPeople((roster.data || []) as Person[]); }
    });
  }, [supabase]);
  if (error) return <section className="card"><div className="errorBox">{error}</div></section>;
  if (!programId) return null;
  return <IowaCommunicationGroups programId={programId} people={people}/>;
}
