import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { releasePayrollBatch } from "../../../../lib/stripe/payroll";
import {
  stripeConnectConfig,
  stripeConnectMode,
} from "../../../../lib/stripe/runtime";

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, [
    "owner",
    "admin",
    "billing",
  ]);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  if (leagueIds && !leagueIds.length)
    return NextResponse.json({ batches: [] });
  let batchQuery = service
    .from("payroll_batches")
    .select(
      "id,batch_number,league_id,bill_to_id,status,payroll_subtotal_cents,stripe_processing_cost_cents,stripe_processing_cost_actual_cents,refassign_fee_cents,total_funding_cents,funding_method,stripe_checkout_session_id,stripe_payment_intent_id,funding_failure_message,created_at,funded_at,settled_at,paid_at,leagues(name),bill_to:bill_to_accounts(name,email)",
    )
    .eq("organization_id", organizationId)
    .eq("stripe_mode", stripeConnectMode());
  if (leagueIds) batchQuery = batchQuery.in("league_id", leagueIds);
  const { data: batches, error } = await batchQuery
    .order("created_at", { ascending: false })
    .limit(50);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  const ids = (batches || []).map((batch) => batch.id);
  if (!ids.length) return NextResponse.json({ batches: [] });
  const [{ data: items }, { data: transfers }] = await Promise.all([
    service
      .from("payroll_batch_items")
      .select("id,payroll_batch_id,official_name_snapshot,total_cents")
      .in("payroll_batch_id", ids),
    service
      .from("payroll_transfers")
      .select(
        "id,payroll_batch_id,payroll_batch_item_id,amount_cents,status,stripe_transfer_id,failure_message,paid_at",
      )
      .in("payroll_batch_id", ids),
  ]);
  return NextResponse.json({
    batches: (batches || []).map((batch) => ({
      ...batch,
      items: (items || [])
        .filter((item) => item.payroll_batch_id === batch.id)
        .map((item) => ({
          ...item,
          transfer:
            (transfers || []).find(
              (transfer) => transfer.payroll_batch_item_id === item.id,
            ) || null,
        })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, [
    "owner",
    "admin",
    "billing",
  ]);
  if (context.error) return context.error;
  const { service, organizationId, leagueIds } = context;
  let key = "";
  try {
    key = stripeConnectConfig().secretKey;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stripe payroll is not configured.",
      },
      { status: 503 },
    );
  }
  const { batchId } = (await request.json().catch(() => ({}))) as {
    batchId?: string;
  };
  if (!batchId)
    return NextResponse.json(
      { error: "Payroll batch is required." },
      { status: 400 },
    );
  const { data: batch } = await service
    .from("payroll_batches")
    .select("id,league_id,status,stripe_payment_intent_id,funding_failure_message")
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!batch)
    return NextResponse.json(
      { error: "Payroll batch was not found." },
      { status: 404 },
    );
  if (leagueIds && !leagueIds.includes(batch.league_id))
    return NextResponse.json(
      { error: "You do not have billing access to this league." },
      { status: 403 },
    );
  if (
    !["partially_paid", "on_hold"].includes(batch.status) ||
    !batch.stripe_payment_intent_id
  )
    return NextResponse.json(
      {
        error:
          "Only a funded batch with a failed official transfer can be retried.",
      },
      { status: 409 },
    );
  if (/returned|refund|dispute/i.test(batch.funding_failure_message || ""))
    return NextResponse.json(
      {
        error:
          "Funding was returned or disputed; this batch cannot be released.",
      },
      { status: 409 },
    );
  await service
    .from("payroll_batches")
    .update({
      status: "settled",
      funding_failure_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batch.id);
  try {
    return NextResponse.json(await releasePayrollBatch(service, batch.id, key));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Payroll retry failed.",
      },
      { status: 502 },
    );
  }
}
