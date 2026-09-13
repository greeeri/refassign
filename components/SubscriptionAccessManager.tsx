"use client";
import { useEffect, useState } from "react";

type Subscription = { id: string; organization_name: string; account_name: string; account_email: string; plan: string; status: string; stripe_subscription_id: string | null; current_period_end: string | null; cancel_at_period_end: boolean; access_override: boolean; access_override_reason: string | null; organizations: { name?: string } | { name?: string }[] | null };

export default function SubscriptionAccessManager() {
  const [rows, setRows] = useState<Subscription[]>([]), [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/super-admin/subscriptions", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Could not load subscriptions.");
    setRows(result.subscriptions || []);
  }
  useEffect(() => { void load(); }, []);
  async function override(row: Subscription) {
    const enabled = !row.access_override;
    const reason = enabled ? window.prompt("Why should this organization retain access without an active Stripe subscription?") : "";
    if (enabled && !reason) return;
    setBusy(row.id); setMessage("");
    const response = await fetch("/api/super-admin/subscriptions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, enabled, reason }) });
    const result = await response.json();
    setMessage(response.ok ? (enabled ? "Access override granted and logged." : "Access override removed and logged.") : result.error || "Could not update access.");
    if (response.ok) await load();
    setBusy("");
  }
  async function reconcile(row: Subscription) {
    setBusy(row.id); setMessage("");
    const response = await fetch("/api/super-admin/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) });
    const result = await response.json();
    setMessage(response.ok ? "Subscription synchronized with Stripe." : result.error || "Could not synchronize subscription.");
    if (response.ok) await load();
    setBusy("");
  }
  return <section className="card"><div className="cardHead"><div><h2>Subscription Access</h2><p>Stripe status controls operational access. Overrides are exceptional and audited.</p></div></div>{message&&<div className="loginMessage">{message}</div>}<div className="tableWrap"><table><thead><tr><th>Organization / Account holder</th><th>Plan</th><th>Stripe status</th><th>Access</th><th></th></tr></thead><tbody>{rows.map(row=>{const organization=Array.isArray(row.organizations)?row.organizations[0]?.name:row.organizations?.name;const operational=["active","trialing"].includes(row.status)||row.access_override;return <tr key={row.id}><td><b>{organization||row.organization_name}</b><small>{row.account_name}</small><small>{row.account_email}</small>{row.access_override_reason&&<small>Override: {row.access_override_reason}</small>}</td><td>{row.plan.replaceAll("_"," ")}</td><td>{row.status}{row.cancel_at_period_end&&<small>Cancels at period end</small>}</td><td>{operational?"Enabled":"Billing only"}{row.access_override&&<small>Super Admin override</small>}</td><td><div className="toolbar">{row.stripe_subscription_id&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>void reconcile(row)}>{busy===row.id?"Working…":"Sync Stripe"}</button>}<button type="button" className={row.access_override?"danger":"secondary"} disabled={!!busy} onClick={()=>void override(row)}>{row.access_override?"Remove override":"Grant override"}</button></div></td></tr>})}</tbody></table></div></section>;
}
