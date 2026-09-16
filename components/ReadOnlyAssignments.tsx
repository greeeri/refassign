"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ReadOnlyAssignments.module.css";

type Named = { name: string } | null;
type Assignment = {
  id: string;
  status: string;
  published_at: string | null;
  officials: { first_name: string; last_name: string } | null;
  sport_positions: Named;
};
type Game = {
  id: string;
  game_number: string;
  starts_at: string;
  status: string;
  officials_needed: number;
  home: Named;
  away: Named;
  location: Named;
  leagues: Named;
  assignments: Assignment[];
};
type DateRange = "all" | "today" | "tomorrow" | "week" | "month";
const PAGE_SIZE = 50;

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function officialName(assignment: Assignment) {
  return assignment.officials
    ? `${assignment.officials.first_name} ${assignment.officials.last_name}`.trim()
    : "";
}

export default function ReadOnlyAssignments({
  organizationId,
  view = "assignments",
}: {
  organizationId: string;
  view?: "games" | "assignments";
}) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [exactDate, setExactDate] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [locationSearch, setLocationSearch] = useState("");
  const [officialFilter, setOfficialFilter] = useState("all");
  const [officialSearch, setOfficialSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setGames([]);
    fetch(
      `/api/assignments/read-only?${new URLSearchParams({ organizationId })}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not load assignments.");
        return result;
      })
      .then((result) => setGames(result.games))
      .catch((problem) => {
        if (!controller.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [organizationId]);

  const locations = useMemo(
    () =>
      [...new Set(games.map((game) => game.location?.name).filter(Boolean))]
        .sort((a, b) => a!.localeCompare(b!)) as string[],
    [games],
  );
  const officials = useMemo(
    () =>
      [
        ...new Set(
          games.flatMap((game) => game.assignments.map(officialName)).filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [games],
  );

  const filteredGames = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthEnd = new Date(today);
    monthEnd.setDate(monthEnd.getDate() + 30);
    const locationQuery = locationSearch.trim().toLowerCase();
    const officialQuery = officialSearch.trim().toLowerCase();

    return games.filter((game) => {
      const startsAt = new Date(game.starts_at);
      const gameDate = localDate(startsAt);
      if (exactDate && gameDate !== exactDate) return false;
      if (!exactDate) {
        if (dateRange === "today" && gameDate !== localDate(today)) return false;
        if (dateRange === "tomorrow" && gameDate !== localDate(tomorrow))
          return false;
        if (dateRange === "week" && (startsAt < today || startsAt >= weekEnd))
          return false;
        if (dateRange === "month" && (startsAt < today || startsAt >= monthEnd))
          return false;
      }
      const location = (game.location?.name || "Venue TBD").toLowerCase();
      if (locationFilter !== "all" && game.location?.name !== locationFilter)
        return false;
      if (locationQuery && !location.includes(locationQuery)) return false;
      const names = game.assignments.map(officialName);
      if (officialFilter !== "all" && !names.includes(officialFilter)) return false;
      if (
        officialQuery &&
        !names.some((name) => name.toLowerCase().includes(officialQuery))
      )
        return false;
      return true;
    });
  }, [
    dateRange,
    exactDate,
    games,
    locationFilter,
    locationSearch,
    officialFilter,
    officialSearch,
  ]);

  const visibleGames = filteredGames.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE,
  );
  const hasFilters =
    dateRange !== "all" ||
    Boolean(exactDate) ||
    locationFilter !== "all" ||
    Boolean(locationSearch) ||
    officialFilter !== "all" ||
    Boolean(officialSearch);

  function resetFilters() {
    setDateRange("all");
    setExactDate("");
    setLocationFilter("all");
    setLocationSearch("");
    setOfficialFilter("all");
    setOfficialSearch("");
    setPage(0);
  }

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>
            {view === "games" ? "Games" : "Assignments"}{" "}
            <small>— Read only</small>
          </h2>
          <p>
            {view === "games"
              ? "Games for the leagues your administrator has associated with you."
              : "Games and assigned officials for the leagues your administrator has associated with you."}
          </p>
        </div>
        <span className="badge">{filteredGames.length} results</span>
      </div>

      <div className={styles.filters} aria-label="Game and assignment filters">
        <label>
          Date filter
          <select
            value={dateRange}
            onChange={(event) => {
              setDateRange(event.target.value as DateRange);
              setExactDate("");
              setPage(0);
            }}
          >
            <option value="all">All upcoming dates</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="week">Next 7 days</option>
            <option value="month">Next 30 days</option>
          </select>
        </label>
        <label>
          Search exact date
          <input
            type="date"
            value={exactDate}
            onChange={(event) => {
              setExactDate(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Location filter
          <select
            value={locationFilter}
            onChange={(event) => {
              setLocationFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All locations</option>
            {locations.map((location) => (
              <option key={location} value={location}>{location}</option>
            ))}
          </select>
        </label>
        <label>
          Search locations
          <input
            type="search"
            value={locationSearch}
            onChange={(event) => {
              setLocationSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Type a venue name"
          />
        </label>
        <label>
          Official filter
          <select
            value={officialFilter}
            onChange={(event) => {
              setOfficialFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All officials</option>
            {officials.map((official) => (
              <option key={official} value={official}>{official}</option>
            ))}
          </select>
        </label>
        <label>
          Search official names
          <input
            type="search"
            value={officialSearch}
            onChange={(event) => {
              setOfficialSearch(event.target.value);
              setPage(0);
            }}
            placeholder="First or last name"
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className="secondary"
          disabled={!hasFilters}
          onClick={resetFilters}
        >
          Clear filters
        </button>
      </div>

      {error && <p className="errorBox" role="alert">{error}</p>}
      {loading ? (
        <p>Loading assignments…</p>
      ) : !error && (
        <>
          {!visibleGames.length && (
            <p>No games match the selected date, location, and official filters.</p>
          )}
          {visibleGames.map((game) => (
            <article className="card" key={game.id} style={{ marginTop: 12 }}>
              <h3>{game.home?.name || "TBD"} vs {game.away?.name || "TBD"}</h3>
              <p>
                {new Date(game.starts_at).toLocaleString()} ·{" "}
                {game.location?.name || "Venue TBD"}
              </p>
              <p>
                {game.leagues?.name} · Game {game.game_number} ·{" "}
                {game.status.replaceAll("_", " ")}
              </p>
              {view === "assignments" && (
                <>
                  <ul>
                    {game.assignments.map((assignment) => (
                      <li key={assignment.id}>
                        <strong>{assignment.sport_positions?.name || "Official"}:</strong>{" "}
                        {officialName(assignment) || "Unassigned"} —{" "}
                        {assignment.published_at ? assignment.status : "Not published"}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {Math.max(
                      0,
                      game.officials_needed -
                        game.assignments.filter(
                          (assignment) =>
                            !["declined", "cancelled"].includes(assignment.status),
                        ).length,
                    )}{" "}
                    open positions
                  </p>
                </>
              )}
            </article>
          ))}
          <div className="headerActions">
            <button
              type="button"
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="secondary"
              disabled={(page + 1) * PAGE_SIZE >= filteredGames.length}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
