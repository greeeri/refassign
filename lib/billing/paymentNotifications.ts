import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type BillingNotice = "payment_failed" | "payment_recovered";
type SubscriptionRecord = {
  id: string;
  user_id: string;
  organization_id: string | null;
  organization_name: string;
  stripe_subscription_id: string | null;
  status: string;
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function displayName(user: { email?: string; user_metadata?: Record<string, unknown> }) {
  return String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Account holder");
}

async function sendOne(service: SupabaseClient, input: {
  eventId: string;
  subscription: SubscriptionRecord;
  type: `${BillingNotice}_${"customer" | "admin"}`;
  recipient: string;
  subject: string;
  html: string;
}) {
  const { data: existing } = await service.from("billing_notification_log").select("delivery_status").eq("stripe_event_id", input.eventId).eq("notification_type", input.type).eq("recipient_email", input.recipient).maybeSingle();
  if (existing?.delivery_status === "sent") return;

  let deliveryStatus = "failed";
  let providerMessageId: string | null = null;
  let errorMessage: string | null = null;
  try {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");
    const idempotencyKey = `billing-${createHash("sha256").update(`${input.eventId}:${input.type}:${input.recipient}`).digest("hex")}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: "RefAssign <notifications@assignments.ref-assign.com>", to: [input.recipient], reply_to: "assignments@ref-assign.com", subject: input.subject, html: input.html }),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) throw new Error(result.message || `Resend returned ${response.status}.`);
    deliveryStatus = "sent";
    providerMessageId = result.id || null;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 1000) : "Notification delivery failed.";
  }

  const values = {
    stripe_event_id: input.eventId,
    subscription_id: input.subscription.id,
    organization_id: input.subscription.organization_id,
    notification_type: input.type,
    recipient_email: input.recipient,
    delivery_status: deliveryStatus,
    provider_message_id: providerMessageId,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  };
  const { error } = await service.from("billing_notification_log").upsert(values, { onConflict: "stripe_event_id,notification_type,recipient_email" });
  if (error) throw error;
  if (deliveryStatus === "failed") throw new Error(errorMessage || "Notification delivery failed.");
}

function notificationContent(input: {
  notice: BillingNotice;
  audience: "customer" | "admin";
  subscription: SubscriptionRecord;
  accountName: string;
  accountEmail: string;
  origin: string;
}) {
  const failed = input.notice === "payment_failed";
  const organization = escapeHtml(input.subscription.organization_name || "your organization");
  const holder = escapeHtml(input.accountName);
  if (input.audience === "admin") return {
    subject: `${failed ? "Payment failed" : "Payment recovered"}: ${input.subscription.organization_name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#102746"><h2>${failed ? "Subscription payment failed" : "Subscription payment recovered"}</h2><p><b>Organization:</b> ${organization}</p><p><b>Account holder:</b> ${holder} (${escapeHtml(input.accountEmail)})</p><p><b>Stripe subscription:</b> ${escapeHtml(input.subscription.stripe_subscription_id)}</p><p><b>Access:</b> ${failed ? "Paused" : "Restored automatically"}</p></div>`,
  };
  return failed ? {
    subject: `Action required: update payment for ${input.subscription.organization_name}`,
    html: `<div style="font-family:Arial,sans-serif;color:#102746"><h2>Payment needs attention</h2><p>Hi ${holder},</p><p>We could not complete the subscription payment for <b>${organization}</b>. Operational access is paused until payment succeeds.</p><p><a href="${escapeHtml(`${input.origin}/billing/recover`)}" style="display:inline-block;background:#1677e8;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Update Payment Method</a></p><p>After Stripe confirms payment, RefAssign will restore access automatically.</p></div>`,
  } : {
    subject: `Payment confirmed: ${input.subscription.organization_name} access restored`,
    html: `<div style="font-family:Arial,sans-serif;color:#102746"><h2>Payment confirmed</h2><p>Hi ${holder},</p><p>Stripe confirmed payment for <b>${organization}</b>. RefAssign operational access has been restored automatically.</p><p><a href="${escapeHtml(input.origin)}" style="display:inline-block;background:#1677e8;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open RefAssign</a></p></div>`,
  };
}

export async function sendBillingStatusNotifications(service: SupabaseClient, input: {
  eventId: string;
  subscriptionId: string;
  notice: BillingNotice;
  origin: string;
}) {
  const { data: subscription, error } = await service.from("refassign_subscriptions").select("id,user_id,organization_id,organization_name,stripe_subscription_id,status").eq("stripe_subscription_id", input.subscriptionId).maybeSingle();
  if (error) throw error;
  if (!subscription) throw new Error(`No RefAssign record matches Stripe subscription ${input.subscriptionId}.`);

  const [{ data: account }, { data: admins, error: adminError }] = await Promise.all([
    service.auth.admin.getUserById(subscription.user_id),
    service.from("protected_accounts").select("user_id"),
  ]);
  if (adminError) throw adminError;
  const user = account.user;
  if (!user?.email) throw new Error("The subscription account holder has no email address.");

  const adminRecipients: string[] = [];
  for (const admin of admins || []) {
    const { data } = await service.auth.admin.getUserById(admin.user_id);
    if (data.user?.email) adminRecipients.push(data.user.email);
  }

  const customer = notificationContent({ notice: input.notice, audience: "customer", subscription, accountName: displayName(user), accountEmail: user.email, origin: input.origin });
  await sendOne(service, { eventId: input.eventId, subscription, type: `${input.notice}_customer`, recipient: user.email, subject: customer.subject, html: customer.html });
  const adminMessage = notificationContent({ notice: input.notice, audience: "admin", subscription, accountName: displayName(user), accountEmail: user.email, origin: input.origin });
  for (const recipient of [...new Set(adminRecipients)]) {
    await sendOne(service, { eventId: input.eventId, subscription, type: `${input.notice}_admin`, recipient, subject: adminMessage.subject, html: adminMessage.html });
  }
}

export async function resendBillingStatusNotification(service: SupabaseClient, input: { logId: string; origin: string }) {
  const { data: log, error: logError } = await service.from("billing_notification_log").select("id,stripe_event_id,notification_type,recipient_email,delivery_status,subscription_id").eq("id", input.logId).single();
  if (logError) throw logError;
  if (log.delivery_status !== "failed") throw new Error("Only failed notifications can be resent.");
  const { data: subscription, error } = await service.from("refassign_subscriptions").select("id,user_id,organization_id,organization_name,stripe_subscription_id,status").eq("id", log.subscription_id).single();
  if (error) throw error;
  const { data: account } = await service.auth.admin.getUserById(subscription.user_id);
  if (!account.user?.email) throw new Error("The subscription account holder has no email address.");
  const notice = String(log.notification_type).startsWith("payment_recovered") ? "payment_recovered" : "payment_failed";
  const audience = String(log.notification_type).endsWith("_admin") ? "admin" : "customer";
  const content = notificationContent({ notice, audience, subscription, accountName: displayName(account.user), accountEmail: account.user.email, origin: input.origin });
  await sendOne(service, { eventId: log.stripe_event_id, subscription, type: log.notification_type, recipient: log.recipient_email, subject: content.subject, html: content.html });
}
