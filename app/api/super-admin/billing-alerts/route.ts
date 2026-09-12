import { NextRequest, NextResponse } from "next/server";
import { resendBillingStatusNotification } from "../../../../lib/billing/paymentNotifications";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Sign in required." : status === 403 ? "Super-admin access required." : message }, { status });
}

export async function GET() {
  try {
    const { service } = await requireSuperAdmin();
    const { data, error } = await service.from("billing_notification_log").select("id,stripe_event_id,subscription_id,organization_id,notification_type,recipient_email,delivery_status,provider_message_id,error_message,created_at,updated_at,refassign_subscriptions(organization_name,user_id,stripe_subscription_id)").order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const userIds = [...new Set((data || []).map((row) => {
      const subscription = Array.isArray(row.refassign_subscriptions) ? row.refassign_subscriptions[0] : row.refassign_subscriptions;
      return subscription?.user_id;
    }).filter(Boolean))] as string[];
    const accounts = Object.fromEntries(await Promise.all(userIds.map(async (id) => {
      const { data: account } = await service.auth.admin.getUserById(id);
      const metadata = account.user?.user_metadata || {};
      const name = String(metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(" ") || "Name not provided");
      return [id, { name, email: account.user?.email || "Email unavailable" }] as const;
    })));
    return NextResponse.json({ alerts: (data || []).map((row) => {
      const subscription = Array.isArray(row.refassign_subscriptions) ? row.refassign_subscriptions[0] : row.refassign_subscriptions;
      return { ...row, refassign_subscriptions: undefined, organization_name: subscription?.organization_name || "Deleted organization", stripe_subscription_id: subscription?.stripe_subscription_id || null, account_name: subscription?.user_id ? accounts[subscription.user_id]?.name : "Account unavailable", account_email: subscription?.user_id ? accounts[subscription.user_id]?.email : "Email unavailable" };
    }) });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = await request.json() as { id?: string };
    if (!body.id) throw new Error("Billing notification is required.");
    await resendBillingStatusNotification(service, { logId: body.id, origin: request.nextUrl.origin });
    await service.from("super_admin_audit").insert({ actor_user_id: user.id, action: "billing_notification_resent", details: { billing_notification_log_id: body.id } });
    return NextResponse.json({ sent: true });
  } catch (error) { return failure(error); }
}
