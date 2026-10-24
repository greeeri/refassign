"use client";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { readAllForChunks, readAllPages } from "../lib/supabase/readAll";

type Field = { id: string; name: string };
type Parent = { id: string; venue_id: string | null };
type Venue = { id: string; name: string; address: string | null; city: string | null; state: string | null };
const blankVenue = { name: "", address: "", city: "", state: "" };

/** Parent identity is always a saved UUID. Legacy field-complex settings below
 * remain separate and are never rewritten by this editor. */
export default function LocationVenueStructure({ fields, scopeKey, canEdit, children }: {
  fields: Field[]; scopeKey: string; canEdit: boolean; children?: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fieldKey = [...new Set(fields.map(field => field.id))].sort().join("|");
  const contextKey = JSON.stringify([scopeKey, fieldKey, canEdit]);
  const current = useRef(contextKey);
  current.current = contextKey;
  const request = useRef(0);
  const busy = useRef(false);
  const mutation = useRef(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [tab, setTab] = useState<"Fields" | "Venues">("Fields");
  const [parents, setParents] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [venues, setVenues] = useState<Venue[]>([]);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [venueDraft, setVenueDraft] = useState(blankVenue);
  const ready = loadedKey === contextKey && canEdit;
  const valid = () => current.current === contextKey;

  async function load() {
    const version = ++request.current;
    setLoadedKey(""); setError("");
    if (!canEdit) return;
    try {
      const [parentResult, venueResult, roleResult] = await Promise.all([
        readAllForChunks<Parent, string>(fieldKey ? fieldKey.split("|") : [], (ids, from, to) =>
          supabase.from("locations").select("id,venue_id").in("id", ids).order("id").range(from, to)),
        readAllPages<Venue>((from, to) => supabase.rpc("get_location_venue_options").order("id").range(from, to)),
        supabase.rpc("is_super_admin"),
      ]);
      if (!valid() || version !== request.current) return;
      if (parentResult.error || venueResult.error || roleResult.error) throw new Error((parentResult.error || venueResult.error || roleResult.error)!.message);
      const records = parentResult.data || [];
      setParents(Object.fromEntries(records.map(row => [row.id, row.venue_id])));
      setDrafts(Object.fromEntries(records.map(row => [row.id, row.venue_id || ""])));
      setVenues((venueResult.data || []).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
      setSuperAdmin(roleResult.data === true);
      setLoadedKey(contextKey);
    } catch (cause) {
      if (valid() && version === request.current) setError(cause instanceof Error ? cause.message : "Venue relationships could not be loaded.");
    }
  }
  useEffect(() => {
    current.current = contextKey;
    setParents({}); setDrafts({}); setVenues([]); setSuperAdmin(false);
    setFilter("all"); setSaving(""); setMessage(""); setEditing(null); setVenueDraft(blankVenue); setTab("Fields");
    busy.current = false; mutation.current += 1;
    void load();
    return () => { current.current = ""; request.current += 1; mutation.current += 1; };
  }, [contextKey]);

  async function saveParent(field: Field) {
    if (!ready || !valid() || busy.current || !(field.id in parents) || !fields.some(row => row.id === field.id)) return;
    const selected = drafts[field.id] || null;
    if (selected === parents[field.id]) return;
    if (selected && !venues.some(venue => venue.id === selected)) { setError("Choose an available venue."); return; }
    const generation = ++request.current; // Invalidate an older refresh before saving.
    const operation = ++mutation.current;
    const validSave = () => valid() && request.current === generation && mutation.current === operation;
    busy.current = true; setSaving(field.id); setError(""); setMessage("");
    try {
      const result = await supabase.rpc("set_location_venue", {
        p_location_id: field.id, p_venue_id: selected, p_expected_venue_id: parents[field.id],
      });
      if (!validSave()) return;
      if (result.error) throw new Error(result.error.message);
      // The scalar RPC returns the saved UUID (or null for explicit unassignment).
      if (result.data !== selected) throw new Error("The saved venue was not confirmed. Refresh before trying again.");
      setParents(rows => ({ ...rows, [field.id]: selected }));
      setMessage(`${field.name}: venue ${selected ? "saved" : "unassigned"}. Field ID, games and assignments were not changed.`);
    } catch (cause) {
      if (validSave()) setError(cause instanceof Error ? cause.message : "Venue association could not be saved.");
    } finally { if (valid() && mutation.current === operation) { busy.current = false; setSaving(""); } }
  }

  async function saveVenue(event: FormEvent) {
    event.preventDefault();
    if (!ready || !valid() || !superAdmin || busy.current || !venueDraft.name.trim()) return;
    if (editing && !venues.some(venue => venue.id === editing)) return;
    const payload = { name: venueDraft.name.trim(), address: venueDraft.address.trim() || null, city: venueDraft.city.trim() || null, state: venueDraft.state.trim() || null };
    const generation = ++request.current;
    const operation = ++mutation.current;
    const validSave = () => valid() && request.current === generation && mutation.current === operation;
    busy.current = true; setSaving("venue"); setError(""); setMessage("");
    try {
      const result = editing
        ? await supabase.from("venues").update(payload).eq("id", editing).select("id").single()
        : await supabase.from("venues").insert(payload).select("id").single();
      if (!validSave()) return;
      if (result.error || !result.data?.id) throw new Error(result.error?.message || "The venue save was not confirmed.");
      setMessage("Venue saved. Existing field associations were not changed.");
      setEditing(null); setVenueDraft(blankVenue);
      await load();
    } catch (cause) {
      if (validSave()) setError(cause instanceof Error ? cause.message : "Venue could not be saved.");
    } finally { if (valid() && mutation.current === operation) { busy.current = false; setSaving(""); } }
  }

  if (!canEdit) return <section className="card"><h2>Venues and fields</h2><p>Only authorized directory managers can change field associations. Existing access restrictions still apply.</p></section>;
  const visibleFields = ready ? fields.filter(field => filter === "all" || (field.id in parents && parents[field.id] === null)) : [];
  return <>
    <section className="card">
      <h2>Venues and fields</h2>
      <p>A venue is the parent site; each field keeps its own saved identity. Choose a parent explicitly—names never assign fields automatically.</p>
      <div className="headerActions" role="group" aria-label="Locations views">
        <button type="button" className={tab === "Fields" ? "primary" : "secondary"} aria-pressed={tab === "Fields"} onClick={() => setTab("Fields")}>Fields</button>
        <button type="button" className={tab === "Venues" ? "primary" : "secondary"} aria-pressed={tab === "Venues"} onClick={() => setTab("Venues")}>Venues</button>
      </div>
      {error && <div role="alert" className="errorBox">{error}</div>}
      {message && <div role="status" className="successBox">{message}</div>}
      {!ready && !error && <p>Loading venue relationships…</p>}
      <button type="button" className="secondary" disabled={Boolean(saving)} onClick={() => { if (!busy.current) void load(); }}>Refresh venue relationships</button>
      {tab === "Fields" && <>
        <h3>Assign fields to venues</h3>
        <label>Venue association filter <select aria-label="Venue association filter" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All fields</option><option value="unassigned">Unassigned venue</option>
        </select></label>
        <p>These are the fields already available in this Locations workspace. Creating a venue does not automatically move or link any fields.</p>
        <div className="tableWrap"><table><thead><tr><th>Field</th><th>Parent venue</th><th>Save association</th></tr></thead><tbody>
          {visibleFields.map(field => {
            const known = field.id in parents;
            const value = drafts[field.id] || "";
            return <tr key={field.id}><td>{field.name}</td><td>
              <select aria-label={`Parent venue for ${field.name}`} value={value} disabled={!known || Boolean(saving)} onChange={event => setDrafts(rows => ({ ...rows, [field.id]: event.target.value }))}>
                <option value="">Unassigned venue</option>
                {value && !venues.some(venue => venue.id === value) && <option value={value}>Current venue unavailable (preserved)</option>}
                {venues.map(venue => <option key={venue.id} value={venue.id}>{[venue.name, venue.city, venue.state].filter(Boolean).join(" · ")}</option>)}
              </select>
              {!known && <small>Field relationship unavailable. Refresh or check access.</small>}
            </td><td><button type="button" className="tableButton" disabled={!known || Boolean(saving) || value === (parents[field.id] || "")} onClick={() => void saveParent(field)}>{saving === field.id ? "Saving…" : "Save venue"}</button></td></tr>;
          })}
          {ready && !visibleFields.length && <tr><td colSpan={3}>No fields match this filter.</td></tr>}
        </tbody></table></div>
        <p>Legacy Field Complex settings below are separate and remain unchanged.</p>
      </>}
      {tab === "Venues" && ready && <>
        <h3>Venue directory</h3>
        {!superAdmin && <p>Venue creation and editing are restricted to super administrators. Choose an existing available venue from Fields, or ask an administrator to add one.</p>}
        {superAdmin && <form className="officialForm" onSubmit={saveVenue}>
          <h4>{editing ? "Edit venue" : "Add venue"}</h4>
          {(["name", "address", "city", "state"] as const).map(key => <label key={key}>Venue {key}<input required={key === "name"} value={venueDraft[key]} disabled={Boolean(saving)} onChange={event => setVenueDraft(draft => ({ ...draft, [key]: event.target.value }))}/></label>)}
          <button className="primary" disabled={Boolean(saving) || !venueDraft.name.trim()}>{saving === "venue" ? "Saving venue…" : "Save venue record"}</button>
          {editing && <button type="button" className="secondary" disabled={Boolean(saving)} onClick={() => { setEditing(null); setVenueDraft(blankVenue); }}>Cancel venue edit</button>}
        </form>}
        <div className="tableWrap"><table><thead><tr><th>Venue</th><th>Address</th><th></th></tr></thead><tbody>{venues.map(venue => <tr key={venue.id}><td>{venue.name}</td><td>{[venue.address, venue.city, venue.state].filter(Boolean).join(", ")}</td><td>{superAdmin && <button type="button" className="tableButton" disabled={Boolean(saving)} onClick={() => { setEditing(venue.id); setVenueDraft({ name: venue.name, address: venue.address || "", city: venue.city || "", state: venue.state || "" }); }}>Edit venue</button>}</td></tr>)}</tbody></table></div>
      </>}
    </section>
    {tab === "Fields" && children}
  </>;
}
