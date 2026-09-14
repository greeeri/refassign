import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../../lib/server/organizationScope";
import { stripeConnectRequest } from "../../../../lib/stripe/connect";

type Assignment = {
  id: string;
  status: string;
  official_id: string;
  game_id: string;
  game_fee: number | null;
  mileage_miles: number | null;
  mileage_rate: number | null;
  payment_status: string;
  officials: { id: string; first_name: string | null; last_name: string | null } | null;
  games: { organization_id: string; league_id: string; leagues: { id: string; name: string } | null } | null;
};

const cents = (value: number) => Math.max(0, Math.round(value * 100));

function feeForBatch(
  subtotal: number,
  rule: { fee_type?: string; flat_fee_cents?: number | null; percentage_basis_points?: number | null; minimum_fee_cents?: number | null; maximum_fee_cents?: number | null } | null,
) {
  if (!rule || rule.fee_type === "none") return 0;
  let fee = rule.fee_type === "flat"
    ? Number(rule.flat_fee_cents || 0)
    : Math.round(subtotal * Number(rule.percentage_basis_points || 0) / 10_000);
  if (rule.minimum_fee_cents != null) fee = Math.max(fee, Number(rule.minimum_fee_cents));
  if (rule.maximum_fee_cents != null) fee = Math.min(fee, Number(rule.maximum_fee_cents));
  return fee;
}

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, ["owner", "admin", "billing"]);
  if (context.error) return context.error;
  const { service, user, organizationId } = context;
  const key = process.env.STRIPE_CONNECT_TEST_SECRET_KEY || "";
  if (process.env.STRIPE_CONNECT_MODE !== "sandbox" || !/^(sk|rk)_test_/.test(key)) {
    return NextResponse.json({ error: "Stripe payroll transfers are currently limited to the configured sandbox." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as { assignmentIds?: string[] };
  const assignmentIds = [...new Set((body.assignmentIds || []).filter(Boolean))].sort();
  if (!assignmentIds.length) return NextResponse.json({ error: "Select approved payroll records." }, { status: 400 });
  if (assignmentIds.length > 250) return NextResponse.json({ error: "Process no more than 250 payroll records in one request." }, { status: 400 });

  const { data, error } = await service
    .from("assignments")
    .select("id,status,official_id,game_id,game_fee,mileage_miles,mileage_rate,payment_status,officials(id,first_name,last_name),games!inner(organization_id,league_id,leagues(id,name))")
    .in("id", assignmentIds)
    .eq("games.organization_id", organizationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const assignments = (data || []) as unknown as Assignment[];
  if (assignments.length !== assignmentIds.length) return NextResponse.json({ error: "One or more payroll records were not found in this organization." }, { status: 400 });
  if (assignments.some((row) => !["accepted", "confirmed"].includes(row.status) || row.payment_status !== "approved")) {
    return NextResponse.json({ error: "Every selected payroll record must be accepted and marked Approved." }, { status: 400 });
  }

  const leagueIds = [...new Set(assignments.map((row) => row.games?.league_id).filter(Boolean))] as string[];
  if (leagueIds.length !== 1) return NextResponse.json({ error: "Process one league at a time." }, { status: 400 });
  const leagueId = leagueIds[0];
  const officialIds = [...new Set(assignments.map((row) => row.official_id))];
  const [{ data: settings }, { data: rule }, { data: stripeAccounts }] = await Promise.all([
    service.from("league_payment_settings").select("payroll_enabled,payroll_hold,payroll_hold_reason,default_funding_method").eq("organization_id", organizationId).eq("league_id", leagueId).maybeSingle(),
    service.from("transaction_fee_rules").select("fee_type,flat_fee_cents,percentage_basis_points,minimum_fee_cents,maximum_fee_cents").eq("organization_id", organizationId).eq("league_id", leagueId).eq("transaction_type", "payroll").eq("active", true).maybeSingle(),
    service.from("official_stripe_accounts").select("official_id,stripe_account_id,onboarding_status,transfers_status,payouts_status").in("official_id", officialIds),
  ]);
  if (!settings?.payroll_enabled) return NextResponse.json({ error: "Stripe payroll is not enabled for this league." }, { status: 400 });
  if (settings.payroll_hold) return NextResponse.json({ error: settings.payroll_hold_reason || "Payroll is on hold for this league." }, { status: 400 });
  const accountByOfficial = new Map((stripeAccounts || []).map((account) => [account.official_id, account]));
  const unavailable = assignments.find((row) => {
    const account = accountByOfficial.get(row.official_id);
    return !account?.stripe_account_id || account.onboarding_status !== "ready" || account.transfers_status !== "active" || account.payouts_status !== "active";
  });
  if (unavailable) return NextResponse.json({ error: `${unavailable.officials?.first_name || "An official"} is not ready for Stripe payroll.` }, { status: 400 });

  const itemValues = assignments.map((row) => {
    const gameFeeCents = cents(Number(row.game_fee || 0));
    const mileageAmountCents = cents(Number(row.mileage_miles || 0) * Number(row.mileage_rate || 0));
    return { row, gameFeeCents, mileageAmountCents, totalCents: gameFeeCents + mileageAmountCents };
  });
  if (itemValues.some((item) => item.totalCents <= 0)) return NextResponse.json({ error: "Each payroll record must have an amount greater than zero." }, { status: 400 });
  const subtotal = itemValues.reduce((sum, item) => sum + item.totalCents, 0);
  const refassignFee = feeForBatch(subtotal, rule);
  const fingerprint = createHash("sha256").update(`${organizationId}:${assignmentIds.join(",")}`).digest("hex").slice(0, 32);
  const batchKey = `payroll-${fingerprint}`;
  const now = new Date().toISOString();

  const { data: existing } = await service.from("payroll_batches").select("id,status").eq("idempotency_key", batchKey).maybeSingle();
  if (existing?.status === "paid") return NextResponse.json({ paid: true, duplicate: true, batchId: existing.id });
  if (existing) return NextResponse.json({ error: "This payroll batch already exists and requires review before retrying." }, { status: 409 });

  const { data: batch, error: batchError } = await service.from("payroll_batches").insert({
    organization_id: organizationId,
    league_id: leagueId,
    status: "approved",
    payroll_subtotal_cents: subtotal,
    stripe_processing_cost_cents: 0,
    refassign_fee_cents: refassignFee,
    total_funding_cents: subtotal + refassignFee,
    fee_type_snapshot: rule?.fee_type || "none",
    fee_value_snapshot: rule?.fee_type === "flat" ? Number(rule.flat_fee_cents || 0) : Number(rule?.percentage_basis_points || 0),
    fee_minimum_cents_snapshot: rule?.minimum_fee_cents ?? null,
    fee_maximum_cents_snapshot: rule?.maximum_fee_cents ?? null,
    funding_method: settings.default_funding_method,
    idempotency_key: batchKey,
    approved_by: user.id,
    approved_at: now,
    locked_at: now,
    created_by: user.id,
  }).select("id,batch_number").single();
  if (batchError || !batch) return NextResponse.json({ error: batchError?.message || "Payroll batch could not be created." }, { status: 400 });

  const { data: items, error: itemError } = await service.from("payroll_batch_items").insert(itemValues.map(({ row, gameFeeCents, mileageAmountCents, totalCents }) => ({
    payroll_batch_id: batch.id,
    assignment_id: row.id,
    official_id: row.official_id,
    official_name_snapshot: `${row.officials?.first_name || ""} ${row.officials?.last_name || ""}`.trim() || "Official",
    game_id: row.game_id,
    game_fee_cents: gameFeeCents,
    mileage_miles_snapshot: Number(row.mileage_miles || 0),
    mileage_rate_cents_snapshot: cents(Number(row.mileage_rate || 0)),
    mileage_amount_cents: mileageAmountCents,
    total_cents: totalCents,
    memo: `RefAssign payroll batch ${batch.batch_number}`,
  }))).select("id,assignment_id,official_id,total_cents");
  if (itemError || !items) {
    await service.from("payroll_batches").update({ status: "void" }).eq("id", batch.id);
    return NextResponse.json({ error: itemError?.message || "Payroll batch items could not be created." }, { status: 400 });
  }

  await service.from("payroll_batches").update({ status: "paying" }).eq("id", batch.id);
  let paidCount = 0;
  let failure = "";
  for (const item of items) {
    const account = accountByOfficial.get(item.official_id)!;
    const transferKey = `${batchKey}-${item.id}`;
    const { data: transferRecord, error: transferRecordError } = await service.from("payroll_transfers").insert({
      payroll_batch_id: batch.id,
      payroll_batch_item_id: item.id,
      official_id: item.official_id,
      stripe_account_id_snapshot: account.stripe_account_id,
      amount_cents: item.total_cents,
      status: "processing",
      idempotency_key: transferKey,
    }).select("id").single();
    if (transferRecordError || !transferRecord) { failure = transferRecordError?.message || "Transfer record could not be created."; break; }
    try {
      const form = new URLSearchParams({ amount: String(item.total_cents), currency: "usd", destination: account.stripe_account_id, transfer_group: `PAYROLL_${batch.id}`, "metadata[payroll_batch_id]": batch.id, "metadata[payroll_batch_item_id]": item.id });
      const transfer = await stripeConnectRequest<{ id: string }>("transfers", key, form, transferKey);
      await Promise.all([
        service.from("payroll_transfers").update({ stripe_transfer_id: transfer.id, status: "paid", transferred_at: now, paid_at: now }).eq("id", transferRecord.id),
        service.from("payment_transactions").insert({ organization_id: organizationId, league_id: leagueId, transaction_type: "payroll", related_record_id: item.id, direction: "debit", status: "succeeded", amount_cents: item.total_cents, stripe_object_type: "transfer", stripe_object_id: transfer.id, idempotency_key: transferKey }),
        service.from("assignments").update({ payment_status: "paid", paid_at: now, payroll_updated_at: now, payroll_updated_by: user.id }).eq("id", item.assignment_id),
      ]);
      paidCount += 1;
    } catch (transferError) {
      failure = transferError instanceof Error ? transferError.message : "Stripe transfer failed.";
      await service.from("payroll_transfers").update({ status: "failed", failure_message: failure.slice(0, 1000) }).eq("id", transferRecord.id);
      break;
    }
  }

  const finalStatus = paidCount === items.length ? "paid" : paidCount ? "partially_paid" : "funding_failed";
  await Promise.all([
    service.from("payroll_batches").update({ status: finalStatus, paid_at: finalStatus === "paid" ? now : null, updated_at: now }).eq("id", batch.id),
    service.from("payment_audit_events").insert({ organization_id: organizationId, league_id: leagueId, payroll_batch_id: batch.id, entity_type: "payroll_batch", entity_id: batch.id, event_type: finalStatus === "paid" ? "sandbox_payroll_paid" : "sandbox_payroll_failed", actor_user_id: user.id, new_values: { status: finalStatus, paid_count: paidCount, item_count: items.length }, metadata: { failure: failure || null, stripe_mode: "sandbox" } }),
  ]);
  if (finalStatus !== "paid") return NextResponse.json({ error: failure || "Stripe payroll did not complete.", batchId: batch.id, paidCount }, { status: 502 });
  return NextResponse.json({ paid: true, batchId: batch.id, batchNumber: batch.batch_number, paidCount, payrollSubtotalCents: subtotal, refassignFeeCents: refassignFee });
}
