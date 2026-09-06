"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

export default function IowaTrainingSupportActions() {
  const supabase = useMemo(() => createClient(), []),
    [officialId, setOfficialId] = useState(""),
    [programId, setProgramId] = useState(""),
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
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    const form = new FormData(formElement),
      question = String(form.get("question") || "").trim(),
      { error: e } = await supabase
        .from("development_questions")
        .insert({ program_id: programId, official_id: officialId, question });
    if (e) setError(e.message);
    else {
      setNotice("Your question was sent to the Iowa Soccer mentor team.");
      setDialog(null);
      formElement.reset();
    }
    setBusy(false);
  }
  async function submitMentorRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!officialId || !programId) return;
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    const form = new FormData(formElement),
      gameDate = String(form.get("game_date") || ""),
      gameTime = String(form.get("game_time") || ""),
      venueName = String(form.get("venue_name") || "").trim(),
      venueCity = String(form.get("venue_city") || "").trim(),
      venueState = String(form.get("venue_state") || "").trim(),
      fieldNumber = String(form.get("field_number") || "").trim(),
      requestDetails = String(form.get("request_details") || "").trim(),
      requestedStartAt = new Date(`${gameDate}T${gameTime}`).toISOString(),
      { error: e } = await supabase.from("development_mentor_requests").insert({
        program_id: programId,
        official_id: officialId,
        game_id: null,
        requested_start_at: requestedStartAt,
        venue_name: venueName,
        venue_city: venueCity,
        venue_state: venueState,
        field_number: fieldNumber,
        request_details: requestDetails || null,
      });
    if (e)
      setError(
        e.code === "23505"
          ? "You already have a pending mentor request."
          : e.message,
      );
    else {
      setNotice(
        "Your mentor request was sent. Iowa Soccer mentors can now accept the visit.",
      );
      setDialog(null);
      formElement.reset();
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
                  Enter the match details below so an Iowa Soccer mentor can
                  arrange an observation.
                </p>
                <form onSubmit={submitMentorRequest}>
                  <div className="trainingSupportFieldGrid">
                    <label>
                      Date
                      <input name="game_date" type="date" required />
                    </label>
                    <label>
                      Time
                      <input name="game_time" type="time" required />
                    </label>
                    <label className="fullSpan">
                      Venue Name
                      <input name="venue_name" maxLength={200} required />
                    </label>
                    <label>
                      City
                      <input name="venue_city" maxLength={120} required />
                    </label>
                    <label>
                      State
                      <input name="venue_state" maxLength={50} required />
                    </label>
                    <label className="fullSpan">
                      Field Number
                      <input name="field_number" maxLength={100} required />
                    </label>
                  </div>
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
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
