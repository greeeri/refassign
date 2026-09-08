import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../lib/supabase/admin";

const failure = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: 400 },
  );

export async function GET() {
  try {
    const { service } = await requireSuperAdmin();
    const { data, error } = await service
      .from("refassign_subscriptions")
      .select(
        "id,user_id,organization_id,organization_name,plan,status,reporting_access,premium_reporting_amount_cents,premium_reporting_billing_interval,reporting_override_reason,created_at",
      )
      .order("organization_name")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ subscriptions: data || [] });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, service } = await requireSuperAdmin();
    const body = (await request.json()) as {
      subscription_id?: string;
      reporting_access?: "standard" | "premium";
      amount_cents?: number | null;
      billing_interval?: "monthly" | "annual";
      reason?: string;
    };
    if (!body.subscription_id) throw new Error("Select an account.");
    if (
      !body.reporting_access ||
      !["standard", "premium"].includes(body.reporting_access)
    )
      throw new Error("Choose standard or premium reporting.");
    const amount =
      body.reporting_access === "premium" ? body.amount_cents : null;
    if (amount != null && (!Number.isInteger(amount) || amount < 0))
      throw new Error("Premium amount must be a positive dollar amount.");
    const update = {
      reporting_access: body.reporting_access,
      premium_reporting_amount_cents: amount,
      premium_reporting_billing_interval: body.billing_interval || "annual",
      reporting_override_reason: body.reason?.trim() || null,
      reporting_access_updated_at: new Date().toISOString(),
      reporting_access_updated_by: user.id,
    };
    const { error } = await service
      .from("refassign_subscriptions")
      .update(update)
      .eq("id", body.subscription_id);
    if (error) throw error;
    await service.from("super_admin_audit").insert({
      actor_user_id: user.id,
      action: "reporting_access_updated",
      details: { subscription_id: body.subscription_id, ...update },
    });
    return NextResponse.json({ updated: true });
  } catch (error) {
    return failure(error);
  }
}
