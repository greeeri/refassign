"use client";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
type Status = {
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  payment_status: string;
  fee_cents: number | null;
  registration_year: number;
};
export default function RegistrationStatusPage() {
  const { token } = useParams<{ token: string }>(),
    supabase = useMemo(() => createClient(), []),
    [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await supabase.rpc(
        "get_registration_status",
        { p_token: token },
      );
      if (loadError) setError(loadError.message);
      else setStatus(((data || [])[0] as Status) || null);
    }
    void load();
  }, [supabase, token]);
  async function pay() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/registration/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const result = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !result.url) {
      setError(result.error || "Unable to start payment.");
      setBusy(false);
      return;
    }
    window.location.href = result.url;
  }
  const complete =
    status?.payment_status === "paid" || status?.payment_status === "waived";
  return (
    <main className="publicRegistration">
      <section className="card">
        <div className="brand">
          Ref<span>Assign</span>
        </div>
        <h1>Registration Status</h1>
        {error && <div className="errorBox">{error}</div>}
        {!status && !error ? (
          <p>Loading registration…</p>
        ) : (
          status && (
            <>
              <h2>
                {status.first_name} {status.last_name}
              </h2>
              <p>
                {status.email} • {status.registration_year}
              </p>
              {complete ? (
                <div className="loginMessage">
                  Payment is complete. Your registration is now with the
                  Registrar for eligibility review.
                </div>
              ) : status.fee_cents == null ? (
                <div className="errorBox">
                  The Registrar has not set the registration fee yet. Return to
                  this page after the fee is published.
                </div>
              ) : (
                <>
                  <div className="registrationFee">
                    <span>Registration Fee</span>
                    <strong>
                      {(status.fee_cents / 100).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })}
                    </strong>
                  </div>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void pay()}
                  >
                    {busy ? "Opening Stripe…" : "Pay Registration Fee"}
                  </button>
                </>
              )}
              {status.status === "approved" && (
                <p>
                  <b>Eligibility approved.</b> You may now contact the assignor
                  about account access and assignments.
                </p>
              )}
            </>
          )
        )}
      </section>
    </main>
  );
}
