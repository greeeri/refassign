import { NextRequest, NextResponse } from "next/server";
import { sendOfficialNotification } from "../../../../../lib/communications/officialCc";
import { requireManagedOrganization } from "../../../../../lib/server/organizationScope";

function e164(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

export async function POST(request: NextRequest) {
  const scope = await requireManagedOrganization(request);
  if (scope.error) return scope.error;
  const { service, user, organizationId, isSuperAdmin } = scope;
  const body = (await request.json().catch(() => ({}))) as {
    officialIds?: string[];
    message?: string;
  };
  const officialIds = [...new Set(body.officialIds || [])].slice(0, 100);
  const message = body.message?.trim().slice(0, 1600) || "";
  if (!officialIds.length || !message)
    return NextResponse.json(
      { error: "Select at least one official and enter a message." },
      { status: 400 },
    );

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from)
    return NextResponse.json(
      { error: "Text messaging is not configured yet." },
      { status: 503 },
    );

  if (!isSuperAdmin) {
    const [{ data: subscription }, { data: addon }] = await Promise.all([
      service
        .from("refassign_subscriptions")
        .select("plan")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from("organization_addons")
        .select("enabled")
        .eq("organization_id", organizationId)
        .eq("code", "text_messaging")
        .maybeSingle(),
    ]);
    if (subscription?.plan !== "enterprise" && !addon?.enabled)
      return NextResponse.json(
        { error: "This organization does not have an active texting plan." },
        { status: 403 },
      );
  }

  const { data: links, error: linkError } = await service
    .from("organization_officials")
    .select(
      "official_id,officials!inner(id,first_name,last_name,phone,mobile_phone)",
    )
    .eq("organization_id", organizationId)
    .eq("active", true)
    .in("official_id", officialIds);
  if (linkError)
    return NextResponse.json({ error: linkError.message }, { status: 400 });

  let sent = 0;
  const failures: string[] = [];
  for (const raw of links || []) {
    const official = (Array.isArray(raw.officials)
      ? raw.officials[0]
      : raw.officials) as {
      id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      mobile_phone: string | null;
    } | null;
    const recipient = e164(official?.mobile_phone || official?.phone);
    const name = `${official?.first_name || "Official"} ${official?.last_name || ""}`.trim();
    if (!official || !recipient) {
      failures.push(`${name}: missing or invalid mobile number`);
      continue;
    }

    const { data: consent } = await service
      .from("sms_consent_status")
      .select("status")
      .eq("phone_e164", recipient)
      .maybeSingle();
    if (consent?.status === "opted_out") {
      failures.push(`${name}: opted out of text messages`);
      continue;
    }

    const { data: log, error: logError } = await service
      .from("official_communications")
      .insert({
        organization_id: organizationId,
        official_id: official.id,
        channel: "text",
        message_type: "custom",
        recipient,
        subject: "Custom text message",
        message_body: message,
        sent_by: user.id,
        delivery_status: "queued",
      })
      .select("id")
      .single();
    if (logError || !log) {
      failures.push(`${name}: ${logError?.message || "could not create communication log"}`);
      continue;
    }

    const form = new URLSearchParams({
      To: recipient,
      From: from,
      Body: `Ref Pro Group: ${message}`,
      StatusCallback: `${request.nextUrl.origin}/api/webhooks/twilio`,
    });
    const response = await sendOfficialNotification(
      service,
      official.id,
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };
    await service
      .from("official_communications")
      .update(
        response.ok
          ? {
              delivery_status: "sent",
              provider_message_id: result.sid || null,
              sent_at: new Date().toISOString(),
            }
          : {
              delivery_status: "failed",
              error_message: result.message || `Twilio returned ${response.status}`,
            },
      )
      .eq("id", log.id);
    if (response.ok) sent++;
    else failures.push(`${name}: ${result.message || "send failed"}`);
  }

  return NextResponse.json({ sent, failed: failures.length, failures });
}
