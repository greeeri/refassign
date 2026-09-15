"use client";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  programs: { id: string; name: string }[];
  settings: { payments_enabled: boolean; platform_fee_cents: number; processing_fee_payer: string } | null;
  account: { onboarding_status: string; transfers_status: string; requirements_due: unknown[]; last_synced_at: string | null } | null;
};

export default function OrganizationRegistrationPaymentsManager() {
  const [rows, setRows] = useState<Row[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/super-admin/registration-payments", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) return setError(result.error || "Registration payment settings could not be loaded.");
    setRows(result.organizations || []);
  }
  useEffect(() => { void load(); }, []);
  async function accountAction(organizationId: string, action: "onboard" | "dashboard" | "refresh") {
    setBusy(`${organizationId}-${action}`); setError(""); setNotice("");
    const response = await fetch("/api/super-admin/registration-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organization_id: organizationId, action }) });
    const result = await response.json();
    if (!response.ok) setError(result.error || "Stripe action failed.");
    else if (result.url) window.location.assign(result.url);
    else { setNotice("Stripe status refreshed."); await load(); }
    setBusy("");
  }
  async function save(row: Row, enabled: boolean) {
    const feeInput = document.getElementById(`registration-fee-${row.id}`) as HTMLInputElement | null;
    const payerInput = document.getElementById(`registration-payer-${row.id}`) as HTMLSelectElement | null;
    const cents = Math.round(Number(feeInput?.value || 0) * 100);
    setBusy(`${row.id}-save`); setError(""); setNotice("");
    const response = await fetch("/api/super-admin/registration-payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organization_id: row.id, payments_enabled: enabled, platform_fee_cents: cents, processing_fee_payer: payerInput?.value || "registrant" }) });
    const result = await response.json();
    if (!response.ok) setError(result.error || "Settings could not be saved.");
    else { setNotice(`${row.name} registration payments updated.`); await load(); }
    setBusy("");
  }
  const applicable = rows.filter((row) => row.programs.length > 0);
  return <section className="card">
    <div className="cardHead"><div><h2>Organization Registration Payments</h2><p>Connect each organization, set the RefAssign fee, and control when registration checkout is available.</p></div></div>
    {error && <div className="errorBox">{error}</div>}
    {notice && <div className="loginMessage">{notice}</div>}
    {applicable.map((row) => {
      const ready = row.account?.onboarding_status === "ready" && row.account.transfers_status === "active";
      const enabled = row.settings?.payments_enabled === true;
      return <div className="registrationReview" key={row.id}>
        <div className="cardHead"><div><h3>{row.name}</h3><p>{row.programs.map((program) => program.name).join(", ")}</p></div><span className={`badge ${ready ? "green" : ""}`}>{ready ? "Ready" : row.account ? "Setup incomplete" : "Not connected"}</span></div>
        <div className="officialForm">
          <label>RefAssign fee per registration<input id={`registration-fee-${row.id}`} type="number" min="0" step="0.01" defaultValue={((row.settings?.platform_fee_cents ?? 300) / 100).toFixed(2)} /></label>
          <label>Stripe processing cost<select id={`registration-payer-${row.id}`} defaultValue={row.settings?.processing_fee_payer || "registrant"}><option value="registrant">Registrant pays</option><option value="organization">Organization pays</option><option value="platform">Ref Pro Group pays</option></select></label>
        </div>
        <p>Refund decisions: organization. RefAssign processes the Stripe refund and reconciliation.</p>
        <div className="toolbar">
          <button className="primary" disabled={Boolean(busy)} onClick={() => void accountAction(row.id, "onboard")}>{row.account ? "Continue Stripe setup" : "Set up Stripe recipient"}</button>
          {row.account && <button className="secondary" disabled={Boolean(busy)} onClick={() => void accountAction(row.id, "refresh")}>Refresh status</button>}
          {ready && <button className="secondary" disabled={Boolean(busy)} onClick={() => void accountAction(row.id, "dashboard")}>Open Stripe Express</button>}
          <button className={enabled ? "danger" : "primary"} disabled={Boolean(busy) || (!ready && !enabled)} onClick={() => void save(row, !enabled)}>{enabled ? "Disable registration payments" : "Enable registration payments"}</button>
          <button className="secondary" disabled={Boolean(busy)} onClick={() => void save(row, enabled)}>Save fee settings</button>
        </div>
      </div>;
    })}
    <p><a href="https://dashboard.stripe.com/account/onboarding" target="_blank" rel="noreferrer">Open Stripe platform onboarding</a></p>
  </section>;
}
