-- Cover the high-volume filters used by assigning, availability, decline,
-- reporting, and scheduled-report workflows as organizations grow.
create index if not exists assignment_declines_official_time_idx
  on public.assignment_declines (official_id, declined_at desc);

create index if not exists assignment_declines_position_idx
  on public.assignment_declines (position_id);

create index if not exists assignments_position_idx
  on public.assignments (position_id);

create index if not exists block_removal_requests_official_time_idx
  on public.block_removal_requests (official_id, requested_at desc);

create index if not exists audit_history_org_action_time_idx
  on public.audit_history (organization_id, action, occurred_at desc);

create index if not exists custom_report_templates_due_idx
  on public.custom_report_templates (schedule_enabled, next_send_at)
  where schedule_enabled = true;

create index if not exists custom_report_templates_organization_idx
  on public.custom_report_templates (organization_id);
