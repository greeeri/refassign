"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Position = {
  id: string;
  sport_id: string;
  name: string;
  sort_order: number;
  required: boolean;
};

type Sport = {
  id: string;
  name: string;
  active: boolean;
  default_officials: number;
  sport_positions: Position[] | null;
};

export default function SportsRulesManager() {
  const supabase = useMemo(() => createClient(), []);
  const [sports, setSports] = useState<Sport[]>([]);
  const [newSport, setNewSport] = useState("");
  const [newPositions, setNewPositions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("sports")
      .select(
        "id,name,active,default_officials,sport_positions(id,sport_id,name,sort_order,required)",
      )
      .order("name")
      .order("sort_order", { referencedTable: "sport_positions" });
    if (loadError) setError(loadError.message);
    else setSports((data || []) as unknown as Sport[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function patchSport(id: string, values: Partial<Sport>) {
    setSports((current) =>
      current.map((sport) =>
        sport.id === id ? { ...sport, ...values } : sport,
      ),
    );
  }

  function patchPosition(
    sportId: string,
    id: string,
    values: Partial<Position>,
  ) {
    setSports((current) =>
      current.map((sport) =>
        sport.id === sportId
          ? {
              ...sport,
              sport_positions: (sport.sport_positions || []).map((position) =>
                position.id === id ? { ...position, ...values } : position,
              ),
            }
          : sport,
      ),
    );
  }

  async function saveSport(sport: Sport) {
    const name = sport.name.trim();
    if (!name) return setError("Sport name is required.");
    setSaving(sport.id);
    setError("");
    setNotice("");
    const { error: saveError } = await supabase
      .from("sports")
      .update({
        name,
        active: sport.active,
        default_officials: Math.max(1, Number(sport.default_officials) || 1),
      })
      .eq("id", sport.id);
    if (saveError) setError(saveError.message);
    else {
      setNotice(`${name} saved.`);
      await load();
    }
    setSaving("");
  }

  async function addSport() {
    const name = newSport.trim();
    if (!name) return setError("Enter a sport name.");
    setSaving("new-sport");
    setError("");
    setNotice("");
    const { error: insertError } = await supabase
      .from("sports")
      .insert({ name, active: true, default_officials: 1 });
    if (insertError) setError(insertError.message);
    else {
      setNewSport("");
      setNotice(`${name} added.`);
      await load();
    }
    setSaving("");
  }

  async function savePosition(position: Position) {
    const name = position.name.trim();
    if (!name) return setError("Position name is required.");
    setSaving(position.id);
    setError("");
    setNotice("");
    const { error: saveError } = await supabase
      .from("sport_positions")
      .update({
        name,
        sort_order: Math.max(0, Number(position.sort_order) || 0),
        required: position.required,
      })
      .eq("id", position.id);
    if (saveError) setError(saveError.message);
    else {
      setNotice(`${name} saved.`);
      await load();
    }
    setSaving("");
  }

  async function addPosition(sport: Sport) {
    const name = (newPositions[sport.id] || "").trim();
    if (!name) return setError("Enter a position name.");
    setSaving(`new-${sport.id}`);
    setError("");
    setNotice("");
    const positions = sport.sport_positions || [];
    const nextOrder = positions.length
      ? Math.max(...positions.map((position) => position.sort_order)) + 1
      : 1;
    const { error: insertError } = await supabase
      .from("sport_positions")
      .insert({
        sport_id: sport.id,
        name,
        sort_order: nextOrder,
        required: true,
      });
    if (insertError) setError(insertError.message);
    else {
      setNewPositions((current) => ({ ...current, [sport.id]: "" }));
      setNotice(`${name} added to ${sport.name}.`);
      await load();
    }
    setSaving("");
  }

  async function removePosition(position: Position) {
    if (
      !window.confirm(
        `Remove ${position.name}? Existing assignments may prevent removal.`,
      )
    )
      return;
    setSaving(position.id);
    setError("");
    setNotice("");
    const { error: deleteError } = await supabase
      .from("sport_positions")
      .delete()
      .eq("id", position.id);
    if (deleteError) {
      setError(
        deleteError.code === "23503"
          ? `${position.name} cannot be removed because it is used by existing assignments. Mark it optional or rename it instead.`
          : deleteError.message,
      );
    } else {
      setNotice(`${position.name} removed.`);
      await load();
    }
    setSaving("");
  }

  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Sports & Rules</h2>
            <p>
              Manage sports, default crew sizes, and the required or optional
              positions used when assigning games.
            </p>
          </div>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        <div className="sportsRuleAdd">
          <label>
            Add Sport
            <input
              value={newSport}
              placeholder="Sport name"
              onChange={(event) => setNewSport(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addSport();
              }}
            />
          </label>
          <button
            className="primary"
            disabled={saving === "new-sport"}
            onClick={() => void addSport()}
          >
            {saving === "new-sport" ? "Adding…" : "Add Sport"}
          </button>
        </div>
      </section>

      {loading ? (
        <section className="card">Loading sports and rules…</section>
      ) : (
        sports.map((sport) => {
          const positions = sport.sport_positions || [];
          const requiredCount = positions.filter(
            (position) => position.required,
          ).length;
          return (
            <section className="card sportRuleCard" key={sport.id}>
              <div className="sportRuleHeader">
                <label>
                  Sport Name
                  <input
                    value={sport.name}
                    onChange={(event) =>
                      patchSport(sport.id, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Default Crew Size
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={sport.default_officials}
                    onChange={(event) =>
                      patchSport(sport.id, {
                        default_officials: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="checkLabel">
                  <input
                    type="checkbox"
                    checked={sport.active}
                    onChange={(event) =>
                      patchSport(sport.id, { active: event.target.checked })
                    }
                  />
                  Active
                </label>
                <span className="badge blue">
                  {requiredCount || sport.default_officials} required
                </span>
                <button
                  className="primary"
                  disabled={saving === sport.id}
                  onClick={() => void saveSport(sport)}
                >
                  {saving === sport.id ? "Saving…" : "Save Sport"}
                </button>
              </div>

              <h3>Assignment Positions</h3>
              <div className="tableWrap">
                <table className="sportPositionsTable">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Position Name</th>
                      <th>Required</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.length ? (
                      positions.map((position) => (
                        <tr key={position.id}>
                          <td>
                            <input
                              aria-label={`Order for ${position.name}`}
                              type="number"
                              min="0"
                              value={position.sort_order}
                              onChange={(event) =>
                                patchPosition(sport.id, position.id, {
                                  sort_order: Number(event.target.value),
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label="Position name"
                              value={position.name}
                              onChange={(event) =>
                                patchPosition(sport.id, position.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <label className="checkLabel">
                              <input
                                type="checkbox"
                                checked={position.required}
                                onChange={(event) =>
                                  patchPosition(sport.id, position.id, {
                                    required: event.target.checked,
                                  })
                                }
                              />
                              {position.required ? "Required" : "Optional"}
                            </label>
                          </td>
                          <td className="headerActions">
                            <button
                              className="primary"
                              disabled={saving === position.id}
                              onClick={() => void savePosition(position)}
                            >
                              {saving === position.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              className="secondary"
                              disabled={saving === position.id}
                              onClick={() => void removePosition(position)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>
                          No positions configured. The default crew size is
                          currently used.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="sportsRuleAdd">
                <label>
                  Add Position
                  <input
                    value={newPositions[sport.id] || ""}
                    placeholder="Position name"
                    onChange={(event) =>
                      setNewPositions((current) => ({
                        ...current,
                        [sport.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void addPosition(sport);
                    }}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={saving === `new-${sport.id}`}
                  onClick={() => void addPosition(sport)}
                >
                  {saving === `new-${sport.id}` ? "Adding…" : "Add Position"}
                </button>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
