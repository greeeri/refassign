"use client";

import { useEffect, useMemo, useState } from "react";

type MileagePlan = "one_way" | "round_trip" | "actual" | "none";
type Official = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
  home_latitude: number | null;
  home_longitude: number | null;
};
type Origin = {
  official_id: string;
  weekday: number;
  use_home: boolean;
  alternate_latitude: number | null;
  alternate_longitude: number | null;
};
type Assignment = {
  id: string;
  official_id: string;
  status: string;
  mileage_miles: number;
  officials: Official | null;
  sport_positions: { name: string } | null;
  games: {
    id: string;
    game_number: string | null;
    starts_at: string;
    status: string;
    home: { name: string } | null;
    away: { name: string } | null;
    location: {
      name: string;
      city: string | null;
      state: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
    levels: { name: string } | null;
    leagues: { mileage_plan: MileagePlan } | null;
  } | null;
};
type Dimension = "team" | "location" | "level" | "position";
type Period = "all" | "season" | "30" | "year";

const nameOf = (official: Official | null) =>
  official
    ? `${official.first_name} ${official.last_name}`.trim()
    : "Unknown official";
const milesBetween = (
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null,
) => {
  if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return null;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(Number(lat2) - Number(lat1)),
    dLon = radians(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(Number(lat1))) *
      Math.cos(radians(Number(lat2))) *
      Math.sin(dLon / 2) ** 2;
  return (
    Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) /
    10
  );
};

