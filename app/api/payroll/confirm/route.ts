import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { stripeConnectRequest } from "../../../../lib/stripe/connect";
import { releasePayrollBatch } from "../../../../lib/stripe/payroll";
import { stripeConnectConfig } from "../../../../lib/stripe/runtime";

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, ["owner", "admin", "billing"]);
  if (context.error) return context.error;
  const { service, organizationId } = context;
  let key = "";
  try { key = stripeConnectConfig().secretKey; }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe payroll is not configured." }, { status: 503 }); }
  const body = await request.json().catch(() => ({})) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: "Checkout session is required." }, { status: 400 });
  const session = await stripeConnectRequest<{ id: string; payment_status: string; payment_intent: string | null; client_reference_id: string | null; metadata?: Record<string, string> }>(`checkout/sessions/${encodeURIComponent(body.sessionId)}`, key);
  const batchId = session.metadata?.refassign_payroll_batch_id || session.client_reference_id;
  if (!batchId) return NextResponse.json({ error: "This is not a payroll checkout." }, { status: 400 });
  const { data: batch } = await service.from("payroll_batches").select("id,status").eq("id", batchId).eq("organization_id", organizationId).eq("stripe_checkout_session_id", session.id).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Payroll batch was not found." }, { status: 404 });
  if (session.payment_status !== "paid") return NextResponse.json({ settled: false, status: batch.status });
  const now = new Date().toISOString();
  const paymentIntent = session.payment_intent ? await stripeConnectRequest<{ latest_charge?: string | { id?: string; balance_transaction?: { fee?: number } } }>(`payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge.balance_transaction`, key) : null;
  const chargeId = typeof paymentIntent?.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent?.latest_charge?.id || null;
  const actualFee = typeof paymentIntent?.latest_charge === "object" ? paymentIntent.latest_charge.balance_transaction?.fee : null;
  await service.from("payroll_batches").update({ status: "settled", stripe_payment_intent_id: session.payment_intent, stripe_charge_id: chargeId, stripe_processing_cost_actual_cents: actualFee ?? null, funded_at: now, settled_at: now, funding_failure_message: null, updated_at: now }).eq("id", batch.id).eq("status", "funding");
  const result = await releasePayrollBatch(service, batch.id, key);
  return NextResponse.json({ settled: true, ...result });
}
