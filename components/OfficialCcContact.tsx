"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";

type Contact = { date_of_birth: string; name: string; email: string; phone: string };
const blank: Contact = { date_of_birth: "", name: "", email: "", phone: "" };
export default function OfficialCcContact({ officialId }: { officialId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [contact, setContact] = useState<Contact>(blank);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setNotice(""); setFailure("");
    Promise.all([
      supabase.from("official_cc_contacts").select("date_of_birth,name,email,phone").eq("official_id", officialId).maybeSingle(),
      supabase.from("official_cc_deliveries").select("status,error_message").eq("official_id", officialId).order("created_at", { ascending: false }).limit(1),
    ]).then(([settings, deliveries]) => {
      if (!active) return;
      if (settings.error) setError(settings.error.message);
      const row = settings.data;
      setContact({ date_of_birth: row?.date_of_birth || "", name: row?.name || "", email: row?.email || "", phone: row?.phone || "" });
      if (deliveries.data?.[0]?.status === "failed") setFailure(deliveries.data[0].error_message || "The most recent CC copy failed.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [officialId, supabase]);
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 13);
  const cutoffDate = `${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,"0")}-${String(cutoff.getDate()).padStart(2,"0")}`;
  const required = !!contact.date_of_birth && contact.date_of_birth > cutoffDate;
  const update = (key: keyof Contact, value: string) => setContact(old => ({ ...old, [key]: value }));
  async function save() {
    setSaving(true); setError(""); setNotice("");
    const digits = contact.phone.replace(/\D/g, "");
    const phone = !digits ? null : contact.phone.trim().startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : contact.phone.trim();
    const { error } = await supabase.rpc("save_official_cc_contact", { p_official_id: officialId, p_date_of_birth: contact.date_of_birth || null, p_name: contact.name, p_email: contact.email || null, p_phone: phone });
    if (error) setError(error.message); else setNotice("CC contact saved.");
    setSaving(false);
  }
  return <section className="card" style={{ marginTop: 16 }}>
    <h3>Additional contact (CC){required ? " — Required" : " — Optional"}</h3>
    <p>Receives a copy through the same email or text channel as the referee. Add both an email and mobile number to receive either. This contact applies across the referee’s organizations.</p>
    <p>A contact name and email or mobile number are required for referees under 13. Secure login and assignment-response links stay with the referee.</p>
    {loading ? <p>Loading CC contact…</p> : <div className="officialForm">
      <label>Referee date of birth<input type="date" value={contact.date_of_birth} onChange={e => update("date_of_birth", e.target.value)} /></label>
      <label>Contact name<input value={contact.name} aria-required={required} onChange={e => update("name", e.target.value)} /></label>
      <label>Contact email<input type="email" value={contact.email} onChange={e => update("email", e.target.value)} /></label>
      <label>Contact mobile number<input type="tel" placeholder="(515) 555-0123" value={contact.phone} onChange={e => update("phone", e.target.value)} /></label>
      <div className="formActions"><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save CC Contact"}</button></div>
      <small>For referees 13 and older, clear the contact name, email, and phone and save to stop copies.</small>
    </div>}
    {error && <p role="alert" className="errorBox">{error}</p>}
    {notice && <p role="status" className="successBox">{notice}</p>}
    {failure && <p role="status" className="errorBox">Last CC delivery: {failure}</p>}
  </section>;
}
