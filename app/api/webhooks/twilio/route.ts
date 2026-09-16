import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function e164(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

export async function POST(request: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !serviceKey)
    return NextResponse.json(
      { error: "Webhook is not configured." },
      { status: 503 },
    );

  const form = await request.formData();
  const params = [...form.entries()]
    .map(([name, value]) => [name, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const signed =
    request.nextUrl.toString() +
    params.map(([name, value]) => `${name}${value}`).join("");
  const expected = createHmac("sha1", token).update(signed).digest();
  const provided = Buffer.from(
    request.headers.get("x-twilio-signature") || "",
    "base64",
  );
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const messageStatus = String(form.get("MessageStatus") || "");
  const messageSid = String(form.get("MessageSid") || "");
  if (messageStatus && messageSid) {
    const mapped =
      messageStatus === "delivered"
        ? "delivered"
        : ["failed", "undelivered"].includes(messageStatus)
          ? "failed"
          : "sent";
    await supabase
      .from("official_communications")
      .update({
        delivery_status: mapped,
        ...(mapped === "delivered"
          ? { delivered_at: new Date().toISOString() }
          : {}),
        ...(mapped === "failed"
          ? {
              error_message:
                String(form.get("ErrorMessage") || "") ||
                `Twilio delivery status: ${messageStatus}`,
            }
          : {}),
      })
      .eq("provider_message_id", messageSid);
  }

  const from = e164(String(form.get("From") || ""));
  const body = String(form.get("Body") || "").trim().toUpperCase();
  const optOutType = String(form.get("OptOutType") || "").toUpperCase();
  if (from && (body || optOutType)) {
    const stopWords = [
      "STOP",
      "STOPALL",
      "UNSUBSCRIBE",
      "CANCEL",
      "END",
      "QUIT",
    ];
    const startWords = ["START", "YES", "UNSTOP"];
    const status =
      optOutType === "STOP" || stopWords.includes(body)
        ? "opted_out"
        : optOutType === "START" || startWords.includes(body)
          ? "opted_in"
          : null;
    if (status)
      await supabase.from("sms_consent_status").upsert({
        phone_e164: from,
        status,
        source: "twilio",
        updated_at: new Date().toISOString(),
      });
  }

  return new NextResponse(null, { status: 204 });
}
