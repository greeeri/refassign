"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Slot = {
  slot_id: string;
  game_id: string;
  game_number: string;
  starts_at: string;
  duration_minutes: number;
  game_status: string;
  position_id: string;
  position_name: string;
  league_name: string | null;
  level_name: string | null;
  home_team: string | null;
  away_team: string | null;
  location_name: string | null;
  location_city: string | null;
  location_state: string | null;
};

export default function SelfAssignBoard() {
  const supabase = useMemo(() => createClient(), []);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase.rpc(
      "list_my_self_assign_positions",
    );
    if (loadError) setError(loadError.message);
    else setSlots((data || []) as Slot[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [supabase]);

  async function claim(slot: Slot) {
    if (
      !window.confirm(
        `Self assign as ${slot.position_name} for ${slot.home_team || "TBD"} vs ${slot.away_team || "TBD"}?`,
      )
    )
      return;
    setClaiming(slot.slot_id);
    setError("");
    setNotice("");
    const { error: claimError } = await supabase.rpc(
      "claim_self_assign_position",
      { p_slot_id: slot.slot_id },
    );
    if (claimError) setError(claimError.message);
    else setNotice("The game has been added to My Schedule as an accepted assignment.");
    await load();
    setClaiming("");
  }

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Self Assign</h2>
          <p>
            Open positions matching your league and level qualifications. Your
            other availability blocks do not apply; games are hidden only when
            you already have an overlapping game assignment.
          </p>
        </div>
        <button className="secondary" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {notice && <div className="loginMessage">{notice}</div>}
      {loading ? (
        <p>Loading open positions…</p>
      ) : slots.length ? (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Game</th>
                <th>League / Level</th>
                <th>Location</th>
                <th>Position</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => {
                const starts = new Date(slot.starts_at);
                return (
                  <tr key={slot.slot_id}>
                    <td>
                      <b>{starts.toLocaleDateString()}</b>
                      <small>
                        {starts.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </small>
                    </td>
                    <td>
                      <b>
                        {slot.home_team || "TBD"} vs {slot.away_team || "TBD"}
                      </b>
                      <small>{slot.game_number}</small>
                    </td>
                    <td>
                      {slot.league_name || "Any league"}
                      <small>{slot.level_name || "Any level"}</small>
                    </td>
                    <td>
                      {slot.location_name || "TBD"}
                      {(slot.location_city || slot.location_state) && (
                        <small>
                          {[slot.location_city, slot.location_state]
                            .filter(Boolean)
                            .join(", ")}
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="badge green">{slot.position_name}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="success"
                        disabled={claiming === slot.slot_id}
                        onClick={() => void claim(slot)}
                      >
                        {claiming === slot.slot_id ? "Claiming…" : "Self Assign"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="emptyState">
          <h3>No Self Assign positions are open</h3>
          <p>New qualified positions will appear here when an assignor opens them.</p>
        </div>
      )}
    </section>
  );
}
