"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
type Registration = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  sport: string;
  status: string;
  payment_status: string;
  fee_cents: number | null;
  paid_at: string | null;
  created_at: string;
  official_id: string | null;
};
type Level = { id: string; name: string };
export default function RegistrarManager() {
  const supabase = useMemo(() => createClient(), []),
    [registrations, setRegistrations] = useState<Registration[]>([]),
    [levels, setLevels] = useState<Level[]>([]),
    [fee, setFee] = useState(""),
    [eligibility, setEligibility] = useState<Record<string, string[]>>({}),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    setError("");
    const [registrationResult, levelResult, settingsResult] = await Promise.all(
      [
        supabase
          .from("official_registrations")
          .select(
            "id,first_name,last_name,email,phone,sport,status,payment_status,fee_cents,paid_at,created_at,official_id",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("levels")
          .select("id,name")
          .eq("active", true)
          .order("name"),
        supabase
          .from("registration_settings")
          .select("registration_fee_cents")
          .eq("id", true)
          .single(),
      ],
    );
    const loadError =
      registrationResult.error || levelResult.error || settingsResult.error;
    if (loadError) setError(loadError.message);
    else {
      setRegistrations((registrationResult.data || []) as Registration[]);
      setLevels((levelResult.data || []) as Level[]);
      setFee(
        settingsResult.data.registration_fee_cents == null
          ? ""
          : (Number(settingsResult.data.registration_fee_cents) / 100).toFixed(
              2,
            ),
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function saveFee() {
    const amount = Number(fee);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a registration fee greater than $0.");
      return;
    }
    setBusy("fee");
    setError("");
    const { error: saveError } = await supabase
      .from("registration_settings")
      .update({
        registration_fee_cents: Math.round(amount * 100),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (saveError) setError(saveError.message);
    else
      setNotice(
        `Registration fee set to ${amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
      );
    setBusy("");
  }
  function toggle(registrationId: string, levelId: string) {
    setEligibility((current) => {
      const selected = current[registrationId] || [];
      return {
        ...current,
        [registrationId]: selected.includes(levelId)
          ? selected.filter((id) => id !== levelId)
          : [...selected, levelId],
      };
    });
  }
  async function approve(registration: Registration) {
    const selected = eligibility[registration.id] || [];
    if (!selected.length) {
      setError("Select at least one eligible level.");
      return;
    }
    setBusy(registration.id);
    setError("");
    setNotice("");
    const { error: approveError } = await supabase.rpc(
      "approve_official_registration",
      { p_registration_id: registration.id, p_level_ids: selected },
    );
    if (approveError) setError(approveError.message);
    else {
      setNotice(
        `${registration.first_name} ${registration.last_name} was approved and added to the Officials Directory.`,
      );
      await load();
    }
    setBusy("");
  }
  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/register`);
    setNotice("New-official registration link copied.");
  }
  const paid = registrations.filter(
      (row) => row.payment_status === "paid" && row.status !== "approved",
    ),
    existing = registrations.filter((row) => row.status === "approved"),
    waiting = registrations.filter((row) => row.payment_status === "pending");
  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Registrar</h2>
            <p>
              Manage registration fees, payments, and official level
              eligibility.
            </p>
          </div>
          <button className="primary" onClick={() => void copyLink()}>
            Copy New Official Registration Link
          </button>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        <div className="registrarMetrics">
          <div>
            <strong>{paid.length}</strong>
            <span>Paid — Needs Review</span>
          </div>
          <div>
            <strong>{waiting.length}</strong>
            <span>Awaiting Payment</span>
          </div>
          <div>
            <strong>{existing.length}</strong>
            <span>Registered Officials</span>
          </div>
        </div>
        <div className="toolbar">
          <label>
            Registration Fee
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={fee}
              placeholder="Set fee"
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy === "fee"}
            onClick={() => void saveFee()}
          >
            {busy === "fee" ? "Saving…" : "Save Fee"}
          </button>
        </div>
      </section>
      <section className="card">
        <h2>Paid Registrations Needing Eligibility</h2>
        {paid.length === 0 ? (
          <p>No paid registrations are waiting for review.</p>
        ) : (
          paid.map((registration) => (
            <div className="registrationReview" key={registration.id}>
              <div>
                <h3>
                  {registration.first_name} {registration.last_name}
                </h3>
                <p>
                  {registration.email}
                  {registration.phone ? ` • ${registration.phone}` : ""} •{" "}
                  {registration.sport}
                </p>
                <small>
                  Paid{" "}
                  {registration.paid_at
                    ? new Date(registration.paid_at).toLocaleString()
                    : ""}
                </small>
              </div>
              <fieldset>
                <legend>Eligible Levels</legend>
                <div className="eligibilityGrid">
                  {levels.map((level) => (
                    <label key={level.id}>
                      <input
                        type="checkbox"
                        checked={(eligibility[registration.id] || []).includes(
                          level.id,
                        )}
                        onChange={() => toggle(registration.id, level.id)}
                      />
                      {level.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="primary"
                disabled={busy === registration.id}
                onClick={() => void approve(registration)}
              >
                {busy === registration.id
                  ? "Approving…"
                  : "Approve & Create Eligibility"}
              </button>
            </div>
          ))
        )}
      </section>
      <section className="card">
        <h2>Registration History</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Official</th>
                <th>Sport</th>
                <th>Submitted</th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>
                      {row.first_name} {row.last_name}
                    </b>
                    <small>{row.email}</small>
                  </td>
                  <td>{row.sport}</td>
                  <td>{new Date(row.created_at).toLocaleDateString()}</td>
                  <td>
                    <span
                      className={`badge ${["paid", "waived"].includes(row.payment_status) ? "green" : "yellow"}`}
                    >
                      {row.payment_status}
                    </span>
                  </td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