export default function OfficialReports({
  managerView = false,
}: {
  managerView?: boolean;
}) {
  const [officials, setOfficials] = useState<Official[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [origins, setOrigins] = useState<Origin[]>([]);
  const [officialId, setOfficialId] = useState(""),
    [period, setPeriod] = useState<Period>("season"),
    [dimension, setDimension] = useState<Dimension>("team");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");

  async function load(nextOfficialId = officialId) {
    setLoading(true);
    setError("");
    try {
      const query = nextOfficialId
        ? `?officialId=${encodeURIComponent(nextOfficialId)}`
        : "";
      const response = await fetch(`/api/reports/officials${query}`, {
          cache: "no-store",
        }),
        result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Official reporting could not be loaded.",
        );
      const loadedOfficials = (result.officials || []) as Official[],
        selectedId =
          result.selectedOfficialId ||
          nextOfficialId ||
          loadedOfficials[0]?.id ||
          "";
      setOfficials(loadedOfficials);
      setOfficialId(selectedId);
      setAssignments((result.assignments || []) as Assignment[]);
      setOrigins((result.weekdayOrigins || []) as Origin[]);
      if (managerView && !nextOfficialId && selectedId) {
        const selectedResponse = await fetch(
            `/api/reports/officials?officialId=${encodeURIComponent(selectedId)}`,
            { cache: "no-store" },
          ),
          selectedResult = await selectedResponse.json();
        if (!selectedResponse.ok)
          throw new Error(
            selectedResult.error || "Official reporting could not be loaded.",
          );
        setAssignments((selectedResult.assignments || []) as Assignment[]);
        setOrigins((selectedResult.weekdayOrigins || []) as Origin[]);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Official reporting could not be loaded.",
      );
    }
    setLoading(false);
  }
  useEffect(() => {
    void load("");
  }, []);

  const effectiveMiles = (assignment: Assignment) => {
    const saved = Number(assignment.mileage_miles || 0);
    if (saved > 0) return saved;
    const game = assignment.games,
      official = assignment.officials,
      plan = game?.leagues?.mileage_plan || "round_trip";
    if (plan === "none") return 0;
    if (plan === "actual" || !game || !official) return saved;
    const weekday = new Date(game.starts_at).getDay(),
      origin = origins.find(
        (item) =>
          item.official_id === assignment.official_id &&
          item.weekday === weekday,
      ),
      alternate = Boolean(origin && !origin.use_home);
    const oneWay = milesBetween(
      alternate ? origin!.alternate_latitude : official.home_latitude,
      alternate ? origin!.alternate_longitude : official.home_longitude,
      game.location?.latitude ?? null,
      game.location?.longitude ?? null,
    );
    if (oneWay == null) return saved;
    return plan === "round_trip" ? Math.round(oneWay * 2 * 10) / 10 : oneWay;
  };
  const visible = useMemo(() => {
    const now = new Date(),
      cutoff = new Date(now);
    if (period === "30") cutoff.setDate(now.getDate() - 30);
    if (period === "year") cutoff.setFullYear(now.getFullYear() - 1);
    if (period === "season") cutoff.setMonth(now.getMonth() - 6);
    return assignments
      .filter(
        (assignment) =>
          period === "all" ||
          new Date(assignment.games?.starts_at || 0) >= cutoff,
      )
      .sort(
        (a, b) =>
          new Date(b.games?.starts_at || 0).getTime() -
          new Date(a.games?.starts_at || 0).getTime(),
      );
  }, [assignments, period]);
  const summary = useMemo(() => {
    const counts = new Map<string, number>(),
      add = (label: string | null | undefined) =>
        counts.set(
          label || "Not specified",
          (counts.get(label || "Not specified") || 0) + 1,
        );
    visible.forEach((assignment) => {
      const game = assignment.games;
      if (dimension === "team") {
        add(game?.home?.name);
        add(game?.away?.name);
      }
      if (dimension === "location") add(game?.location?.name);
      if (dimension === "level") add(game?.levels?.name);
      if (dimension === "position") add(assignment.sport_positions?.name);
    });
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [visible, dimension]);
  const totalMiles = visible.reduce(
      (total, assignment) => total + effectiveMiles(assignment),
      0,
    ),
    selectedOfficial =
      officials.find((official) => official.id === officialId) || null;
  const csv = () => {
    const cells = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = visible.map((assignment) => {
      const game = assignment.games;
      return [
        game?.starts_at ? new Date(game.starts_at).toLocaleDateString() : "",
        game?.game_number || "",
        game?.home?.name || "TBD",
        game?.away?.name || "TBD",
        game?.location?.name || "",
        game?.levels?.name || "",
        assignment.sport_positions?.name || "",
        effectiveMiles(assignment).toFixed(1),
      ]
        .map(cells)
        .join(",");
    });
    const blob = new Blob(
        [
          [
            "Date,Game Number,Home Team,Away Team,Location,Level,Position,Miles",
            ...rows,
          ].join("\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `refassign-${nameOf(selectedOfficial)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-assignments.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card officialReports">
      <div className="cardHead">
        <div>
          <h2>
            {managerView ? "Official Activity Report" : "My Officiating Report"}
          </h2>
          <p>
            Game counts by team, location, level and position, with mileage for
            every assignment.
          </p>
        </div>
        <button className="secondary" disabled={!visible.length} onClick={csv}>
          Export CSV
        </button>
      </div>
      <div className="reportFilters">
        {managerView && (
          <label>
            Official
            <select
              value={officialId}
              onChange={(event) => {
                setOfficialId(event.target.value);
                void load(event.target.value);
              }}
            >
              {officials.map((official) => (
                <option key={official.id} value={official.id}>
                  {nameOf(official)}
                  {official.active ? "" : " (Inactive)"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Reporting period
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
          >
            <option value="season">Last 6 months</option>
            <option value="30">Last 30 days</option>
            <option value="year">Last 12 months</option>
            <option value="all">All assignments</option>
          </select>
        </label>
      </div>
      {error && <div className="errorBox">{error}</div>}
      {loading ? (
        <p>Loading official report…</p>
      ) : (
        <>
          <div className="reportMetrics">
            <div>
              <span>Official</span>
              <b>{nameOf(selectedOfficial)}</b>
            </div>
            <div>
              <span>Game assignments</span>
              <b>{visible.length}</b>
            </div>
            <div>
              <span>Total miles</span>
              <b>{totalMiles.toFixed(1)}</b>
            </div>
            <div>
              <span>Average miles / game</span>
              <b>
                {visible.length
                  ? (totalMiles / visible.length).toFixed(1)
                  : "0.0"}
              </b>
            </div>
          </div>
          <div className="reportDimensionTabs">
            {(["team", "location", "level", "position"] as Dimension[]).map(
              (item) => (
                <button
                  key={item}
                  className={dimension === item ? "active" : ""}
                  onClick={() => setDimension(item)}
                >
                  By {item[0].toUpperCase() + item.slice(1)}
                </button>
              ),
            )}
          </div>
          <div className="reportCountGrid">
            {summary.length ? (
              summary.map(([label, count]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b>
                    {count} {count === 1 ? "game" : "games"}
                  </b>
                </div>
              ))
            ) : (
              <p>No assignments in this reporting period.</p>
            )}
          </div>
          <h3>Assignment detail</h3>
          <div className="tableWrap">
            <table className="officialReportTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Teams</th>
                  <th>Location</th>
                  <th>Level</th>
                  <th>Position</th>
                  <th>Miles</th>
                </tr>
              </thead>
              <tbody>
                {visible.length ? (
                  visible.map((assignment) => {
                    const game = assignment.games;
                    return (
                      <tr key={assignment.id}>
                        <td>
                          {game?.starts_at
                            ? new Date(game.starts_at).toLocaleDateString()
                            : "—"}
                          <small>
                            {game?.starts_at
                              ? new Date(game.starts_at).toLocaleTimeString(
                                  [],
                                  { hour: "numeric", minute: "2-digit" },
                                )
                              : ""}
                          </small>
                        </td>
                        <td>
                          <b>{game?.game_number || "—"}</b>
                        </td>
                        <td>
                          {game?.home?.name || "TBD"}
                          <small>vs {game?.away?.name || "TBD"}</small>
                        </td>
                        <td>
                          {game?.location?.name || "—"}
                          <small>
                            {[game?.location?.city, game?.location?.state]
                              .filter(Boolean)
                              .join(", ")}
                          </small>
                        </td>
                        <td>{game?.levels?.name || "—"}</td>
                        <td>{assignment.sport_positions?.name || "—"}</td>
                        <td>
                          <b>{effectiveMiles(assignment).toFixed(1)}</b>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7}>
                      No assignments in this reporting period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
