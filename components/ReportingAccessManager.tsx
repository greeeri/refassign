"use client";

import { useEffect, useState } from "react";

type Subscription = {
  id: string;
  organization_name: string;
  plan: string;
  status: string;
  reporting_access: "standard" | "premium";
  premium_reporting_amount_cents: number | null;
  premium_reporting_billing_interval: "monthly" | "annual";
  reporting_override_reason: string | null;
};

export default function ReportingAccessManager() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/super-admin/reporting-access", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      return setMessage(result.error || "Unable to load reporting access.");
    setSubscriptions(result.subscriptions || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/super-admin/reporting-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription_id: selected.id,
        reporting_access: selected.reporting_access,
        amount_cents: selected.premium_reporting_amount_cents,
        billing_interval: selected.premium_reporting_billing_interval,
        reason: selected.reporting_override_reason,
      }),
    });
    const result = await response.json();
    setMessage(
      response.ok
        ? "Reporting access updated."
        : result.error || "Update failed.",
    );
    if (response.ok) await load();
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="cardHead">
        <div>
          <h2>Reporting Plans</h2>
          <p>
            Set standard or premium reporting and an account-specific premium
            price.
          </p>
        </div>
        <span className="badge">Super Admin</span>
      </div>
      {message && <div className="loginMessage">{message}</div>}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Organization / account</th>
              <th>Plan</th>
              <th>Reporting</th>
              <th>Premium price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((item) => (
              <tr
                key={item.id}
                onClick={() => setSelected({ ...item })}
                className={selected?.id === item.id ? "selectedRow" : ""}
              >
                <td>
                  <b>{item.organization_name || "Individual account"}</b>
                </td>
                <td>{item.plan}</td>
                <td>{item.reporting_access}</td>
                <td>
                  {item.reporting_access === "premium" &&
                  item.premium_reporting_amount_cents != null
                    ? `$${(item.premium_reporting_amount_cents / 100).toFixed(2)} / ${item.premium_reporting_billing_interval}`
                    : "Included"}
                </td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="registrationReview">
          <h3>{selected.organization_name || "Individual account"}</h3>
          <div className="officialForm">
            <label>
              Reporting access
              <select
                value={selected.reporting_access}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    reporting_access: event.target.value as
                      "standard" | "premium",
                  })
                }
              >
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </label>
            {selected.reporting_access === "premium" && (
              <>
                <label>
                  Premium amount ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      selected.premium_reporting_amount_cents == null
                        ? ""
                        : selected.premium_reporting_amount_cents / 100
                    }
                    placeholder="Included"
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        premium_reporting_amount_cents:
                          event.target.value === ""
                            ? null
                            : Math.round(Number(event.target.value) * 100),
                      })
                    }
                  />
                </label>
                <label>
                  Billing interval
                  <select
                    value={selected.premium_reporting_billing_interval}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        premium_reporting_billing_interval: event.target
                          .value as "monthly" | "annual",
                      })
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
              </>
            )}
            <label>
              Override reason
              <input
                value={selected.reporting_override_reason || ""}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    reporting_override_reason: event.target.value,
                  })
                }
                placeholder="Contract, promotion, or negotiated rate"
              />
            </label>
          </div>
          <p>
            <b>Standard:</b> counts, mileage, filters, charts, CSV, and PDF.{" "}
            <b>Premium:</b> adds fees, reimbursement, payment status, and
            compensation by paying organization.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save Reporting Plan"}
          </button>
        </div>
      )}
    </section>
  );
}
