"use client";

import { useEffect, useMemo, useState } from "react";

type FeeType = "none" | "flat" | "percentage";
type FundingMethod = "ach" | "card" | "collected_funds" | "prepaid_balance";
type League = {
  id: string;
  organization_id: string;
  name: string;
  organization_name: string;
  payment_settings: null | { payroll_enabled: boolean; default_funding_method: FundingMethod; card_enabled: boolean };
  payroll_fee_rule: null | { fee_type: FeeType; flat_fee_cents: number | null; percentage_basis_points: number | null; minimum_fee_cents: number | null; maximum_fee_cents: number | null };
};
type Draft = { payroll_enabled: boolean; funding_method: FundingMethod; card_enabled: boolean; fee_type: FeeType; flat_fee: string; percentage: string; minimum_fee: string; maximum_fee: string };

function draftFor(league: League): Draft {
  const settings = league.payment_settings;
  const fee = league.payroll_fee_rule;
  return {
    payroll_enabled: settings?.payroll_enabled ?? false,
    funding_method: settings?.default_funding_method ?? "ach",
    card_enabled: settings?.card_enabled ?? false,
    fee_type: fee?.fee_type ?? "none",
    flat_fee: fee?.flat_fee_cents == null ? "" : (fee.flat_fee_cents / 100).toFixed(2),
    percentage: fee?.percentage_basis_points == null ? "" : (fee.percentage_basis_points / 100).toFixed(2),
    minimum_fee: fee?.minimum_fee_cents == null ? "" : (fee.minimum_fee_cents / 100).toFixed(2),
    maximum_fee: fee?.maximum_fee_cents == null ? "" : (fee.maximum_fee_cents / 100).toFixed(2),
  };
}
const cents = (value: string) => value === "" ? null : Math.round(Number(value) * 100);

export default function LeaguePayrollSettingsManager() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load(preferredId?: string) {
    const response = await fetch("/api/super-admin/payroll-settings", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || "Unable to load payroll settings.");
    setLeagues(result.leagues || []);
    const id = preferredId || selectedId;
    if (id) {
      const selected = (result.leagues || []).find((league: League) => `${league.organization_id}:${league.id}` === id);
      if (selected) setDraft(draftFor(selected));
    }
  }
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => leagues.filter((league) => `${league.organization_name} ${league.name}`.toLowerCase().includes(query.toLowerCase())), [leagues, query]);
  const selected = leagues.find((league) => `${league.organization_id}:${league.id}` === selectedId) || null;
  function choose(league: League) { setSelectedId(`${league.organization_id}:${league.id}`); setDraft(draftFor(league)); setMessage(""); }
  async function save() {
    if (!selected || !draft) return;
    setBusy(true); setMessage("");
    const response = await fetch("/api/super-admin/payroll-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      league_id: selected.id, organization_id: selected.organization_id, payroll_enabled: draft.payroll_enabled, funding_method: draft.funding_method, card_enabled: draft.card_enabled,
      fee_type: draft.fee_type, flat_fee_cents: cents(draft.flat_fee), percentage_basis_points: cents(draft.percentage), minimum_fee_cents: cents(draft.minimum_fee), maximum_fee_cents: cents(draft.maximum_fee),
    }) });
    const result = await response.json();
    setMessage(response.ok ? "League payroll settings saved." : result.error || "Update failed.");
    if (response.ok) await load(`${selected.organization_id}:${selected.id}`);
    setBusy(false);
  }
  return <section className="card">
    <div className="cardHead"><div><h2>League Payroll & Processing Fees</h2><p>Super Admin controls for Stripe payroll access and league-specific fees.</p></div><span className="badge">Super Admin only</span></div>
    {message && <div className="loginMessage">{message}</div>}
    <label>Find organization or league<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search leagues" /></label>
    <div className="tableWrap"><table><thead><tr><th>Organization</th><th>League</th><th>Payroll</th><th>Funding</th><th>Ref Pro Group fee</th></tr></thead><tbody>
      {filtered.map((league) => { const key = `${league.organization_id}:${league.id}`; return <tr key={key} onClick={() => choose(league)} className={selectedId === key ? "selectedRow" : ""}><td>{league.organization_name}</td><td><b>{league.name}</b></td><td>{league.payment_settings?.payroll_enabled ? "Enabled" : "Disabled"}</td><td>{(league.payment_settings?.default_funding_method || "ach").replaceAll("_", " ").toUpperCase()}</td><td>{league.payroll_fee_rule?.fee_type === "flat" ? `$${((league.payroll_fee_rule.flat_fee_cents || 0) / 100).toFixed(2)} / batch` : league.payroll_fee_rule?.fee_type === "percentage" ? `${((league.payroll_fee_rule.percentage_basis_points || 0) / 100).toFixed(2)}% / batch` : "None"}</td></tr>; })}
      {!filtered.length && <tr><td colSpan={5}>No leagues match this search.</td></tr>}
    </tbody></table></div>
    {selected && draft && <div className="registrationReview"><h3>{selected.organization_name} — {selected.name}</h3><div className="officialForm">
      <label><span><input type="checkbox" checked={draft.payroll_enabled} onChange={(event) => setDraft({ ...draft, payroll_enabled: event.target.checked })} /> Enable Stripe payroll for this league</span></label>
      <label>Default funding method<select value={draft.funding_method} disabled={!draft.payroll_enabled} onChange={(event) => setDraft({ ...draft, funding_method: event.target.value as FundingMethod })}><option value="ach">ACH bank debit</option><option value="card" disabled={!draft.card_enabled}>Card</option><option value="collected_funds">Collected funds</option><option value="prepaid_balance">Prepaid balance</option></select></label>
      <label><span><input type="checkbox" checked={draft.card_enabled} disabled={!draft.payroll_enabled} onChange={(event) => setDraft({ ...draft, card_enabled: event.target.checked, funding_method: !event.target.checked && draft.funding_method === "card" ? "ach" : draft.funding_method })} /> Allow card funding</span></label>
      <label>Ref Pro Group payroll processing fee<select value={draft.fee_type} onChange={(event) => setDraft({ ...draft, fee_type: event.target.value as FeeType })}><option value="none">No fee (default)</option><option value="flat">Flat fee per payroll batch</option><option value="percentage">Percentage per payroll batch</option></select></label>
      {draft.fee_type === "flat" && <label>Flat fee ($)<input type="number" min="0" step="0.01" value={draft.flat_fee} onChange={(event) => setDraft({ ...draft, flat_fee: event.target.value })} /></label>}
      {draft.fee_type === "percentage" && <><label>Percentage (%)<input type="number" min="0" max="100" step="0.01" value={draft.percentage} onChange={(event) => setDraft({ ...draft, percentage: event.target.value })} /></label><label>Minimum fee ($) — optional<input type="number" min="0" step="0.01" value={draft.minimum_fee} onChange={(event) => setDraft({ ...draft, minimum_fee: event.target.value })} /></label><label>Maximum fee ($) — optional<input type="number" min="0" step="0.01" value={draft.maximum_fee} onChange={(event) => setDraft({ ...draft, maximum_fee: event.target.value })} /></label></>}
      <p><b>Stripe processing costs:</b> paid by the league. ACH-funded payroll will wait for settlement before officials are paid.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Payroll Settings"}</button>
    </div></div>}
  </section>;
}
