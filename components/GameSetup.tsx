"use client";
import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { coordinatesForVenue } from "../lib/client-geocode";
import TeamsRosterManager from "./TeamsRosterManager";
import LocationsRosterManager from "./LocationsRosterManager";
import LeagueDocumentsManager from "./LeagueDocumentsManager";
import SharedDirectorySearch from "./SharedDirectorySearch";
type Sport = { id: string; name: string };
type Level = { id: string; name: string; officials_needed: number };
type MileagePlan = "one_way" | "round_trip" | "actual" | "none";
type League = { id: string; name: string; mileage_plan: MileagePlan };
const mileagePlans: ReadonlyArray<[MileagePlan, string]> = [
  ["one_way", "One-way mileage"],
  ["round_trip", "Round-trip mileage"],
  ["actual", "Actual driving distance"],
  ["none", "No mileage paid"],
];
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
type DirectoryLocation = Pick<
  Location,
  "id" | "name" | "address" | "city" | "state"
> & {
  postal_code: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  already_connected: boolean;
};
export default function GameSetup({
  view,
  organizationId,
}: {
  view: View;
  organizationId?: string;
}) {
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
    [leagueMileagePlan, setLeagueMileagePlan] =
      useState<MileagePlan>("round_trip"),
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
    [openLeagueDocuments, setOpenLeagueDocuments] = useState<string | null>(
      null,
    ),
    [leagueDrafts, setLeagueDrafts] = useState<Record<string, MileagePlan>>({}),
    [savingLeagueId, setSavingLeagueId] = useState(""),
    [leagueMessage, setLeagueMessage] = useState(""),
    [savingPower, setSavingPower] = useState(""),
    [showTeamImport, setShowTeamImport] = useState(false),
    [showLocationImport, setShowLocationImport] = useState(false),
    [error, setError] = useState("");
  const [locationQuery, setLocationQuery] = useState(""),
    [directoryLocations, setDirectoryLocations] = useState<DirectoryLocation[]>(
      [],
    ),
    [searchingLocations, setSearchingLocations] = useState(false),
    [savingLocation, setSavingLocation] = useState(false),
    [connectingLocation, setConnectingLocation] = useState(""),
    [locationMessage, setLocationMessage] = useState(""),
    [locationSaveMessage, setLocationSaveMessage] = useState(""),
    [locationSource, setLocationSource] = useState<"system" | "all">("system");

  async function searchLocations(e: FormEvent) {
    e.preventDefault();
    await runLocationSearch(locationQuery, locationSource === "all");
  }

  async function runLocationSearch(
    query = locationQuery,
    includeRealPlaces = false,
  ) {
    if (!organizationId || query.trim().length < 2) {
      setDirectoryLocations([]);
      return;
    }
    setSearchingLocations(true);
    setError("");
    setLocationMessage("");
    const { data, error: searchError } = await supabase.rpc(
      "search_location_directory",
      {
        p_organization_id: organizationId,
        p_query: query.trim(),
      },
    );
    if (searchError) {
      setSearchingLocations(false);
      setError(searchError.message);
      return;
    }
    let results = (data || []) as DirectoryLocation[];
    if (includeRealPlaces) {
      const { data: sessionData } = await supabase.auth.getSession();
      const params = new URLSearchParams({
        q: query.trim(),
        organization: organizationId,
      });
      const response = await fetch(`/api/tier-test/location-search?${params}`, {
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
        },
      });
      const external = (await response.json()) as {
        results?: DirectoryLocation[];
        error?: string;
      };
      if (!response.ok)
        setError(external.error || "Real-world location search failed.");
      else {
        const known = new Set(
          results.map((item) => `${item.name}|${item.city}`.toLowerCase()),
        );
        results = [
          ...results,
          ...(external.results || []).filter(
            (item) => !known.has(`${item.name}|${item.city}`.toLowerCase()),
          ),
        ];
      }
    }
    setDirectoryLocations(results);
    setSearchingLocations(false);
  }

  useEffect(() => {
    if (!organizationId || view !== "Locations") return;
    const timer = window.setTimeout(
      () => void runLocationSearch(locationQuery),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [locationQuery, organizationId, view]);

  async function connectLocation(item: DirectoryLocation) {
    if (!organizationId || item.already_connected) return;
    setConnectingLocation(item.id);
    setError("");
    const external = item.id.startsWith("osm-");
    const { error: connectError } = external
      ? await supabase.rpc("create_and_connect_organization_location", {
          p_organization_id: organizationId,
          p_name: item.name,
          p_address: item.address,
          p_city: item.city,
          p_state: item.state,
          p_postal_code: item.postal_code,
          p_latitude: item.latitude,
          p_longitude: item.longitude,
        })
      : await supabase.rpc("connect_organization_location", {
          p_organization_id: organizationId,
          p_location_id: item.id,
        });
    setConnectingLocation("");
    if (connectError) {
      setError(connectError.message);
      return;
    }
    setDirectoryLocations((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, already_connected: true } : entry,
      ),
    );
    setLocationMessage(`${item.name} is now available to this organization.`);
    await load();
  }
  async function load() {
    setError("");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: p } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", u.user.id)
      .maybeSingle();
    const ok =
      Boolean(organizationId) || ["admin", "assignor"].includes(p?.role || "");
    setAllowed(ok);
    if (!ok) return;
    const locationRequest = organizationId
      ? supabase.rpc("get_organization_locations", {
          p_organization_id: organizationId,
        })
      : supabase
          .from("locations")
          .select(
            "id,name,address,city,state,directions,parking_instructions,entrance_information,map_url,contact_name,contact_phone,contact_email",
          )
          .eq("active", true)
          .order("name");
    const organizationSetupRequest = organizationId
      ? supabase.rpc("get_organization_setup_directory", {
          p_organization_id: organizationId,
        })
      : Promise.resolve({ data: null, error: null });
    const [s, l, lg, t, loc, pw, organizationSetup] = await Promise.all([
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
        .select("id,name,mileage_plan")
        .eq("active", true)
        .order("name"),
      supabase
        .from("teams")
        .select("id,name,sport_id,level_id,level")
        .order("name"),
      locationRequest,
      supabase.from("assignor_team_power_rankings").select("team_id,power"),
      organizationSetupRequest,
    ]);
    const err =
      s.error ||
      l.error ||
      lg.error ||
      t.error ||
      loc.error ||
      pw.error ||
      organizationSetup.error;
    if (err) setError(err.message);
    else {
      const powerMap: Record<string, number> = {};
      ((pw.data || []) as Power[]).forEach((item) => {
        powerMap[item.team_id] = Number(item.power);
      });
      setSports(s.data || []);
      const scoped = organizationSetup.data as {
        leagues: League[];
        levels: Level[];
        teams: Team[];
      } | null;
      const visibleLevels = organizationId
        ? scoped?.levels || []
        : ((l.data || []) as Level[]);
      const visibleLeagues = organizationId
        ? scoped?.leagues || []
        : ((lg.data || []) as League[]);
      const visibleTeams = organizationId
        ? scoped?.teams || []
        : ((t.data || []) as Team[]);
      setLevels(visibleLevels);
      setLeagues(visibleLeagues);
      setLeagueDrafts(
        Object.fromEntries(
          visibleLeagues.map((league) => [league.id, league.mileage_plan]),
        ),
      );
      setTeams(visibleTeams);
      setPowers(powerMap);
      setLocations((loc.data || []) as Location[]);
    }
  }
  useEffect(() => {
    load();
  }, [organizationId]);
  async function addLevel(e: FormEvent) {
    e.preventDefault();
    const n = Number(levelOfficials);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      setError("Officials Needed must be a whole number from 1-20.");
      return;
    }
    const r = organizationId
      ? await supabase.rpc("create_or_connect_organization_level", {
          p_organization_id: organizationId,
          p_name: levelName.trim(),
          p_officials_needed: n,
        })
      : await supabase
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
    const r = organizationId
      ? await supabase.rpc("create_organization_league", {
          p_organization_id: organizationId,
          p_name: leagueName.trim(),
          p_mileage_plan: leagueMileagePlan,
        })
      : await supabase
          .from("leagues")
          .insert({ name: leagueName.trim(), mileage_plan: leagueMileagePlan });
    if (r.error) setError(r.error.message);
    else {
      setLeagueName("");
      setLeagueMileagePlan("round_trip");
      load();
    }
  }
  async function updateLeagueMileagePlan(id: string, mileagePlan: MileagePlan) {
    setError("");
    setLeagueMessage("");
    setSavingLeagueId(id);
    const { error: updateError } = organizationId
      ? await supabase.rpc("update_organization_league_mileage_plan", {
          p_organization_id: organizationId,
          p_league_id: id,
          p_mileage_plan: mileagePlan,
        })
      : await supabase
          .from("leagues")
          .update({ mileage_plan: mileagePlan })
          .eq("id", id);
    setSavingLeagueId("");
    if (updateError) setError(updateError.message);
    else {
      setLeagues((current) =>
        current.map((league) =>
          league.id === id ? { ...league, mileage_plan: mileagePlan } : league,
        ),
      );
      setLeagueMessage("League changes saved.");
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
      : organizationId
        ? await supabase.rpc("create_or_connect_organization_team", {
            p_organization_id: organizationId,
            p_name: payload.name,
            p_sport_id: payload.sport_id,
            p_level_id: payload.level_id,
          })
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
    const { error: e } = await supabase.rpc("set_my_team_power", {
      p_team_id: teamId,
      p_power: Math.round(power * 10) / 10,
    });
    if (e) setError(e.message);
    setSavingPower("");
  }
  async function saveLocation(e: FormEvent) {
    e.preventDefault();
    if (savingLocation) return;
    setSavingLocation(true);
    setError("");
    setLocationSaveMessage("");
    let geocodeWarning = "";
    let coordinates: { latitude: number | null; longitude: number | null } = {
      latitude: null,
      longitude: null,
    };
    if (location.address.trim() || location.name.trim()) {
      try {
        coordinates = await coordinatesForVenue(
          [location.address, location.city, location.state]
            .filter(Boolean)
            .join(", "),
          location.name,
        );
      } catch (geocodeError) {
        geocodeWarning =
          geocodeError instanceof Error
            ? geocodeError.message
            : "The venue address could not be located.";
      }
    }
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
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    };
    const r = organizationId
      ? await supabase.rpc("save_organization_location", {
          p_organization_id: organizationId,
          p_location_id: editingLocationId,
          p_name: payload.name,
          p_address: payload.address,
          p_city: payload.city,
          p_state: payload.state,
          p_directions: payload.directions,
          p_parking_instructions: payload.parking_instructions,
          p_entrance_information: payload.entrance_information,
          p_map_url: payload.map_url,
          p_contact_name: payload.contact_name,
          p_contact_phone: payload.contact_phone,
          p_contact_email: payload.contact_email,
          p_latitude: payload.latitude,
          p_longitude: payload.longitude,
        })
      : editingLocationId
        ? await supabase
            .from("locations")
            .update(payload)
            .eq("id", editingLocationId)
        : await supabase.from("locations").insert(payload);
    if (r.error) {
      setError(r.error.message);
    } else {
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
      setLocationSaveMessage(
        `${editingLocationId ? "Location updated" : "Location added"}.${
          geocodeWarning
            ? " Its map coordinates could not be found automatically, but you can edit the address later."
            : ""
        }`,
      );
      await load();
    }
    setSavingLocation(false);
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
    const entity = table.slice(0, -1);
    const r =
      organizationId && table !== "locations"
        ? await supabase.rpc("disconnect_shared_directory_record", {
            p_organization_id: organizationId,
            p_entity: entity,
            p_record_id: id,
          })
        : await supabase.from(table).delete().eq("id", id);
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
          {leagueMessage && <div className="loginMessage">{leagueMessage}</div>}
          {organizationId && (
            <SharedDirectorySearch
              organizationId={organizationId}
              entity="league"
              onConnected={load}
            />
          )}
          <form className="toolbar" onSubmit={addLeague}>
            <input
              required
              placeholder="Example: Iowa Soccer League"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
            />
            <select
              aria-label="Mileage plan for new league"
              value={leagueMileagePlan}
              onChange={(e) =>
                setLeagueMileagePlan(e.target.value as MileagePlan)
              }
            >
              {mileagePlans.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button className="primary">Add League</button>
          </form>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>League</th>
                  <th>Mileage Plan</th>
                  <th>Documents &amp; Policies</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {leagues.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td>
                        <b>{l.name}</b>
                      </td>
                      <td>
                        <div className="headerActions">
                          <select
                            aria-label={`Mileage plan for ${l.name}`}
                            value={leagueDrafts[l.id] ?? l.mileage_plan}
                            onChange={(e) =>
                              setLeagueDrafts((current) => ({
                                ...current,
                                [l.id]: e.target.value as MileagePlan,
                              }))
                            }
                          >
                            {mileagePlans.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="primary"
                            type="button"
                            disabled={
                              savingLeagueId === l.id ||
                              (leagueDrafts[l.id] ?? l.mileage_plan) ===
                                l.mileage_plan
                            }
                            onClick={() =>
                              void updateLeagueMileagePlan(
                                l.id,
                                leagueDrafts[l.id] ?? l.mileage_plan,
                              )
                            }
                          >
                            {savingLeagueId === l.id
                              ? "Saving…"
                              : "Save changes"}
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() =>
                            setOpenLeagueDocuments(
                              openLeagueDocuments === l.id ? null : l.id,
                            )
                          }
                        >
                          {openLeagueDocuments === l.id
                            ? "Close Documents"
                            : "Manage Documents"}
                        </button>
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
                    {openLeagueDocuments === l.id && (
                      <tr className="leagueDocumentsTableRow">
                        <td colSpan={4}>
                          <LeagueDocumentsManager
                            leagueId={l.id}
                            leagueName={l.name}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
          {organizationId && (
            <SharedDirectorySearch
              organizationId={organizationId}
              entity="level"
              onConnected={load}
            />
          )}
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
                My team rankings: rate each team from 1.0–10.0. Your ratings are
                private to your assignor account and determine your game
                priority.
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
          {organizationId && (
            <SharedDirectorySearch
              organizationId={organizationId}
              entity="team"
              onConnected={load}
            />
          )}
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
                        aria-label={`My power ranking for ${t.name}`}
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
        <>
          {organizationId && (
            <section className="card directorySearchCard">
              <div>
                <p className="eyebrow">Shared location directory</p>
                <h2>Find a location before adding a new one</h2>
                <p>
                  Enter anything you know. A city, partial venue name, ZIP code,
                  or part of an address will return possible matches.
                </p>
              </div>
              <form className="directoryConnectForm" onSubmit={searchLocations}>
                <label>
                  Location search
                  <input
                    value={locationQuery}
                    minLength={2}
                    required
                    placeholder="Try “Des Moines”, “Cownie”, or “50317”"
                    onChange={(event) => setLocationQuery(event.target.value)}
                  />
                </label>
                <button className="primary" disabled={searchingLocations}>
                  {searchingLocations ? "Searching…" : "Search all locations"}
                </button>
              </form>
              <fieldset className="locationSourceOptions">
                <legend>Where should RefAssign search?</legend>
                <label>
                  <input
                    type="radio"
                    name="location-source"
                    checked={locationSource === "system"}
                    onChange={() => setLocationSource("system")}
                  />
                  Existing RefAssign locations
                </label>
                <label>
                  <input
                    type="radio"
                    name="location-source"
                    checked={locationSource === "all"}
                    onChange={() => setLocationSource("all")}
                  />
                  Search for a new real-world location
                </label>
              </fieldset>
              {locationMessage && (
                <div className="successBox">{locationMessage}</div>
              )}
              {directoryLocations.length > 0 && (
                <div className="directoryResults">
                  {directoryLocations.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>
                          {[
                            item.address,
                            item.city,
                            item.state,
                            item.postal_code,
                          ]
                            .filter(Boolean)
                            .join(", ") || "Address not yet provided"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={
                          item.already_connected ? "secondary" : "primary"
                        }
                        disabled={
                          item.already_connected ||
                          connectingLocation === item.id
                        }
                        onClick={() => void connectLocation(item)}
                      >
                        {item.already_connected
                          ? "Already in workspace"
                          : connectingLocation === item.id
                            ? "Adding…"
                            : "Use this location"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {!searchingLocations &&
                locationQuery.trim().length >= 2 &&
                directoryLocations.length === 0 && (
                  <div className="emptySearchResult">
                    {locationSource === "system"
                      ? "No existing RefAssign locations matched. Select “Search for a new real-world location” to look outside the system."
                      : "No locations matched that search."}
                  </div>
                )}
            </section>
          )}
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
            {locationSaveMessage && (
              <div className="successBox">{locationSaveMessage}</div>
            )}
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
                <button className="primary" disabled={savingLocation}>
                  {savingLocation
                    ? editingLocationId
                      ? "Saving Changes…"
                      : "Adding Location…"
                    : editingLocationId
                      ? "Save Location Changes"
                      : "Add Location"}
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
                        {[v.address, v.city, v.state]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td>
                        {[
                          v.directions && "Directions",
                          v.parking_instructions && "Parking",
                          v.entrance_information && "Entrance",
                          (v.contact_name ||
                            v.contact_phone ||
                            v.contact_email) &&
                            "Contact",
                        ]
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
        </>
      )}
    </>
  );
}
