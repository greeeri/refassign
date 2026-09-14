import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { stripeConnectRequest } from "../../../../lib/stripe/connect";
import { releasePayrollBatch } from "../../../../lib/stripe/payroll";

export const maxDuration = 60;

type CheckoutSession = {
  id: string;
  payment_status: string;
  payment_intent: string | null;
};

type PaymentIntent = {
  latest_charge?: string | {
    id?: string;
    balance_transaction?: { fee?: number };
  };
};

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.STRIPE_CONNECT_TEST_SECRET_KEY || "";
  if (
    process.env.STRIPE_CONNECT_MODE !== "sandbox" ||
    !/^(sk|rk)_test_/.test(key)
  )
    return NextResponse.json(
      { error: "Sandbox payroll reconciliation is not configured." },
      { status: 503 },
    );

  const service = createServiceClient();
  const { data: batches, error } = await service
    .from("payroll_batches")
    .select("id,stripe_checkout_session_id")
    .eq("status", "funding")
    .not("stripe_checkout_session_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(25);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  let checked = 0;
  let settled = 0;
  const failures: Array<{ batchId: string; error: string }> = [];

  for (const batch of batches || []) {
    checked += 1;
    try {
      const session = await stripeConnectRequest<CheckoutSession>(
        `checkout/sessions/${encodeURIComponent(batch.stripe_checkout_session_id)}`,
        key,
      );
      if (session.payment_status !== "paid" || !session.payment_intent) continue;

      const paymentIntent = await stripeConnectRequest<PaymentIntent>(
        `payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge.balance_transaction`,
        key,
      );
      const chargeId =
        typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id || null;
      const actualFee =
        typeof paymentIntent.latest_charge === "object"
          ? paymentIntent.latest_charge.balance_transaction?.fee
          : null;
      const now = new Date().toISOString();
      const { data: claimed, error: claimError } = await service
        .from("payroll_batches")
        .update({
          status: "settled",
          stripe_payment_intent_id: session.payment_intent,
          stripe_charge_id: chargeId,
          stripe_processing_cost_actual_cents: actualFee ?? null,
          funded_at: now,
          settled_at: now,
          funding_failure_message: null,
          updated_at: now,
        })
        .eq("id", batch.id)
        .eq("status", "funding")
        .select("id")
        .maybeSingle();
      if (claimError) throw new Error(claimError.message);
      if (!claimed) continue;

      await releasePayrollBatch(service, batch.id, key);
      settled += 1;
    } catch (reconciliationError) {
      failures.push({
        batchId: batch.id,
        error:
          reconciliationError instanceof Error
            ? reconciliationError.message.slice(0, 500)
            : "Payroll reconciliation failed.",
      });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    checked,
    settled,
    failures,
  });
}
