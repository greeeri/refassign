"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Official = { id: string; first_name: string; last_name: string };
type Assignment = { id: string; game_id: string; position_id: string; status: string };
type Game = {
  id: string;
  game_number: string | null;
  starts_at: string;
  leagues: { name: string } | null;
  location: { name: string } | null;
  home: { name: string } | null;
  away: { name: string } | null;
};
type Row = { assignment: Assignment; game: Game; position: string };

export default function DirectoryOfficialSchedule({
  official,
  organizationId,
  onClose,
}: {
  official: Official;
  organizationId?: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const assignments: Assignment[] = [];
      for (let from = 0; ; from += 500) {
        const result = await supabase.from("assignments")
          .select("id,game_id,position_id,status")
          .eq("official_id", official.id)
          .neq("status", "declined")
          .order("id")
          .range(from, from + 499);
        if (result.error) { if (!cancelled) { setError(result.error.message); setLoading(false); } return; }
        assignments.push(...(result.data || []));
        if ((result.data || []).length < 500) break;
      }
      const games: Game[] = [];
      const ids = [...new Set(assignments.map((row) => row.game_id))];
      for (let i = 0; i < ids.length; i += 100) {
        let query = supabase.from("games")
          .select("id,game_number,starts_at,leagues(name),home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name)")
          .in("id", ids.slice(i, i + 100));
        if (organizationId) query = query.eq("organization_id", organizationId);
        const result = await query;
        if (result.error) { if (!cancelled) { setError(result.error.message); setLoading(false); } return; }
        games.push(...(result.data as unknown as Game[] || []));
      }
      const positions = await supabase.from("sport_positions").select("id,name");
      if (positions.error) { if (!cancelled) { setError(positions.error.message); setLoading(false); } return; }
      if (cancelled) return;
      const byGame = new Map(games.map((game) => [game.id, game]));
      const byPosition = new Map((positions.data || []).map((position) => [position.id, String(position.name)]));
      setRows(assignments.flatMap((assignment) => {
        const game = byGame.get(assignment.game_id);
        return game ? [{ assignment, game, position: String(byPosition.get(assignment.position_id) || "—") }] : [];
      }).sort((a, b) => a.game.starts_at.localeCompare(b.game.starts_at)));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [official.id, organizationId, supabase]);

  return (
    <div className="tapAssignOverlay" role="presentation" style={{ zIndex: 1000 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tapAssignDialog" role="dialog" aria-modal="true"
        aria-labelledby="directory-official-schedule-title" style={{ maxWidth: 760 }}>
        <header>
          <div><small>OFFICIAL SCHEDULE</small><h3 id="directory-official-schedule-title">
            {official.first_name} {official.last_name}
          </h3></div>
          <button type="button" aria-label="Close official schedule" onClick={onClose}>×</button>
        </header>
        <div className="tableWrap" style={{ margin: 16 }}>
          {loading ? <p>Loading schedule…</p> : error ? <p role="alert">{error}</p> : (
            <table><thead><tr><th>Date / Time</th><th>Game</th><th>League / Venue</th><th>Position</th><th>Status</th></tr></thead>
              <tbody>{rows.map(({ assignment, game, position }) => (
                <tr key={assignment.id}>
                  <td>{new Date(game.starts_at).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}</td>
                  <td><b>{game.home?.name || "TBD"} vs {game.away?.name || "TBD"}</b><small>Game #{game.game_number}</small></td>
                  <td>{game.leagues?.name || "League not set"}<small>{game.location?.name || "Venue TBD"}</small></td>
                  <td>{position}</td><td>{assignment.status.replaceAll("_", " ")}</td>
                </tr>
              ))}{!rows.length && <tr><td colSpan={5}>No assignments are currently on this official’s schedule.</td></tr>}</tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
