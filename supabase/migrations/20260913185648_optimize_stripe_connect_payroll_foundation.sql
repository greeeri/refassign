-- Phase 1 advisor cleanup: cover payment-ledger foreign keys and avoid
-- overlapping permissive SELECT policies on Super Admin configuration tables.

create index if not exists transaction_fee_rules_league_idx on public.transaction_fee_rules(league_id);
create index if not exists transaction_fee_rules_created_by_idx on public.transaction_fee_rules(created_by);
create index if not exists transaction_fee_rules_updated_by_idx on public.transaction_fee_rules(updated_by);
create index if not exists league_payment_settings_league_idx on public.league_payment_settings(league_id);
create index if not exists league_payment_settings_hold_by_idx on public.league_payment_settings(payroll_hold_by);
create index if not exists payroll_batches_league_idx on public.payroll_batches(league_id);
create index if not exists payroll_batches_approved_by_idx on public.payroll_batches(approved_by);
create index if not exists payroll_batches_created_by_idx on public.payroll_batches(created_by);
create index if not exists payroll_batch_items_game_idx on public.payroll_batch_items(game_id);
create index if not exists payment_transactions_league_idx on public.payment_transactions(league_id);
create index if not exists payment_audit_events_league_idx on public.payment_audit_events(league_id);
create index if not exists payment_audit_events_batch_idx on public.payment_audit_events(payroll_batch_id);
create index if not exists payment_audit_events_actor_idx on public.payment_audit_events(actor_user_id);

drop policy if exists "Super admins manage transaction fee rules" on public.transaction_fee_rules;
create policy "Super admins add transaction fee rules" on public.transaction_fee_rules
for insert to authenticated with check ((select public.is_super_admin()));
create policy "Super admins update transaction fee rules" on public.transaction_fee_rules
for update to authenticated using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins delete transaction fee rules" on public.transaction_fee_rules
for delete to authenticated using ((select public.is_super_admin()));

drop policy if exists "Super admins manage league payment settings" on public.league_payment_settings;
create policy "Super admins add league payment settings" on public.league_payment_settings
for insert to authenticated with check ((select public.is_super_admin()));
create policy "Super admins update league payment settings" on public.league_payment_settings
for update to authenticated using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));
create policy "Super admins delete league payment settings" on public.league_payment_settings
for delete to authenticated using ((select public.is_super_admin()));
