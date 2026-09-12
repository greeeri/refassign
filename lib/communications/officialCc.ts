import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Copies deliberately exclude bearer links that could act as the referee.
export function ccContent(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+\/(?:assignment|auth|invite|parent-consent)\/[^\s"'<>]+/gi, "[private referee link omitted]")
    .replace(/Use the secure link above to accept or decline your assignment\. You do not need to sign in to respond\./g, "Only the referee can accept or decline this assignment.");
}
export function sameRecipient(a: string, b: string, channel: "email" | "text") {
  const normal = (s: string) => channel === "email" ? s.trim().toLowerCase() : s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return normal(a) === normal(b);
}

/** Only call from an authorized, referee-specific operational notification path. */
export async function sendOfficialNotification(service: SupabaseClient, officialId: string, url: string, init: RequestInit): Promise<Response> {
  const primary = await fetch(url, init);
  if (!primary.ok) return primary;
  const channel = url === "https://api.resend.com/emails" ? "email" : "text";
  let recipient: string | null = null;
  async function record(status: "sent" | "failed" | "skipped", error_message: string | null = null) {
    try {
      const { error } = await service.from("official_cc_deliveries").insert({ official_id: officialId, channel, recipient, status, error_message });
      if (error) console.error("Unable to record CC delivery", officialId, error.code);
    } catch { console.error("Unable to record CC delivery", officialId); }
  }
  try {
    const { data: contact, error } = await service.from("official_cc_contacts").select("name,email,phone").eq("official_id", officialId).maybeSingle();
    if (error) throw new Error("Unable to load CC contact.");
    if (!contact?.name) return primary;
    recipient = channel === "email" ? contact.email : contact.phone;
    if (!recipient) { await record("failed", `CC contact has no ${channel === "email" ? "email address" : "mobile number"} for this communication.`); return primary; }
    const headers = new Headers(init.headers);
    let copy: string | URLSearchParams;
    if (channel === "email") {
      const body = JSON.parse(String(init.body));
      if ((Array.isArray(body.to) ? body.to : [body.to]).some((to: string) => sameRecipient(to, recipient!, channel))) { await record("skipped", "Same address as primary recipient."); return primary; }
      const key = headers.get("Idempotency-Key");
      if (key) headers.set("Idempotency-Key", `cc-${createHash("sha256").update(`${key}:${recipient}`).digest("hex")}`);
      copy = JSON.stringify({ ...body, to: [recipient], cc: undefined, bcc: undefined, attachments: undefined,
        subject: `CC: ${body.subject}`, html: `<p>Copy of a referee communication. Only the referee can respond to assignments.</p>${ccContent(body.html || "")}`,
        ...(body.text ? { text: `CC copy: ${ccContent(body.text)}` } : {}) });
    } else {
      const form = new URLSearchParams(String(init.body));
      if (sameRecipient(form.get("To") || "", recipient, channel)) { await record("skipped", "Same number as primary recipient."); return primary; }
      form.set("To", recipient); form.set("Body", `CC copy: ${ccContent(form.get("Body") || "")}`);
      // Primary delivery callbacks must not overwrite the referee's delivery status.
      form.delete("StatusCallback"); copy = form;
    }
    const response = await fetch(url, { ...init, headers, body: copy, signal: AbortSignal.timeout(10000) });
    await record(response.ok ? "sent" : "failed", response.ok ? null : `CC provider returned ${response.status}.`);
  } catch { await record("failed", "CC delivery failed. The referee's original message was sent."); }
  return primary;
}
