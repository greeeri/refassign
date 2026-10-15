"use client";
import { useEffect, useState } from "react";
import { formatEventDateTime, formatEventTime } from "../lib/event-time";
type Conflict = { id: string; game_number: string; home: {name: string} | null; away: {name: string} | null; levels: {name: string} | null; location: {name: string; city?: string | null; state?: string | null} | null; starts_at: string; duration_minutes: number; conflict_type: string; overlap_minutes: number };
type Details = { status: string; reason: string | null; time_tbd: boolean; field_tbd: boolean; conflict_hold: boolean; conflicts: Conflict[] };
export default function GameHoldDetails({ organizationId, gameId }: { organizationId: string; gameId: string }) {
  const [data, setData] = useState<Details | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void fetch(`/api/games/hold-details?organizationId=${encodeURIComponent(organizationId)}&gameId=${encodeURIComponent(gameId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to check hold details."); return result; })
      .then(setData).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [organizationId, gameId]);
  return <div className="assignmentHoldReason assignmentHoldReasonDetail">
    <strong>Why this game is on hold</strong>
    {error ? <p role="alert">{error}</p> : !data ? <p>Checking saved hold information and current schedule overlaps…</p> : data.status !== "suspended" ? <p>This game is no longer on hold. Refresh the game list.</p> : <>
      {data.conflicts.length > 0 && <><p>Resolve {data.conflicts.length === 1 ? "this overlap" : "these overlaps"} before activating:</p><ul>{data.conflicts.map(c => <li key={c.id}>
        <strong>{c.home?.name || "TBD"} vs {c.away?.name || "TBD"} · {c.levels?.name || "Level TBD"}</strong><br />
        {formatEventDateTime(c.starts_at, c.location)}–{formatEventTime(new Date(new Date(c.starts_at).getTime() + (c.duration_minutes || 110) * 60000).toISOString(), c.location)}<br />
        {c.location?.name || "Venue TBD"} · {c.conflict_type} · <strong>{c.overlap_minutes}-minute overlap</strong><br />
        <small>Game #{c.game_number}</small>
      </li>)}</ul></>}
      {data.reason && <p><strong>Saved hold information:</strong> {data.reason}</p>}
      {!data.conflicts.length && !data.reason && <p>No explanation was saved for this hold. Current checks found no missing start time, missing venue, or overlapping games in your accessible schedule. An assignor needs to confirm why it was held.</p>}
      {!data.conflicts.length && data.conflict_hold && <p>No current overlap was found in your accessible schedule. The conflict hold remains until an assignor verifies it is resolved.</p>}
    </>}
  </div>;
}
