"use client";
import { useEffect, useState } from "react";
type Named = { name: string } | null;
type Game = { id: string; game_number: string; starts_at: string; status: string; officials_needed: number; home: Named; away: Named; location: Named; leagues: Named; assignments: { id: string; status: string; published_at: string | null; officials: { first_name: string; last_name: string } | null; sport_positions: Named }[] };
export default function ReadOnlyAssignments({ organizationId }: { organizationId: string }) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0,10));
  const [offset, setOffset] = useState(0), [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setGames([]);
    fetch(`/api/assignments/read-only?${new URLSearchParams({ organizationId, from, offset: String(offset) })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not load assignments."); return result; })
      .then(result => { setGames(result.games); setHasMore(result.hasMore); })
      .catch(problem => { if (!controller.signal.aborted) setError(problem.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, from, offset]);
  return <section className="card">
    <h2>Assignments <small>— Read only</small></h2>
    <p>Games and assigned officials for the leagues your administrator has granted you access to.</p>
    <label>Games starting from<input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} /></label>
    {error && <p className="errorBox" role="alert">{error}</p>}
    {loading ? <p>Loading assignments…</p> : !error && <>
      {!games.length && <p>No games found for your selected date and permitted leagues.</p>}
      {games.map(game => <article className="card" key={game.id} style={{ marginTop: 12 }}>
        <h3>{game.home?.name || "TBD"} vs {game.away?.name || "TBD"}</h3>
        <p>{new Date(game.starts_at).toLocaleString()} · {game.location?.name || "Venue TBD"}</p>
        <p>{game.leagues?.name} · Game {game.game_number} · {game.status.replaceAll("_", " ")}</p>
        <ul>{game.assignments.map(a => <li key={a.id}><strong>{a.sport_positions?.name || "Official"}:</strong> {a.officials ? `${a.officials.first_name} ${a.officials.last_name}` : "Unassigned"} — {a.published_at ? a.status : "Not published"}</li>)}</ul>
        <p>{Math.max(0, game.officials_needed - game.assignments.filter(a => !["declined", "cancelled"].includes(a.status)).length)} open positions</p>
      </article>)}
      <div className="headerActions"><button type="button" className="secondary" disabled={offset===0} onClick={() => setOffset(value => Math.max(0,value-50))}>Previous</button><button type="button" className="secondary" disabled={!hasMore} onClick={() => setOffset(value => value+50)}>Next</button></div>
    </>}
  </section>;
}
