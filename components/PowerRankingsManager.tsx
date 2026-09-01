"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Choice = { id: string; name: string };
type Team = {
  id: string;
  name: string;
  sport_id: string | null;
  level_id: string | null;
  active: boolean;
};
type Power = { team_id: string; power: number };

export default function PowerRankingsManager() {
  const supabase = useMemo(() => createClient(), []);
  const [teams, setTeams] = useState<Team[]>([]),
    [sports, setSports] = useState<Choice[]>([]),
    [levels, setLevels] = useState<Choice[]>([]),
    [powers, setPowers] = useState<Record<string, number>>({}),
    [sportFilter, setSportFilter] = useState(""),
    [levelFilter, setLevelFilter] = useState(""),
    [search, setSearch] = useState(""),
    [saving, setSaving] = useState(""),
    [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");

  async function load() {
    setError("");
    const { data: roles, error: rolesError } = await supabase.rpc(
      "current_user_roles",
    );
    if (rolesError) {
      setError(rolesError.message);
      return;
    }
    const canManage = ((roles || []) as string[]).some((role) =>
      ["admin", "assignor"].includes(role),
    );
    setAllowed(canManage);
    if (!canManage) return;
    const [teamResult, powerResult, sportResult, levelResult] =
      await Promise.all([
        supabase
          .from("teams")
          .select("id,name,sport_id,level_id,active")
          .order("name"),
        supabase.from("team_power_rankings").select("team_id,power"),
        supabase.from("sports").select("id,name").eq("active", true).order("name"),
        supabase.from("levels").select("id,name").eq("active", true).order("name"),
      ]);
    const loadError =
      teamResult.error ||
      powerResult.error ||
      sportResult.error ||
      levelResult.error;
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const powerMap: Record<string, number> = {};
    ((powerResult.data || []) as Power[]).forEach((item) => {
      powerMap[item.team_id] = Number(item.power);
    });
    setTeams((teamResult.data || []) as Team[]);
    setPowers(powerMap);
    setSports((sportResult.data || []) as Choice[]);
    setLevels((levelResult.data || []) as Choice[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePower(teamId: string) {
    const power = powers[teamId] ?? 1;
    if (!Number.isFinite(power) || power < 1 || power > 10) {
      setError("Power ranking must be between 1.0 and 10.0.");
      return;
    }
    setSaving(teamId);
    setError("");
    setMessage("");
    const { error: saveError } = await supabase.rpc("set_team_power", {
      p_team_id: teamId,
      p_power: Math.round(power * 10) / 10,
    });
    if (saveError) setError(saveError.message);
    else setMessage("Power ranking saved and assignment priority updated.");
    setSaving("");
  }

  const filtered = teams
    .filter((team) => !sportFilter || team.sport_id === sportFilter)
    .filter((team) => !levelFilter || team.level_id === levelFilter)
    .filter((team) => team.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort(
      (a, b) =>
        (powers[b.id] ?? 1) - (powers[a.id] ?? 1) ||
        a.name.localeCompare(b.name),
    );

  if (!allowed && !error)
    return (
      <section className="card">
        <h2>Power Rankings</h2>
        <p>Only Administrators and Assignors can manage team power rankings.</p>
      </section>
    );

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Power Rankings</h2>
          <p>
            Rank teams from 1.0–10.0. Higher-powered games receive greater
            priority when the Assignment Center orders games.
          </p>
        </div>
        <span className="badge blue">{filtered.length} Teams</span>
      </div>
      <div className="toolbar">
        <input
          aria-label="Search teams"
          placeholder="Search teams"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Filter by sport"
          value={sportFilter}
          onChange={(event) => setSportFilter(event.target.value)}
        >
          <option value="">All Sports</option>
          {sports.map((sport) => (
            <option key={sport.id} value={sport.id}>
              {sport.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by level"
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
        >
          <option value="">All Levels</option>
          {levels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {message && <div className="loginMessage">{message}</div>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Sport</th>
              <th>Level</th>
              <th>Power</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((team, index) => (
              <tr key={team.id}>
                <td>
                  <b>#{index + 1}</b>
                </td>
                <td>
                  <b>{team.name}</b>
                </td>
                <td>
                  {sports.find((sport) => sport.id === team.sport_id)?.name || "—"}
                </td>
                <td>
                  {levels.find((level) => level.id === team.level_id)?.name || "—"}
                </td>
                <td>
                  <input
                    aria-label={`Power ranking for ${team.name}`}
                    type="number"
                    min="1"
                    max="10"
                    step="0.1"
                    value={powers[team.id] ?? 1}
                    disabled={saving === team.id}
                    onChange={(event) =>
                      setPowers((current) => ({
                        ...current,
                        [team.id]: Number(event.target.value),
                      }))
                    }
                    onBlur={() => void savePower(team.id)}
                    style={{ width: 90 }}
                  />
                </td>
                <td>
                  <span className={`badge ${team.active ? "green" : "red"}`}>
                    {team.active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
