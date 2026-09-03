"use client";
import { FormEvent, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function RegistrationPage() {
  const supabase = useMemo(() => createClient(), []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const { data, error: submitError } = await supabase.rpc(
      "submit_official_registration",
      {
        p_first_name: String(form.get("first_name") || ""),
        p_last_name: String(form.get("last_name") || ""),
        p_email: String(form.get("email") || ""),
        p_phone: String(form.get("phone") || ""),
        p_home_address: String(form.get("home_address") || ""),
        p_home_city: String(form.get("home_city") || ""),
        p_home_state: String(form.get("home_state") || ""),
        p_home_zip: String(form.get("home_zip") || ""),
        p_sport: String(form.get("sport") || "Soccer"),
        p_program_slug: "iowa-soccer",
      },
    );
    if (submitError) {
      setError(submitError.message);
      setBusy(false);
      return;
    }
    window.location.href = `/register/${data}`;
  }
  return (
    <main className="publicRegistration">
      <section className="card">
        <div className="brand">
          Ref<span>Assign</span>
        </div>
        <h1>Iowa Soccer Official Registration</h1>
        <p>
          Register as a new sports official. After submitting, you can pay the
          registration fee securely through Stripe.
        </p>
        {error && <div className="errorBox">{error}</div>}
        <form className="officialForm" onSubmit={submit}>
          <label>
            First Name
            <input name="first_name" required maxLength={80} />
          </label>
          <label>
            Last Name
            <input name="last_name" required maxLength={80} />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" />
          </label>
          <label>
            Sport
            <select name="sport" defaultValue="Soccer">
              <option>Soccer</option>
              <option>Basketball</option>
              <option>Volleyball</option>
              <option>Baseball</option>
              <option>Softball</option>
              <option>Football</option>
            </select>
          </label>
          <label>
            Home Address
            <input name="home_address" />
          </label>
          <label>
            City
            <input name="home_city" />
          </label>
          <label>
            State
            <input name="home_state" defaultValue="IA" />
          </label>
          <label>
            ZIP
            <input name="home_zip" inputMode="numeric" />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Submitting…" : "Continue to Payment"}
          </button>
        </form>
        <p>
          <a href="/login">Return to sign in</a>
        </p>
      </section>
    </main>
  );
}
