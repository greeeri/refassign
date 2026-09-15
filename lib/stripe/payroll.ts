import { stripeConnectRequest } from "./connect";
import { stripeConnectMode } from "./runtime";

type ServiceClient = any;

export async function releasePayrollBatch(service: ServiceClient, batchId: string, key: string) {
  const { data: batch, error: batchError } = await service.from("payroll_batches").select("id,organization_id,league_id,idempotency_key,status,stripe_charge_id").eq("id", batchId).single();
  if (batchError || !batch) throw new Error(batchError?.message || "Payroll batch was not found.");
  if (batch.status === "paid") return { paid: true, duplicate: true, paidCount: 0 };
  if (!["settled", "paying", "partially_paid"].includes(batch.status)) throw new Error("Payroll funding has not settled.");

  const { data: items, error: itemError } = await service.from("payroll_batch_items").select("id,assignment_id,official_id,total_cents").eq("payroll_batch_id", batch.id);
  if (itemError || !items?.length) throw new Error(itemError?.message || "Payroll batch has no items.");
  const { data: accounts, error: accountError } = await service.from("official_stripe_accounts").select("official_id,stripe_account_id,onboarding_status,transfers_status,payouts_status").eq("stripe_mode", stripeConnectMode()).in("official_id", [...new Set(items.map((item) => item.official_id))]);
  if (accountError) throw new Error(accountError.message);
  const accountByOfficial = new Map<string, any>((accounts || []).map((account: any) => [account.official_id, account]));
  const now = new Date().toISOString();
  await service.from("payroll_batches").update({ status: "paying", updated_at: now }).eq("id", batch.id).in("status", ["settled", "partially_paid"]);
  let paidCount = 0;
  let failure = "";

  for (const item of items) {
    const account = accountByOfficial.get(item.official_id);
    if (!account?.stripe_account_id || account.onboarding_status !== "ready" || account.transfers_status !== "active" || account.payouts_status !== "active") { failure = "An official is no longer ready for Stripe payroll."; break; }
    const baseKey = `${batch.idempotency_key}-${item.id}`;
    const { data: prior } = await service.from("payroll_transfers").select("id,status,stripe_transfer_id").eq("payroll_batch_item_id", item.id).maybeSingle();
    if (prior?.status === "paid") { paidCount += 1; continue; }
    if (prior && prior.status !== "failed") { failure = "A payroll transfer is already processing."; break; }
    const transferKey = prior ? `${baseKey}-retry-${Date.now()}` : baseKey;
    const recordResult = prior
      ? await service.from("payroll_transfers").update({ status: "processing", idempotency_key: transferKey, failure_code: null, failure_message: null }).eq("id", prior.id).eq("status", "failed").select("id").maybeSingle()
      : await service.from("payroll_transfers").insert({ payroll_batch_id: batch.id, payroll_batch_item_id: item.id, official_id: item.official_id, stripe_account_id_snapshot: account.stripe_account_id, amount_cents: item.total_cents, status: "processing", idempotency_key: transferKey }).select("id").single();
    if (recordResult.error || !recordResult.data) { failure = recordResult.error?.message || "Transfer record could not be created."; break; }
    try {
      const form = new URLSearchParams({ amount: String(item.total_cents), currency: "usd", destination: account.stripe_account_id, transfer_group: `PAYROLL_${batch.id}` });
      if (batch.stripe_charge_id) form.set("source_transaction", batch.stripe_charge_id);
      form.set("metadata[payroll_batch_id]", batch.id);
      form.set("metadata[payroll_batch_item_id]", item.id);
      const transfer = await stripeConnectRequest<{ id: string }>("transfers", key, form, transferKey);
      await Promise.all([
        service.from("payroll_transfers").update({ stripe_transfer_id: transfer.id, status: "paid", transferred_at: now, paid_at: now }).eq("id", recordResult.data.id),
        service.from("payment_transactions").upsert({ organization_id: batch.organization_id, league_id: batch.league_id, transaction_type: "payroll", related_record_id: item.id, direction: "debit", status: "succeeded", amount_cents: item.total_cents, stripe_object_type: "transfer", stripe_object_id: transfer.id, idempotency_key: transferKey }, { onConflict: "idempotency_key" }),
        service.from("assignments").update({ payment_status: "paid", paid_at: now, payroll_updated_at: now }).eq("id", item.assignment_id),
      ]);
      paidCount += 1;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Stripe transfer failed.";
      await service.from("payroll_transfers").update({ status: "failed", failure_message: failure.slice(0, 1000) }).eq("id", recordResult.data.id);
      break;
    }
  }
  const status = paidCount === items.length ? "paid" : paidCount ? "partially_paid" : "on_hold";
  await Promise.all([
    service.from("payroll_batches").update({ status, paid_at: status === "paid" ? now : null, funding_failure_message: failure || null, updated_at: now }).eq("id", batch.id),
    service.from("payment_audit_events").insert({ organization_id: batch.organization_id, league_id: batch.league_id, payroll_batch_id: batch.id, entity_type: "payroll_batch", entity_id: batch.id, event_type: status === "paid" ? "payroll_paid" : "payroll_release_failed", new_values: { status, paid_count: paidCount, item_count: items.length }, metadata: { failure: failure || null } }),
  ]);
  if (status !== "paid") throw new Error(failure || "Payroll release did not complete.");
  return { paid: true, paidCount };
}
