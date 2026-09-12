"use client";
import { useEffect, useMemo, useState } from "react";

type Alert = { id: string; stripe_event_id: string; notification_type: string; recipient_email: string; delivery_status: "sent" | "failed"; provider_message_id: string | null; error_message: string | null; created_at: string; updated_at: string; organization_name: string; stripe_subscription_id: string | null; account_name: string; account_email: string };

const noticeLabel = (type: string) => type.includes("recovered") ? "Payment recovered" : "Payment failed";

export default function BillingAlertsManager() {
  const [alerts, setAlerts] = useState<Alert[]>([]), [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/super-admin/billing-alerts", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Billing alerts could not be loaded.");
    setAlerts(result.alerts || []);
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => alerts.filter((alert) => {
    const matchesStatus = status === "all" || alert.delivery_status === status;
    const text = `${alert.organization_name} ${alert.account_name} ${alert.account_email} ${alert.recipient_email} ${alert.stripe_subscription_id || ""}`.toLowerCase();
    return matchesStatus && text.includes(query.trim().toLowerCase());
  }), [alerts, query, status]);
  async function resend(alert: Alert) {
    setBusy(alert.id); setMessage("");
    const response = await fetch("/api/super-admin/billing-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: alert.id }) });
    const result = await response.json();
    setMessage(response.ok ? `Notification resent to ${alert.recipient_email}.` : result.error || "Notification could not be resent.");
    if (response.ok) await load();
    setBusy("");
  }
  return <section className="card"><div className="cardHead"><div><h2>Billing Alerts</h2><p>Failed-payment and recovery notifications with delivery history.</p></div><span className="badge">{filtered.length} records</span></div>{message&&<div className="loginMessage">{message}</div>}<div className="toolbar"><label>Search<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Organization, account, or email" /></label><label>Delivery<select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="all">All</option><option value="sent">Sent</option><option value="failed">Failed</option></select></label></div><div className="tableWrap"><table><thead><tr><th>Organization / Account</th><th>Event</th><th>Recipient</th><th>Delivery</th><th>Date</th><th></th></tr></thead><tbody>{filtered.length?filtered.map((alert)=><tr key={alert.id}><td><b>{alert.organization_name}</b><small>{alert.account_name}</small><small>{alert.account_email}</small>{alert.stripe_subscription_id&&<small>{alert.stripe_subscription_id}</small>}</td><td>{noticeLabel(alert.notification_type)}<small>{alert.notification_type.endsWith("_admin")?"Super Admin notice":"Account-holder notice"}</small><small>{alert.stripe_event_id}</small></td><td>{alert.recipient_email}</td><td><span className={`badge ${alert.delivery_status==="sent"?"green":"red"}`}>{alert.delivery_status}</span>{alert.provider_message_id&&<small>Message: {alert.provider_message_id}</small>}{alert.error_message&&<small>{alert.error_message}</small>}</td><td><time dateTime={alert.created_at}>{new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(alert.created_at))}</time></td><td>{alert.delivery_status==="failed"&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>void resend(alert)}>{busy===alert.id?"Sending…":"Resend"}</button>}</td></tr>):<tr><td colSpan={6}>No billing alerts match these filters.</td></tr>}</tbody></table></div></section>;
}
