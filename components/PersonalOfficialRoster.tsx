"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { chooseRosterImportMatch, type PersonalRosterState, type RosterMatch, type RosterImportRow } from "../lib/assignments/personalRoster";

type Assignor = { user_id: string; display_name: string };
export default function PersonalOfficialRoster({ organizationId, state, onChanged }: {
  organizationId: string; state: PersonalRosterState; onChanged: () => void;
}) {
  const client = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RosterMatch[]>([]);
  const [assignors, setAssignors] = useState<Assignor[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [emailColumn, setEmailColumn] = useState(-1);
  const [nameColumn, setNameColumn] = useState(-1);
  const [firstColumn, setFirstColumn] = useState(-1);
  const [lastColumn, setLastColumn] = useState(-1);
  const [preview, setPreview] = useState<RosterImportRow[]>([]);
  const generation = useRef(0);
  const preparing = useRef(false);
  const activating = useRef(false);
  const [confirmActivation, setConfirmActivation] = useState(false);
  useEffect(() => {
    setTarget(""); setRows([]); setPreview([]); setOpen(false);
  }, [organizationId, state.owner_wide]);
  useEffect(() => {
    generation.current += 1; preparing.current = false; activating.current = false; setConfirmActivation(false); setMatches([]); setPreview([]); setMessage(""); setBusy(false);
    return () => { generation.current += 1; };
  }, [organizationId, target, state.owner_wide, state.can_manage, state.prepared, state.enabled]);
  useEffect(() => {
    let current = true;
    if (!state.owner_wide || !state.prepared) { setAssignors([]); return; }
    void client.rpc("list_personal_roster_assignors", { p_organization_id: organizationId }).then(({ data, error }) => {
      if (!current) return;
      if (error) setMessage(error.message); else setAssignors(data || []);
    });
    return () => { current = false; };
  }, [client, organizationId, state.owner_wide, state.prepared]);
  const targetRequired = state.owner_wide && !target;
  const args = { p_organization_id: organizationId, ...(target ? { p_assignor_id: target } : {}) };
  async function activate() {
    if (!state.owner_wide || !state.can_manage || !state.prepared || state.enabled || !confirmActivation || busy || activating.current) return;
    const token = ++generation.current; activating.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await client.rpc("activate_personal_rosters", { p_organization_id: organizationId });
      if (token !== generation.current) return;
      if (error) setMessage(error.message);
      else { setConfirmActivation(false); setMessage("Personal rosters activated. Your owner-wide pool is unchanged. Existing assignments and history were not changed."); onChanged(); }
    } catch (error) {
      if (token === generation.current) setMessage(error instanceof Error ? error.message : "Could not activate personal rosters. Please retry.");
    } finally {
      if (token === generation.current) { activating.current = false; setBusy(false); }
    }
  }
  async function prepare() {
    if (!state.owner_wide || !state.can_manage || state.prepared || busy || preparing.current) return;
    const token = ++generation.current; preparing.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await client.rpc("prepare_personal_rosters", { p_organization_id: organizationId });
      if (token !== generation.current) return;
      if (error) setMessage(error.message);
      else { setMessage("Roster tools prepared. Enforcement is still inactive and your owner-wide pool is unchanged."); onChanged(); }
    } catch (error) {
      if (token === generation.current) setMessage(error instanceof Error ? error.message : "Could not prepare roster tools. Please retry.");
    } finally {
      if (token === generation.current) { preparing.current = false; setBusy(false); }
    }
  }
  async function search() {
    if (query.trim().length < 2 || targetRequired || busy) return;
    const token = ++generation.current; setBusy(true); setMessage(""); setMatches([]);
    const { data, error } = await client.rpc("search_personal_roster_officials", { ...args, p_query: query.trim() });
    if (token !== generation.current) return;
    setBusy(false); if (error) setMessage(error.message); else { setMatches(data || []); if (!data?.length) setMessage("No accessible official found. Ask the owner to add or connect the official and confirm league eligibility."); }
  }
  async function change(row: RosterMatch) {
    if (busy || targetRequired) return;
    const token = ++generation.current; setBusy(true); setMessage("");
    const { error } = await client.rpc("set_personal_roster_official", { ...args, p_official_id: row.official_id, p_active: !row.in_roster });
    if (token !== generation.current) return;
    setBusy(false);
    if (error) setMessage(error.message); else {
      setMatches(current => current.map(item => item.official_id === row.official_id ? { ...item, in_roster: !row.in_roster } : item));
      setPreview([]); setMessage(row.in_roster ? "Removed from this personal roster. Assignments and history were not changed." : "Added to this personal roster. League and game restrictions still apply."); onChanged();
    }
  }
  async function readFile(file?: File) {
    setPreview([]); setRows([]); setMessage("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 2_000_000) { setMessage("Choose a CSV file no larger than 2 MB."); return; }
    const token = ++generation.current; setBusy(true);
    try {
      const xlsx = await import("xlsx");
      const workbook = xlsx.read(await file.text(), { type: "string", raw: true });
      const parsed = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: false }).map(row => row.map(String)).filter(row => row.some(cell => cell.trim()));
      if (token !== generation.current) return;
      if (parsed.length < 2 || parsed.length > 501) throw new Error("Include a header row and between 1 and 500 officials.");
      setRows(parsed); const headers = parsed[0].map(cell => cell.trim().toLowerCase().replace(/[_\s]+/g, ""));
      setEmailColumn(headers.findIndex(cell => ["email", "emailaddress"].includes(cell)));
      setNameColumn(headers.findIndex(cell => ["name", "fullname", "officialname"].includes(cell)));
      setFirstColumn(headers.findIndex(cell => ["firstname", "first"].includes(cell)));
      setLastColumn(headers.findIndex(cell => ["lastname", "last", "surname"].includes(cell)));
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : "Could not read the CSV."); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function buildPreview() {
    if (!target || busy || !rows.length) return;
    const token = ++generation.current; setBusy(true); setPreview([]); setMessage("");
    const result: RosterImportRow[] = []; const seen = new Set<string>(); const cache = new Map<string, RosterMatch[]>();
    try {
      for (const row of rows.slice(1)) {
        const term = (emailColumn >= 0 ? row[emailColumn]?.trim() : "") || (nameColumn >= 0 ? row[nameColumn]?.trim() : "") || [firstColumn >= 0 ? row[firstColumn]?.trim() : "", lastColumn >= 0 ? row[lastColumn]?.trim() : ""].filter(Boolean).join(" ");
        if (!term || term.length < 2) { result.push({ query: term || "Missing name/email", status: "not found" }); continue; }
        let found = cache.get(term.toLowerCase());
        if (!found) {
          const response = await client.rpc("search_personal_roster_officials", { ...args, p_query: term });
          if (token !== generation.current) return;
          if (response.error) throw new Error(response.error.message);
          found = (response.data || []) as RosterMatch[]; cache.set(term.toLowerCase(), found);
        }
        result.push(chooseRosterImportMatch(term, found, seen));
      }
      if (token === generation.current) setPreview(result);
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : "Preview failed. Nothing was added."); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function importMatches() {
    if (!target || busy) return;
    const ids = preview.filter(row => row.status === "match").map(row => row.official!.official_id);
    if (!ids.length) return;
    const token = ++generation.current; setBusy(true); setMessage("");
    const { error } = await client.rpc("set_personal_roster_officials", { ...args, p_official_ids: ids });
    if (token !== generation.current) return;
    setBusy(false);
    if (error) setMessage(error.message); else {
      setPreview(current => current.map(row => row.status === "match" ? { ...row, status: "already added" } : row));
      setMessage(`${ids.length} officials added. Unmatched and ambiguous rows were not changed. No profiles, invitations, eligibility or assignments were changed.`); onChanged();
    }
  }
  function column(label: string, value: number, update: (value: number) => void) {
    return <label>{label}<select value={value} disabled={busy} onChange={event => { update(Number(event.target.value)); setPreview([]); }}><option value={-1}>Not mapped</option>{rows[0]?.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>;
  }
  if (!state.can_manage) return null;
  if (!state.prepared) return state.owner_wide ? <section className="card" aria-label="Prepare roster tools" style={{ marginBottom: 16 }}>
    <h3>Prepare assignor roster tools</h3>
    <p>This makes roster tools available for adding officials or uploading a selected assignor’s roster. It does not activate personal-roster enforcement or change anyone’s current assigning access. Your owner-wide pool stays unchanged. Activation is a separate step after the tools are verified.</p>
    <button type="button" disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare roster tools"}</button>
    {message && <p role="status">{message}</p>}
  </section> : null;
  return <section className="card" aria-label="Personal official roster" style={{ marginBottom: 16 }}>
    <div className="cardHead"><h3>{state.owner_wide ? "Assignor rosters" : "My officials"}</h3><button type="button" className="secondary" onClick={() => setOpen(!open)}>{open ? "Close roster tools" : "Add / remove officials"}</button></div>
    <p>{state.owner_wide ? "Your owner-wide pool stays unchanged. Manage a selected assignor’s personal roster below." : "Your personal roster is separate from other assignors. Adding or removing names does not change existing assignments or league eligibility."}{!state.enabled && " Personal-roster enforcement has not been activated yet."}</p>
    {state.owner_wide && !state.enabled && <div>
      {!confirmActivation ? <button type="button" disabled={busy} onClick={() => setConfirmActivation(true)}>Activate personal rosters</button> : <section aria-label="Confirm personal roster activation">
        <h4>Activate personal rosters for this organization?</h4>
        <p>Other assignors will have empty personal rosters unless officials have already been added for them. Their future manual assignments, AutoAssign candidates, and new or retried broadcast recipients will be limited to their personal rosters. A broadcast request already sending retains its captured audience. Existing assignments and history will remain unchanged. Your owner-wide pool and protected accounts’ wide access stay unchanged. Activate only after verifying the roster tools.</p>
        <button type="button" disabled={busy} onClick={() => void activate()}>{busy ? "Activating…" : "Confirm activation"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmActivation(false)}>Cancel activation</button>
      </section>}
    </div>}
    {open && <>
      {state.owner_wide && <label>Assignor<select value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setMatches([]); setPreview([]); }}><option value="">Choose an assignor</option>{assignors.map(item => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}</select></label>}
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="inlineForm"><label>Name or email<input value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setMatches([]); }} placeholder="Search existing officials" /></label><button disabled={busy || targetRequired || query.trim().length < 2}>Search</button></form>
      <ul>{matches.map(row => <li key={row.official_id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}><span>{row.display_name} {row.email_hint && `(${row.email_hint})`}</span><button type="button" className="secondary" disabled={busy} onClick={() => void change(row)}>{row.in_roster ? "Remove from roster" : "Add to roster"}</button></li>)}</ul>
      {state.owner_wide && <details><summary>Upload roster for selected assignor</summary><p>Upload a CSV, map its columns, and review exact matches. Only existing accessible officials are linked. Unmatched names need owner setup; no invitation is sent.</p><input type="file" accept=".csv,text/csv" disabled={busy || !target} onChange={event => void readFile(event.target.files?.[0])} />
        {!!rows.length && <><div className="formGrid">{column("Email", emailColumn, setEmailColumn)}{column("Full name", nameColumn, setNameColumn)}{column("First name", firstColumn, setFirstColumn)}{column("Last name", lastColumn, setLastColumn)}</div><button type="button" disabled={busy || !target || (emailColumn < 0 && nameColumn < 0 && firstColumn < 0)} onClick={() => void buildPreview()}>Preview matches</button></>}
        {!!preview.length && <><p>{preview.filter(row => row.status === "match").length} new matches ready. Review all rows before adding.</p><div style={{ maxHeight: 320, overflow: "auto" }}><ul>{preview.map((row, index) => <li key={index}>{row.query}: {row.status}{row.official ? ` · ${row.official.display_name}` : ""}</li>)}</ul></div><button type="button" disabled={busy || !preview.some(row => row.status === "match")} onClick={() => void importMatches()}>Add reviewed matches</button></>}
      </details>}
    </>}
    {busy && <p role="status">Working…</p>}{message && <p role="status">{message}</p>}
  </section>;
}
