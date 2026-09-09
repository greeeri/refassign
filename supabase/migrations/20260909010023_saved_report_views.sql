create table public.report_saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_key text not null check (report_key in ('operations','coverage','audit','payroll')),
  name text not null check (char_length(name) between 1 and 100),
  filters jsonb not null default '{}'::jsonb,
  is_favorite boolean not null default false,
  recipient_email text,
  frequency text not null default 'weekly' check (frequency in ('weekly','monthly')),
  send_day smallint not null default 1 check (send_day between 0 and 28),
  schedule_enabled boolean not null default false,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, user_id)
);

alter table public.report_saved_views enable row level security;
revoke all on table public.report_saved_views from anon;
grant select, insert, update, delete on table public.report_saved_views to authenticated;

create policy "Managers read their report views" on public.report_saved_views
for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = report_saved_views.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin','assignor')
  )
);
create policy "Managers create their report views" on public.report_saved_views
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = report_saved_views.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin','assignor')
  )
);
create policy "Managers update their report views" on public.report_saved_views
for update to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = report_saved_views.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin','assignor')
  )
) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = report_saved_views.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin','assignor')
  )
);
create policy "Managers delete their report views" on public.report_saved_views
for delete to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = report_saved_views.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin','assignor')
  )
);

create index report_saved_views_owner_idx on public.report_saved_views
  (organization_id, user_id, report_key, is_favorite desc, updated_at desc);
create index report_saved_views_due_idx on public.report_saved_views(next_send_at)
  where schedule_enabled;

comment on table public.report_saved_views is
  'User- and organization-scoped saved configurations for standard reports.';
