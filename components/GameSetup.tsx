"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import TeamsRosterManager from "./TeamsRosterManager";
import LocationsRosterManager from "./LocationsRosterManager";
type Sport = { id: string; name: string };
type Level = { id: string; name: string; officials_needed: number };
type League = { id: string; name: string };
type Team = {
  id: string;
  name: string;
  sport_id: string | null;
  level_id: string | null;
  level: string | null;
};
type Power = { team_id: string; power: number };
type Location = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  directions: string | null;
  parking_instructions: string | null;
  entrance_information: string | null;
  map_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};
type View = "Leagues" | "Levels" | "Teams" | "Locations";
export default function GameSetup({ view }: { view: View }) {
  const supabase = useMemo(() => createClient(), []);
  const [allowed, setAllowed] = useState(false),
    [sports, setSports] = useState<Sport[]>([]),
    [levels, setLevels] = useState<Level[]>([]),
    [leagues, setLeagues] = useState<League[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [powers, setPowers] = useState<Record<string, number>>({}),
    [locations, setLocations] = useState<Location[]>([]);
  const [levelName, setLevelName] = useState(""),
    [levelOfficials, setLevelOfficials] = useState("3"),
    [leagueName, setLeagueName] = useState(""),
    [team, setTeam] = useState({ name: "", sport_id: "", level_id: "" }),
    [location, setLocation] = useState({
      name: "",
      address: "",
      city: "",
      state: "IA",
      directions: "",
      parking_instructions: "",
      entrance_information: "",
      map_url: "",
      contact_name: "",
      contact_phone: "",
      contact_email: "",
    });
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null),
    [editingLocationId, setEditingLocationId] = useState<string | null>(null),
    [savingPower, setSavingPower] = useState(""),
    [showTeamImport, setShowTeamImport] = useState(false),
    [showLocationImport, setShowLocationImport] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setError("");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: p } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", u.user.id)
      .maybeSingle();
    const ok = ["admin", "assignor"].includes(p?.role || "");
    setAllowed(ok);
    if (!ok) return;
    const [s, l, lg, t, loc, pw] = await Promise.all([
      supabase
        .from("sports")
        .select("id,name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("levels")
        .select("id,name,officials_needed")
        .eq("active", true)
        .order("name"),
      supabase
        .from("leagues")
        .select("id,name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("teams")
        .select("id,name,sport_id,level_id,level")
        .order("name"),
      supabase
        .from("locations")
        .select(
          "id,name,address,city,state,directions,parking_instructions,entrance_information,map_url,contact_name,contact_phone,contact_email",
        )
        .eq("active", true)
        .order("name"),
      supabase.from("team_power_rankings").select("team_id,power"),
    ]);
    const err =
      s.error || l.error || lg.error || t.error || loc.error || pw.error;
    if (err) setError(err.message);
    else {
      const powerMap: Record<string, number> = {};
      ((pw.data || []) as Power[]).forEach((item) => {
        powerMap[item.team_id] = Number(item.power);
      });
      setSports(s.data || []);
      setLevels((l.data || []) as Level[]);
      setLeagues(lg.data || []);
      setTeams(t.data || []);
      setPowers(powerMap);
      setLocations((loc.data || []) as Location[]);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function addLevel(e: FormEvent) {
    e.preventDefault();
    const n = Number(levelOfficials);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      setError("Officials Needed must be a whole number from 1-20.");
      return;
    }
    const r = await supabase
      .from("levels")
      .insert({ name: levelName.trim(), officials_needed: n });
    if (r.error) setError(r.error.message);
    else {
      setLevelName("");
      setLevelOfficials("3");
      load();
    }
  }
  async function updateOfficialsNeeded(id: string, value: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      setError("Officials Needed must be a whole number from 1-20.");
      return;
    }
    const r = await supabase
      .from("levels")
      .update({ officials_needed: n })
      .eq("id", id);
    if (r.error) setError(r.error.message);
    else load();
  }
  async function addLeague(e: FormEvent) {
    e.preventDefault();
    const r = await supabase
      .from("leagues")
      .insert({ name: leagueName.trim() });
    if (r.error) setError(r.error.message);
    else {
      setLeagueName("");
      load();
    }
  }
  async function saveTeam(e: FormEvent) {
    e.preventDefault();
    const level = levels.find((l) => l.id === team.level_id);
    const payload = {
      name: team.name.trim(),
      sport_id: team.sport_id,
      level_id: team.level_id,
      level: level?.name || null,
    };
    const r = editingTeamId
      ? await supabase.from("teams").update(payload).eq("id", editingTeamId)
      : await supabase.from("teams").insert(payload);
    if (r.error) setError(r.error.message);
    else {
      setTeam({ name: "", sport_id: "", level_id: "" });
      setEditingTeamId(null);
      load();
    }
  }
  function editTeam(t: Team) {
    setEditingTeamId(t.id);
    setTeam({
      name: t.name,
      sport_id: t.sport_id || "",
      level_id: t.level_id || "",
    });
  }
  async function savePower(teamId: string) {
    const power = powers[teamId] ?? 1;
    if (!Number.isFinite(power) || power < 1 || power > 10) {
      setError("Power ranking must be between 1.0 and 10.0.");
      return;
    }
    setSavingPower(teamId);
    setError("");
    const { error: e } = await supabase.rpc("set_team_power", {
      p_team_id: teamId,
      p_power: Math.round(power * 10) / 10,
    });
    if (e) setError(e.message);
    setSavingPower("");
  }
  async function saveLocation(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: location.name.trim(),
      level_id: null,
      address: location.address.trim() || null,
      city: location.city.trim() || null,
      state: location.state.trim() || null,
      directions: location.directions.trim() || null,
      parking_instructions: location.parking_instructions.trim() || null,
      entrance_information: location.entrance_information.trim() || null,
      map_url: location.map_url.trim() || null,
      contact_name: location.contact_name.trim() || null,
      contact_phone: location.contact_phone.trim() || null,
      contact_email: location.contact_email.trim() || null,
    };
    const r = editingLocationId
      ? await supabase
          .from("locations")
          .update(payload)
          .eq("id", editingLocationId)
      : await supabase.from("locations").insert(payload);
    if (r.error) setError(r.error.message);
    else {
      setLocation({
        name: "",
        address: "",
        city: "",
        state: "IA",
        directions: "",
        parking_instructions: "",
        entrance_information: "",
        map_url: "",
        contact_name: "",
        contact_phone: "",
        contact_email: "",
      });
      setEditingLocationId(null);
      load();
    }
  }
  function editLocation(v: Location) {
    setEditingLocationId(v.id);
    setLocation({
      name: v.name,
      address: v.address || "",
      city: v.city || "",
      state: v.state || "",
      directions: v.directions || "",
      parking_instructions: v.parking_instructions || "",
      entrance_information: v.entrance_information || "",
      map_url: v.map_url || "",
      contact_name: v.contact_name || "",
      contact_phone: v.contact_phone || "",
      contact_email: v.contact_email || "",
    });
  }
  async function remove(
    table: "levels" | "leagues" | "teams" | "locations",
    id: string,
  ) {
    if (
      !confirm(
        "Remove this setup option? Existing records may prevent deletion.",
      )
    )
      return;
    const r = await supabase.from(table).delete().eq("id", id);
    if (r.error) setError(r.error.message);
    else load();
  }
  const rankedTeams = [...teams].sort(
    (a, b) =>
      (powers[b.id] ?? 1) - (powers[a.id] ?? 1) || a.name.localeCompare(b.name),
  );
  if (!allowed)
    return (
      <section className="card">
        <h2>{view}</h2>
        <p>Only Administrators and Assignors can manage Game Setup.</p>
      </section>
    );
  return (
    <>
      {error && <div className="errorBox">{error}</div>}
      {view === "Leagues" && (
        <section className="card">
          <h2>Leagues</h2>
          <form className="toolbar" onSubmit={addLeague}>
            <input
              required
              placeholder="Example: Iowa Soccer League"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
            />
            <button className="primary">Add League</button>
          </form>
          <div className="tableWrap">
            <table>
              <tbody>
                {leagues.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                    </td>
                    <td>
                      <button
                        className="tableButton"
                        onClick={() => remove("leagues", l.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "Levels" && (
        <section className="card">
          <h2>Levels</h2>
          <p>
            Set the required number of officials independently for each game
            level.
          </p>
          <form className="toolbar" onSubmit={addLevel}>
            <input
              required
              placeholder="Example: U19"
              value={levelName}
              onChange={(e) => setLevelName(e.target.value)}
            />
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              required
              title="Officials Needed"
              value={levelOfficials}
              onChange={(e) => setLevelOfficials(e.target.value)}
            />
            <button className="primary">Add Level</button>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Officials Needed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {levels.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="1"
                        defaultValue={l.officials_needed}
                        onBlur={(e) =>
                          updateOfficialsNeeded(l.id, e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="tableButton"
                        onClick={() => remove("levels", l.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "Teams" && (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Teams & Power Rankings</h2>
              <p>
                Manage teams and rank each one from 1.0–10.0. Higher-powered
                games receive greater assignment priority.
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => setShowTeamImport(!showTeamImport)}
            >
              {showTeamImport ? "Close Team Uploader" : "Team Import / Export"}
            </button>
          </div>
          {showTeamImport && <TeamsRosterManager />}
          <form className="officialForm" onSubmit={saveTeam}>
            <label>
              Team Name
              <input
                required
                value={team.name}
                onChange={(e) => setTeam({ ...team, name: e.target.value })}
              />
            </label>
            <label>
              Sport
              <select
                required
                value={team.sport_id}
                onChange={(e) => setTeam({ ...team, sport_id: e.target.value })}
              >
                <option value="">Select sport</option>
                {sports.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <select
                required
                value={team.level_id}
                onChange={(e) => setTeam({ ...team, level_id: e.target.value })}
              >
                <option value="">Select level</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="formActions">
              {editingTeamId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingTeamId(null);
                    setTeam({ name: "", sport_id: "", level_id: "" });
                  }}
                >
                  Cancel Edit
                </button>
              )}
              <button className="primary">
                {editingTeamId ? "Save Team Changes" : "Add Team"}
              </button>
            </div>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Team</th>
                  <th>Sport</th>
                  <th>Level</th>
                  <th>Power</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rankedTeams.map((t, index) => (
                  <tr key={t.id}>
                    <td>
                      <b>#{index + 1}</b>
                    </td>
                    <td>{t.name}</td>
                    <td>
                      {sports.find((s) => s.id === t.sport_id)?.name || "—"}
                    </td>
                    <td>
                      {levels.find((l) => l.id === t.level_id)?.name ||
                        t.level ||
                        "—"}
                    </td>
                    <td>
                      <input
                        aria-label={`Power ranking for ${t.name}`}
                        type="number"
                        min="1"
                        max="10"
                        step="0.1"
                        value={powers[t.id] ?? 1}
                        disabled={savingPower === t.id}
                        onChange={(e) =>
                          setPowers((current) => ({
                            ...current,
                            [t.id]: Number(e.target.value),
                          }))
                        }
                        onBlur={() => void savePower(t.id)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <button
                        className="tableButton"
                        onClick={() => editTeam(t)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        className="tableButton"
                        onClick={() => remove("teams", t.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "Locations" && (
        <section className="card">
          <div className="cardHead">
            <div>
              <h2>Locations</h2>
              <p>
                Manage game locations independently of Level, or bulk update
                them with the uploader.
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => setShowLocationImport(!showLocationImport)}
            >
              {showLocationImport
                ? "Close Location Uploader"
                : "Location Import / Export"}
            </button>
          </div>
          {showLocationImport && <LocationsRosterManager />}
          <form className="officialForm" onSubmit={saveLocation}>
            <label>
              Location Name
              <input
                required
                value={location.name}
                onChange={(e) =>
                  setLocation({ ...location, name: e.target.value })
                }
              />
            </label>
            <label>
              Address
              <input
                value={location.address}
                onChange={(e) =>
                  setLocation({ ...location, address: e.target.value })
                }
              />
            </label>
            <label>
              City
              <input
                value={location.city}
                onChange={(e) =>
                  setLocation({ ...location, city: e.target.value })
                }
              />
            </label>
            <label>
              State
              <input
                value={location.state}
                onChange={(e) =>
                  setLocation({ ...location, state: e.target.value })
                }
              />
            </label>
            <label>
              Preferred Map Link
              <input
                type="url"
                placeholder="https://maps.google.com/…"
                value={location.map_url}
                onChange={(e) =>
                  setLocation({ ...location, map_url: e.target.value })
                }
              />
            </label>
            <label>
              Venue Contact
              <input
                value={location.contact_name}
                onChange={(e) =>
                  setLocation({ ...location, contact_name: e.target.value })
                }
              />
            </label>
            <label>
              Contact Phone
              <input
                type="tel"
                value={location.contact_phone}
                onChange={(e) =>
                  setLocation({ ...location, contact_phone: e.target.value })
                }
              />
            </label>
            <label>
              Contact Email
              <input
                type="email"
                value={location.contact_email}
                onChange={(e) =>
                  setLocation({ ...location, contact_email: e.target.value })
                }
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Field-Specific Directions
              <textarea
                rows={2}
                value={location.directions}
                onChange={(e) =>
                  setLocation({ ...location, directions: e.target.value })
                }
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Parking Instructions
              <textarea
                rows={2}
                value={location.parking_instructions}
                onChange={(e) =>
                  setLocation({
                    ...location,
                    parking_instructions: e.target.value,
                  })
                }
              />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Entrance Information
              <textarea
                rows={2}
                value={location.entrance_information}
                onChange={(e) =>
                  setLocation({
                    ...location,
                    entrance_information: e.target.value,
                  })
                }
              />
            </label>
            <div className="formActions">
              {editingLocationId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingLocationId(null);
                    setLocation({
                      name: "",
                      address: "",
                      city: "",
                      state: "IA",
                      directions: "",
                      parking_instructions: "",
                      entrance_information: "",
                      map_url: "",
                      contact_name: "",
                      contact_phone: "",
                      contact_email: "",
                    });
                  }}
                >
                  Cancel Edit
                </button>
              )}
              <button className="primary">
                {editingLocationId ? "Save Location Changes" : "Add Location"}
              </button>
            </div>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Address</th>
                  <th>Venue Details</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {locations.map((v) => (
                  <tr key={v.id}>
                    <td>{v.name}</td>
                    <td>
                      {[v.address, v.city, v.state].filter(Boolean).join(", ")}
                    </td>
                    <td>
                      {[v.directions && "Directions", v.parking_instructions && "Parking", v.entrance_information && "Entrance", (v.contact_name || v.contact_phone || v.contact_email) && "Contact"]
                        .filter(Boolean)
                        .join(" • ") || "Not added"}
                    </td>
                    <td>
                      <button
                        className="tableButton"
                        onClick={() => editLocation(v)}
                      >
                        Edit
                      </button>{" "}
                      <button
                        className="tableButton"
                        onClick={() => remove("locations", v.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
