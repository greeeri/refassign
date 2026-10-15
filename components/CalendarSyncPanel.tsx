"use client";
import { useCallback, useEffect, useState } from "react";
type Feed = { id: string; name: string; enabled: boolean; bootstrapped: boolean; last_success_at: string | null; next_run_at: string; last_error: string | null; event_count: number; lease_until: string | null };
type Run = { id: string; feed_id: string; status: string; games_added: number; games_updated: number; games_removed: number; games_held: number; assigned_games_affected: number; started_at: string; error: string | null };
type Change = { id: string; uid: string; kind: string; before_source: Record<string, string> | null; after_source: Record<string, string> | null; details: string; assignments_affected: number };
const when = (v: string | null) => v ? new Date(v).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "Not checked yet";
export default function CalendarSyncPanel({ organizationId, leagueId, onSynced }: { organizationId: string; leagueId: string; onSynced?: () => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([]), [runs, setRuns] = useState<Run[]>([]), [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState<string | null>(null), [open, setOpen] = useState(false);
  const endpoint = `/api/calendar-sync?organizationId=${encodeURIComponent(organizationId)}&leagueId=${encodeURIComponent(leagueId)}`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to check calendar status.");
      setFeeds(data.feeds || []); setRuns(data.runs || []); setChanges(data.changes || []); setError("");
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Unable to check calendar status."); }
  }, [endpoint]);
  useEffect(() => { const c = new AbortController(); setFeeds([]);setRuns([]);setChanges([]);void refresh(c.signal); return () => c.abort(); }, [refresh]);
  useEffect(() => { if (!open) return; const timer = setInterval(() => void refresh(), 60000); return () => clearInterval(timer); }, [open, refresh]);
  async function run(feed: Feed) {
    if (busy) return; setBusy(feed.id);setNotice("");setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id }) });
      const data = await response.json(); if (!response.ok || data.failed) throw new Error(data.error || "Calendar check failed.");
      setNotice(data.skipped ? "This calendar is already running or was just checked. Refresh its status shortly." : `${feed.name}: ${data.added} added, ${data.updated} updated, ${data.removed} removed from source, ${data.held} held for review.`);
      await refresh(); if (!data.skipped) onSynced?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Calendar check failed."); await refresh(); }
    finally { setBusy(null); }
  }
  if (!feeds.length && !error) return null;
  const overdue = (f: Feed) => f.enabled && f.bootstrapped && new Date(f.next_run_at).getTime() < Date.now() - 2 * 3600000 && !(f.lease_until && new Date(f.lease_until).getTime() > Date.now());
  const failures = feeds.filter(f => f.last_error || overdue(f));
  return <details className="calendarSyncPanel" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Calendar sync{failures.length > 0 && <span className="calendarSyncFailure">{failures.length} calendar{failures.length === 1 ? " needs" : "s need"} attention</span>}</summary>
    <p>Automatic checks run daily at 8:00 AM Central. New and changed games are marked NEW until an assignor checks Reviewed. Existing holds, crews and billing choices are preserved.</p>
    {error && <p role="alert" className="calendarSyncError">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="calendarSyncFeeds">{feeds.map(f => <div key={f.id} className="calendarSyncFeed">
      <strong>{f.name}</strong><span>{f.event_count} source games · {f.enabled ? "Enabled" : "Paused"}</span>
      <span>Last successful check: {when(f.last_success_at)}</span><span>Next check: {when(f.next_run_at)}</span>
      {f.last_error && <span role="alert" className="calendarSyncError">Check failed: {f.last_error} The last successful schedule is retained; a retry is scheduled.</span>}
      {!f.last_error && overdue(f) && <span role="alert" className="calendarSyncError">The scheduled check is overdue. The saved schedule is retained; use Run now to retry.</span>}
      <button type="button" className="secondary" disabled={Boolean(busy) || !f.enabled || !f.bootstrapped || Boolean(f.lease_until && new Date(f.lease_until).getTime() > Date.now())} onClick={() => void run(f)}>{busy === f.id ? "Checking…" : "Run now"}</button>
    </div>)}</div>
    <details><summary>Recent checks ({runs.length})</summary><div className="calendarSyncTable"><table><thead><tr><th>Calendar</th><th>Checked</th><th>Result</th><th>Added</th><th>Updated</th><th>Removed</th><th>Held</th><th>Assigned games affected</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td>{feeds.find(f => f.id === r.feed_id)?.name || "Calendar"}</td><td>{when(r.started_at)}</td><td>{r.status}{r.error && <span className="calendarSyncError">: {r.error}</span>}</td><td>{r.games_added}</td><td>{r.games_updated}</td><td>{r.games_removed}</td><td>{r.games_held}</td><td>{r.assigned_games_affected}</td></tr>)}</tbody></table></div></details>
    {changes.length > 0 && <details><summary>Recent game changes ({changes.length})</summary><ul>{changes.map(c => <li key={c.id}><strong>{c.after_source?.matchup || c.before_source?.matchup || "Game"}</strong>{" "}{c.after_source?.level || c.before_source?.level} — {c.kind}.
      {c.before_source && c.after_source && Object.keys(c.after_source).filter(k => c.before_source?.[k] !== c.after_source?.[k]).map(k => <span key={k}> {k === "matchup" ? "Teams" : k === "end" ? "End time" : k[0].toUpperCase() + k.slice(1)}: {c.before_source?.[k] || "TBD"} → {c.after_source?.[k] || "TBD"}.</span>)}
      <span> {c.details}</span>{c.assignments_affected > 0 && <strong className="calendarSyncAssigned"> {c.assignments_affected} assigned official{c.assignments_affected === 1 ? "" : "s"} affected—review the changed schedule.</strong>}
    </li>)}</ul></details>}
  </details>;
}
