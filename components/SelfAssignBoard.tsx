"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Slot = {
  organization_id: string;
  organization_name: string;
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

type Props = {
  organizationIds: string[];
  organizationNames: Record<string, string>;
};

export default function SelfAssignBoard({
  organizationIds,
  organizationNames,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    if (!organizationIds.length) {
      setSlots([]);
      setLoading(false);
      return;
    }
    const results = await Promise.all(
      organizationIds.map(async (organizationId) => {
        const result = await supabase.rpc("list_my_self_assign_positions", {
          p_organization_id: organizationId,
        });
        return { organizationId, ...result };
      }),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      setSlots([]);
      setError(failed.error.message);
    } else
      setSlots(
        results
          .flatMap((result) =>
            ((result.data || []) as Omit<Slot, "organization_id" | "organization_name">[]).map(
              (slot) => ({
                ...slot,
                organization_id: result.organizationId,
                organization_name:
                  organizationNames[result.organizationId] || "Organization",
              }),
            ),
          )
          .sort(
            (a, b) =>
              new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
          ),
      );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationIds, organizationNames, supabase]);

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
      {
        p_slot_id: slot.slot_id,
        p_organization_id: slot.organization_id,
      },
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
      ) : (
        <>
          <div className="selfAssignOrganizationSummary">
            {organizationIds.map((organizationId) => {
              const available = slots.filter(
                (slot) => slot.organization_id === organizationId,
              ).length;
              return (
                <div className="selfAssignOrganizationStatus" key={organizationId}>
                  <b>{organizationNames[organizationId] || "Organization"}</b>
                  <span className={available ? "badge green" : "badge gray"}>
                    {available} available to you
                  </span>
                  {!available && (
                    <small>
                      No qualified, conflict-free Self Assign positions are
                      currently available for your account.
                    </small>
                  )}
                </div>
              );
            })}
          </div>
          {slots.length ? (
            <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Game</th>
                {organizationIds.length > 1 && <th>Organization</th>}
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
                    {organizationIds.length > 1 && (
                      <td>{slot.organization_name}</td>
                    )}
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
              <h3>No Self Assign positions are available to you</h3>
              <p>
                A position can be open to other officials but hidden from your
                account when you do not match its qualifications or already
                have an overlapping game.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
