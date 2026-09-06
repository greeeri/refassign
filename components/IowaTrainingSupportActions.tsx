"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Game = {
  id: string;
  game_number: string | null;
  starts_at: string;
  home: { name: string } | null;
  away: { name: string } | null;
  location: { name: string } | null;
};
type AssignmentRow = { game_id: string; games: Game | Game[] | null };

export default function IowaTrainingSupportActions() {
  const supabase = useMemo(() => createClient(), []),
    [officialId, setOfficialId] = useState(""),
    [programId, setProgramId] = useState(""),
    [games, setGames] = useState<Game[]>([]),
    [dialog, setDialog] = useState<"question" | "mentor" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: official }, { data: program }] = await Promise.all([
        supabase
          .from("officials")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
        supabase
          .from("registration_programs")
          .select("id")
          .eq("slug", "iowa-soccer")
          .single(),
      ]);
      if (!official || !program) return;
      setOfficialId(official.id);
      setProgramId(program.id);
      const { data, error: e } = await supabase
        .from("assignments")
        .select(
          "game_id,games!inner(id,game_number,starts_at,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name),location:locations(name))",
        )
        .eq("official_id", official.id)
        .in("status", ["accepted", "confirmed"])
        .gte("games.starts_at", new Date().toISOString())
        .not("games.status", "in", "(canceled,cancelled,rained_out)")
        .order("starts_at", { referencedTable: "games", ascending: true });
      if (e) {
        setError(e.message);
        return;
      }
      const unique = new Map<string, Game>();
      for (const row of (data || []) as unknown as AssignmentRow[]) {
        const game = Array.isArray(row.games) ? row.games[0] : row.games;
        if (game) unique.set(game.id, game);
      }
      setGames([...unique.values()]);
    }
    void load();
  }, [supabase]);
  function open(which: "question" | "mentor") {
    setError("");
    setNotice("");
    setDialog(which);
  }
  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!officialId || !programId) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget),
      question = String(form.get("question") || "").trim(),
      { error: e } = await supabase
        .from("development_questions")
        .insert({ program_id: programId, official_id: officialId, question });
    if (e) setError(e.message);
    else {
      setNotice("Your question was sent to the Iowa Soccer mentor team.");
      event.currentTarget.reset();
      setDialog(null);
    }
    setBusy(false);
  }
  async function submitMentorRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!officialId || !programId) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget),
      gameId = String(form.get("game_id") || ""),
      requestDetails = String(form.get("request_details") || "").trim(),
      { error: e } = await supabase
        .from("development_mentor_requests")
        .insert({
          program_id: programId,
          official_id: officialId,
          game_id: gameId,
          request_details: requestDetails || null,
        });
    if (e)
      setError(
        e.code === "23505"
          ? "You already have a pending mentor request for this game."
          : e.message,
      );
    else {
      setNotice(
        "Your mentor request was sent. Iowa Soccer mentors can now accept the game visit.",
      );
      event.currentTarget.reset();
      setDialog(null);
    }
    setBusy(false);
  }
  return (
    <section className="trainingSupport">
      <div>
        <h3>Need Help With Your Development?</h3>
        <p>Connect directly with the Iowa Soccer mentor team.</p>
      </div>
      <div className="trainingSupportButtons">
        <button
          className="trainingAction secondary"
          onClick={() => open("question")}
        >
          ? &nbsp; Ask a Question
        </button>
        <button className="trainingAction" onClick={() => open("mentor")}>
          ●● &nbsp; Request a Mentor
        </button>
      </div>
      {notice && (
        <div className="loginMessage trainingSupportNotice">{notice}</div>
      )}
      {error && !dialog && (
        <div className="errorBox trainingSupportNotice">{error}</div>
      )}
      {dialog && (
        <div
          className="trainingSupportBackdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section
            className="trainingSupportDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-support-title"
          >
            <button
              className="quizClose"
              aria-label="Close"
              onClick={() => setDialog(null)}
            >
              ×
            </button>
            {dialog === "question" ? (
              <>
                <h2 id="training-support-title">Ask a Question</h2>
                <p>
                  Send a rules, positioning, game-management or development
                  question to the Iowa Soccer mentor team.
                </p>
                <form onSubmit={submitQuestion}>
                  <label>
                    Your Question
                    <textarea
                      name="question"
                      rows={6}
                      maxLength={5000}
                      required
                      autoFocus
                      placeholder="What would you like help with?"
                    />
                  </label>
                  {error && <div className="errorBox">{error}</div>}
                  <div className="trainingSupportFormActions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDialog(null)}
                    >
                      Cancel
                    </button>
                    <button className="primary" disabled={busy}>
                      {busy ? "Sending…" : "Send Question"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h2 id="training-support-title">Request a Mentor</h2>
                <p>
                  Select an upcoming accepted game for an Iowa Soccer mentor to
                  observe.
                </p>
                {games.length ? (
                  <form onSubmit={submitMentorRequest}>
                    <label>
                      Game to Observe
                      <select name="game_id" required defaultValue="">
                        <option value="" disabled>
                          Select a game
                        </option>
                        {games.map((game) => (
                          <option value={game.id} key={game.id}>
                            {new Date(game.starts_at).toLocaleString()} —{" "}
                            {game.home?.name || "TBD"} vs{" "}
                            {game.away?.name || "TBD"}
                            {game.location?.name
                              ? ` — ${game.location.name}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      What would you like help with? <small>(optional)</small>
                      <textarea
                        name="request_details"
                        rows={4}
                        maxLength={5000}
                        placeholder="Examples: positioning, foul recognition, confidence, or game management"
                      />
                    </label>
                    {error && <div className="errorBox">{error}</div>}
                    <div className="trainingSupportFormActions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setDialog(null)}
                      >
                        Cancel
                      </button>
                      <button className="primary" disabled={busy}>
                        {busy ? "Sending…" : "Request Mentor"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="loginMessage">
                      You need an upcoming accepted or confirmed assignment
                      before requesting a mentor visit.
                    </div>
                    <div className="trainingSupportFormActions">
                      <button
                        className="secondary"
                        onClick={() => setDialog(null)}
                      >
                        Close
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
