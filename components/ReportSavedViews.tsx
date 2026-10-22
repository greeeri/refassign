"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

// Nested report panels inherit only the current workspace's explicit owner authority.
export const ReportSchedulingAccessContext = createContext(false);

type SavedView = { id: string; name: string; filters: Record<string, string>; is_favorite: boolean; recipient_email: string | null; frequency: "weekly" | "monthly"; send_day: number; schedule_enabled: boolean; next_send_at: string | null };
export default function ReportSavedViews({ organizationId, reportKey, filters, onApply, fullOrganizationAccess }: {
  organizationId?: string;
  reportKey: "operations" | "coverage" | "audit" | "payroll";
  filters: Record<string, string>;
  onApply: (filters: Record<string, string>) => void;
  fullOrganizationAccess?: boolean;
}) {
  const inheritedAccess = useContext(ReportSchedulingAccessContext);
  const canSchedule = fullOrganizationAccess ?? inheritedAccess;
  const scopeKey = JSON.stringify([organizationId, reportKey, canSchedule]);
  const activeScope = useRef<string | null>(scopeKey);
  activeScope.current = scopeKey;
  const loadVersion = useRef(0);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const isCurrentScope = () => activeScope.current === scopeKey;
  const [views, setViews] = useState<SavedView[]>([]), [access, setAccess] = useState<"standard" | "premium">("standard"),
    [selected, setSelected] = useState(""), [name, setName] = useState(""), [favorite, setFavorite] = useState(false),
    [email, setEmail] = useState(""), [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly"),
    [sendDay, setSendDay] = useState(1), [scheduled, setScheduled] = useState(false), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const endpoint = `/api/reports/saved-views?organizationId=${encodeURIComponent(organizationId || "")}&reportKey=${reportKey}`;
  const load = async () => {
    if (!isCurrentScope()) return;
    const request = ++loadVersion.current;
    const response = await fetch(endpoint, { cache: "no-store" }), result = await response.json();
    if (!isCurrentScope() || request !== loadVersion.current) return;
    if (!response.ok) throw new Error(result.error || "Saved views could not be loaded.");
    // GET and every mutation are constrained to the authenticated user's own saved views.
    setViews(result.views || []); setAccess(result.reportingAccess === "premium" ? "premium" : "standard");
    setEmail((value) => value || result.defaultEmail || ""); setLoadedScopeKey(scopeKey);
  };
  useEffect(() => {
    activeScope.current = scopeKey;
    setLoadedScopeKey(""); setViews([]); setSelected(""); setName(""); setFavorite(false); setEmail("");
    setFrequency("weekly"); setSendDay(1); setScheduled(false); setMessage(""); setBusy(false);
    void load().catch((reason) => { if (isCurrentScope()) setMessage(reason instanceof Error ? reason.message : "Saved views could not be loaded."); });
    return () => { activeScope.current = null; loadVersion.current += 1; };
  }, [scopeKey]);
  const choose = (id: string) => {
    if (!isCurrentScope() || loadedScopeKey !== scopeKey) return;
    const view = views.find((item) => item.id === id);
    if (!view) { if (!id) setSelected(""); return; }
    setSelected(id); setName(view.name); setFavorite(view.is_favorite); setEmail(view.recipient_email || "");
    setFrequency(view.frequency); setSendDay(view.send_day); setScheduled(canSchedule && view.schedule_enabled);
    onApply(view.filters);
    setMessage(!canSchedule && view.schedule_enabled ? `Applied “${view.name}”. Saving this personal view will turn off its scheduled delivery.` : `Applied “${view.name}”.`);
  };
  useEffect(() => {
    if (loadedScopeKey !== scopeKey) return;
    const requested = new URLSearchParams(window.location.search).get("savedView");
    if (requested && views.some((view) => view.id === requested) && selected !== requested) choose(requested);
  }, [views, selected, loadedScopeKey, scopeKey]);
  const save = async () => {
    if (!isCurrentScope() || loadedScopeKey !== scopeKey || busy) return;
    if (selected && !views.some((view) => view.id === selected)) { setMessage("Choose one of your saved views or create a new view."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected || undefined, reportKey, name: access === "premium" ? name : "My saved view", filters,
          isFavorite: favorite, recipientEmail: canSchedule ? email : "", frequency, sendDay, scheduleEnabled: canSchedule && scheduled }),
      });
      const result = await response.json();
      if (!isCurrentScope()) return;
      if (!response.ok) throw new Error(result.error || "The view could not be saved.");
      setSelected(result.view.id); setName(result.view.name); await load();
      if (isCurrentScope()) setMessage("Saved view updated.");
    } catch (reason) { if (isCurrentScope()) setMessage(reason instanceof Error ? reason.message : "The view could not be saved."); }
    finally { if (isCurrentScope()) setBusy(false); }
  };
  const remove = async () => {
    if (!isCurrentScope() || loadedScopeKey !== scopeKey || busy || !views.some((view) => view.id === selected)) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: selected, reportKey }) });
      const result = await response.json();
      if (!isCurrentScope()) return;
      if (!response.ok) throw new Error(result.error || "The view could not be deleted.");
      setSelected(""); setName(""); await load();
      if (isCurrentScope()) setMessage("Saved view deleted.");
    } catch (reason) { if (isCurrentScope()) setMessage(reason instanceof Error ? reason.message : "The view could not be deleted."); }
    finally { if (isCurrentScope()) setBusy(false); }
  };
  const newView = () => { if (!isCurrentScope()) return; setSelected(""); setName(""); setFavorite(false); setScheduled(false); setMessage(""); };
  if (loadedScopeKey !== scopeKey) return <section className="savedViewsPanel" aria-label="Saved report views"><p role="status">{message || "Loading saved views…"}</p></section>;
  return <section className="savedViewsPanel" aria-label="Saved report views">
    <div className="savedViewsHead">
      <div><b>Saved view</b><small>{access === "premium" ? canSchedule ? "Unlimited named views, favorites, and delivery" : "Unlimited personal named views and favorites" : "One saved view for this report"}</small></div>
      <select value={selected} onChange={(event) => choose(event.target.value)}><option value="">Current filters</option>{views.map((view) => <option key={view.id} value={view.id}>{view.is_favorite ? "★ " : ""}{view.name}</option>)}</select>
      {access === "premium" && <button type="button" className="tableButton" onClick={newView}>New</button>}
    </div>
    {access === "premium" && <div className="savedViewsOptions">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Friday coverage gaps" /></label>
      <label><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /> Favorite</label>
      {canSchedule && <label><input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} /> Scheduled delivery</label>}
      {canSchedule && scheduled && <>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as "weekly" | "monthly")}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label>{frequency === "weekly" ? "Weekday" : "Day of month"}<input type="number" min={frequency === "weekly" ? 0 : 1} max={frequency === "weekly" ? 6 : 28} value={sendDay} onChange={(event) => setSendDay(Number(event.target.value))} /></label>
      </>}
    </div>}
    <div className="savedViewsActions">
      <button type="button" className="secondary" disabled={busy || (access === "premium" && !name.trim())} onClick={() => void save()}>{busy ? "Saving…" : selected ? "Update view" : "Save current filters"}</button>
      {access === "premium" && selected && <button type="button" className="tableButton" disabled={busy} onClick={() => void remove()}>Delete</button>}
      <span aria-live="polite">{message}</span>
    </div>
  </section>;
}
