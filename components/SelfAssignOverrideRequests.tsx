"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

export default function SelfAssignOverrideRequests({ organizationId }: { organizationId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState<any[]>([]);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const requestedId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("override") || "";
  async function load() {
    const { data, error: loadError } = await supabase.from("self_assign_override_requests").select(
      "id,eligibility_reason,requested_at,officials(first_name,last_name),assignment_self_assign_slots(sport_positions(name),games(game_number,starts_at,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)))",
    ).eq("organization_id", organizationId).eq("status", "pending").order("requested_at");
    if (loadError) setError(loadError.message); else setRequests(data || []);
  }
  useEffect(() => { void load(); }, [organizationId]);
  useEffect(() => {
    if (requestedId && requests.some((request) => request.id === requestedId)) {
      document.getElementById(`override-${requestedId}`)?.scrollIntoView({ block: "center" });
    }
  }, [requestedId, requests]);
  async function review(id: string, approve: boolean) {
    if (approve && !window.confirm("Approve this eligibility override and confirm the official on the assignment?")) return;
    setWorking(id); setError("");
    try {
      const response = await fetch("/api/assignments/self-assign-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id, approve }) });
      const result = await response.json();
      if (!response.ok) setError(result.error || "Unable to review the request.");
      else { await load(); if (result.warning) setError(result.warning); }
    } catch { setError("Unable to review the request. Please try again."); }
    setWorking("");
  }
  if (!requests.length && !error) return null;
  return <section className="card" style={{ borderColor: "#f59e0b", marginBottom: 14 }}>
    <div className="cardHead"><div><h3>Eligibility Override Requests</h3><p>Review officials who requested an open position they are not currently eligible for.</p></div><span className="badge yellow">{requests.length} pending</span></div>
    {error && <div className="errorBox">{error}</div>}
    <div style={{ display: "grid", gap: 8 }}>
      {requests.map((request) => {
        const official = Array.isArray(request.officials) ? request.officials[0] : request.officials;
        const slot = Array.isArray(request.assignment_self_assign_slots) ? request.assignment_self_assign_slots[0] : request.assignment_self_assign_slots;
        const game = Array.isArray(slot?.games) ? slot.games[0] : slot?.games;
        const position = Array.isArray(slot?.sport_positions) ? slot.sport_positions[0] : slot?.sport_positions;
        const home = Array.isArray(game?.home) ? game.home[0] : game?.home;
        const away = Array.isArray(game?.away) ? game.away[0] : game?.away;
        return <article key={request.id} id={`override-${request.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: 12, border: requestedId === request.id ? "2px solid #2563eb" : "1px solid #fde68a", borderRadius: 9, background: "#fffbeb" }}>
          <div><b>{official?.first_name} {official?.last_name}</b><small style={{ display: "block" }}>Game #{game?.game_number} · {home?.name || "TBD"} vs {away?.name || "TBD"} · {position?.name || "Position"}</small><small style={{ display: "block", color: "#92400e" }}>{request.eligibility_reason}</small></div>
          <div style={{ display: "flex", gap: 7 }}><button className="secondary" disabled={working === request.id} onClick={() => void review(request.id, false)}>Deny</button><button className="success" disabled={working === request.id} onClick={() => void review(request.id, true)}>{working === request.id ? "Working…" : "Approve Override"}</button></div>
        </article>;
      })}
    </div>
  </section>;
}
