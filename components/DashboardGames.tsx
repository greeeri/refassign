"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Game = {
  id: string;
  game_number: string;
  starts_at: string;
  duration_minutes: number;
  officials_needed: number;
  status: string;
  home: { name: string } | null;
  away: { name: string } | null;
  location: { name: string } | null;
  leagues: { name: string } | null;
  levels: { name: string } | null;
};
type Assignment = {
  id: string;
  game_id: string;
  official_id: string;
  status: string;
  published_at: string | null;
  officials: { first_name: string; last_name: string } | null;
  sport_positions: { name: string } | null;
};
type ImportError = {
  id: number;
  error_message: string;
  row_number: number | null;
  created_at: string;
};
type Focus =
  | "needs"
  | "unconfirmed"
  | "declined"
  | "hold"
  | "cancelled"
  | "imports"
  | "conflicts";
const cards: [Focus, string, string][] = [
  ["needs", "Games needing officials", "#dc2626"],
  ["unconfirmed", "Unconfirmed assignments", "#ca8a04"],
  ["declined", "Declined assignments", "#dc2626"],
  ["hold", "Games on hold", "#ca8a04"],
  ["cancelled", "Cancelled / rain outs", "#1e3a8a"],
  ["imports", "Import errors", "#ea580c"],
  ["conflicts", "Upcoming games with conflicts", "#7c3aed"],
];
export default function DashboardGames() {
  const supabase = useMemo(() => createClient(), []),
    [games, setGames] = useState<Game[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [importErrors, setImportErrors] = useState<ImportError[]>([]),
    [focus, setFocus] = useState<Focus>("needs"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [g, a, i] = await Promise.all([
        supabase
          .from("games")
          .select(
            "id,game_number,starts_at,duration_minutes,officials_needed,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name),leagues(name),levels(name)",
          )
          .order("starts_at"),
        supabase
          .from("assignments")
          .select(
            "id,game_id,official_id,status,published_at,officials(first_name,last_name),sport_positions(name)",
          ),
        supabase
          .from("import_error_log")
          .select("id,error_message,row_number,created_at")
          .is("resolved_at", null)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (g.error || a.error || i.error)
        setError((g.error || a.error || i.error)!.message);
      else {
        setGames((g.data || []) as unknown as Game[]);
        setAssignments((a.data || []) as unknown as Assignment[]);
        setImportErrors((i.data || []) as ImportError[]);
      }
      setLoading(false);
    }
    void load();
  }, [supabase]);
  const now = Date.now(),
    future = games.filter((g) => new Date(g.starts_at).getTime() >= now),
    map = new Map(games.map((g) => [g.id, g]));
  function rows(g: Game) {
    return assignments.filter(
      (a) =>
        a.game_id === g.id && !["declined", "cancelled"].includes(a.status),
    );
  }
  const active = future.filter(
      (g) => !["canceled", "rained_out", "suspended"].includes(g.status),
    ),
    needs = active.filter((g) => rows(g).length < g.officials_needed),
    unconfirmed = assignments.filter((a) => {
      const g = map.get(a.game_id);
      return (
        g &&
        new Date(g.starts_at).getTime() >= now &&
        !["canceled", "rained_out"].includes(g.status) &&
        a.published_at &&
        !["accepted", "confirmed", "declined", "cancelled"].includes(a.status)
      );
    }),
    declined = assignments.filter((a) => {
      const g = map.get(a.game_id);
      return (
        g &&
        new Date(g.starts_at).getTime() >= now &&
        !["canceled", "rained_out"].includes(g.status) &&
        a.status === "declined"
      );
    }),
    hold = future.filter((g) => g.status === "suspended"),
    cancelled = future.filter((g) =>
      ["canceled", "rained_out"].includes(g.status),
    );
  const conflictIds = new Set<string>(),
    conflictDetails = new Map<string, string[]>(),
    byOfficial = new Map<string, Assignment[]>();
  function addConflict(gameId: string, message: string) {
    conflictIds.add(gameId);
    const messages = conflictDetails.get(gameId) || [];
    if (!messages.includes(message))
      conflictDetails.set(gameId, [...messages, message]);
  }
  function matchup(game: Game) {
    return `${game.home?.name || "TBD"} vs ${game.away?.name || "TBD"}`;
  }
  function gameDateTime(game: Game) {
    return new Date(game.starts_at).toLocaleString([], {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  for (const a of assignments) {
    const g = map.get(a.game_id);
    if (
      !g ||
      new Date(g.starts_at).getTime() < now ||
      ["declined", "cancelled"].includes(a.status) ||
      ["canceled", "rained_out"].includes(g.status)
    )
      continue;
    byOfficial.set(a.official_id, [
      ...(byOfficial.get(a.official_id) || []),
      a,
    ]);
  }
  for (const list of byOfficial.values()) {
    list.sort(
      (a, b) =>
        new Date(map.get(a.game_id)!.starts_at).getTime() -
        new Date(map.get(b.game_id)!.starts_at).getTime(),
    );
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const firstAssignment = list[i],
          secondAssignment = list[j],
          first = map.get(firstAssignment.game_id)!,
          second = map.get(secondAssignment.game_id)!,
          firstStart = new Date(first.starts_at).getTime(),
          firstEnd = firstStart + (first.duration_minutes || 110) * 60000,
          secondStart = new Date(second.starts_at).getTime(),
          secondEnd = secondStart + (second.duration_minutes || 110) * 60000;
        if (secondStart >= firstEnd) break;
        const official =
          `${firstAssignment.officials?.first_name || "Assigned official"} ${firstAssignment.officials?.last_name || ""}`.trim();
        if (first.id === second.id) {
          addConflict(
            first.id,
            `${official} is assigned to both ${firstAssignment.sport_positions?.name || "positions"} and ${secondAssignment.sport_positions?.name || "another position"} in this game. Remove the duplicate position assignment.`,
          );
          continue;
        }
        const overlapMinutes = Math.max(
          1,
          Math.ceil((Math.min(firstEnd, secondEnd) - secondStart) / 60000),
        );
        addConflict(
          first.id,
          `${official} (${firstAssignment.sport_positions?.name || "Official"}) is also assigned to ${second.game_number} — ${matchup(second)} (${secondAssignment.sport_positions?.name || "Official"}) at ${gameDateTime(second)}. The games overlap by ${overlapMinutes} minutes; change the official or correct a game time or duration.`,
        );
        addConflict(
          second.id,
          `${official} (${secondAssignment.sport_positions?.name || "Official"}) is also assigned to ${first.game_number} — ${matchup(first)} (${firstAssignment.sport_positions?.name || "Official"}) at ${gameDateTime(first)}. The games overlap by ${overlapMinutes} minutes; change the official or correct a game time or duration.`,
        );
      }
    }
  }
  const unconfirmedGameIds = new Set(unconfirmed.map((a) => a.game_id)),
    declinedGameIds = new Set(declined.map((a) => a.game_id));
  const totals: Record<Focus, number> = {
    needs: needs.length,
    unconfirmed: unconfirmed.length,
    declined: declined.length,
    hold: hold.length,
    cancelled: cancelled.length,
    imports: importErrors.length,
    conflicts: conflictIds.size,
  };
  const visible =
    focus === "needs"
      ? needs
      : focus === "unconfirmed"
        ? future.filter((g) => unconfirmedGameIds.has(g.id))
        : focus === "declined"
          ? future.filter((g) => declinedGameIds.has(g.id))
          : focus === "hold"
            ? hold
            : focus === "cancelled"
              ? cancelled
              : focus === "conflicts"
                ? future.filter((g) => conflictIds.has(g.id))
                : [];
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Action Center</h2>
            <p>Select a total to see the games requiring action.</p>
          </div>
        </div>
        {error && <div className="errorBox">{error}</div>}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(175px,1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          {cards.map(([key, label, color]) => (
            <button
              type="button"
              key={key}
              onClick={() => setFocus(key)}
              style={{
                textAlign: "left",
                padding: 15,
                border: `2px solid ${focus === key ? color : "#e2e8f0"}`,
                borderRadius: 10,
                background: focus === key ? `${color}10` : "#fff",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 28,
                  fontWeight: 900,
                  color,
                }}
              >
                {totals[key]}
              </span>
              <b style={{ fontSize: 12 }}>{label}</b>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>{cards.find(([key]) => key === focus)?.[1]}</h2>
            <p>
              {totals[focus]} item{totals[focus] === 1 ? "" : "s"} currently
              require review.
            </p>
          </div>
        </div>
        {loading ? (
          <p>Loading dashboard…</p>
        ) : focus === "imports" ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Row</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {importErrors.length ? (
                  importErrors.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString()}</td>
                      <td>{e.row_number || "—"}</td>
                      <td>{e.error_message}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No unresolved import errors.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Game</th>
                  <th>League / Level</th>
                  <th>Location</th>
                  <th>Assigned</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((g) => (
                    <tr key={g.id}>
                      <td>
                        {new Date(g.starts_at).toLocaleDateString()}
                        <small>
                          {new Date(g.starts_at).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </small>
                      </td>
                      <td>
                        <b>
                          {g.home?.name || "TBD"} vs {g.away?.name || "TBD"}
                        </b>
                        {focus === "conflicts" &&
                          (conflictDetails.get(g.id) || []).map(
                            (message, index) => (
                              <small className="conflictDetail" key={index}>
                                *{message}*
                              </small>
                            ),
                          )}
                      </td>
                      <td>
                        {g.leagues?.name || "—"}
                        <small>{g.levels?.name || ""}</small>
                      </td>
                      <td>{g.location?.name || "TBD"}</td>
                      <td>
                        {rows(g).length}/{g.officials_needed}
                      </td>
                      <td>
                        <span
                          className={`badge ${g.status === "canceled" ? "red" : g.status === "rained_out" ? "blue" : g.status === "suspended" ? "yellow" : "green"}`}
                        >
                          {g.status === "suspended"
                            ? "Hold"
                            : g.status === "rained_out"
                              ? "Rain Out"
                              : g.status === "canceled"
                                ? "Cancelled"
                                : "Active"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      Nothing currently needs action in this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
