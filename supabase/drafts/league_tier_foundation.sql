-- DRAFT ONLY. This file is intentionally outside supabase/migrations.
-- It must not be applied until the organization-to-league ownership model is reviewed.
-- It only creates new objects and does not alter Iowa Soccer data or behavior.

create table if not exists public.saas_plan_definitions (
  code text primary key check (code in ('starter','pro','pro_founding','premier','enterprise')),
  display_name text not null,
  annual_price_cents integer check (annual_price_cents is null or annual_price_cents >= 0),
  included_officials integer check (included_officials is null or included_officials > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_plan_entitlements (
  plan_code text not null references public.saas_plan_definitions(code) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  limit_value integer,
  configuration jsonb not null default '{}'::jsonb,
  primary key (plan_code, feature_key)
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','billing','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

-- Keep the existing Stripe-backed subscription table as the billing source of truth.
-- It already contains organization_id; no duplicate subscription table is introduced.
alter table public.refassign_subscriptions
  add column if not exists additional_official_blocks integer not null default 0
    check (additional_official_blocks >= 0);

create index if not exists refassign_subscriptions_organization_idx
  on public.refassign_subscriptions(organization_id, created_at desc);

create table if not exists public.organization_entitlement_overrides (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  enabled boolean,
  limit_value integer,
  reason text not null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, feature_key),
  check (expires_at is null or expires_at > effective_at)
);

-- A league can be served by several organizations, and an organization can serve
-- several leagues. Optional location scoping permits geographic assignment splits.
create table if not exists public.organization_league_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  effective_from date not null default current_date,
  effective_through date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_through is null or effective_through >= effective_from)
);

create unique index if not exists organization_league_coverage_scope_idx
  on public.organization_league_coverage(
    organization_id,
    league_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    effective_from
  );

create table if not exists public.organization_assignor_coverage (
  user_id uuid not null references auth.users(id) on delete cascade,
  coverage_id uuid not null references public.organization_league_coverage(id) on delete cascade,
  role text not null default 'assignor' check (role in ('owner','admin','assignor','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, coverage_id, role)
);

create table if not exists public.league_assignment_templates (
  id uuid primary key default gen_random_uuid(),
  coverage_id uuid not null references public.organization_league_coverage(id) on delete cascade,
  sport_id uuid not null references public.sports(id) on delete restrict,
  level_id uuid references public.levels(id) on delete cascade,
  name text not null,
  effective_from date not null,
  effective_through date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (effective_through is null or effective_through >= effective_from)
);

create unique index if not exists league_assignment_template_scope_idx
  on public.league_assignment_templates(coverage_id, sport_id, coalesce(level_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);

create table if not exists public.league_assignment_template_positions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.league_assignment_templates(id) on delete cascade,
  position_name text not null,
  position_order integer not null check (position_order > 0),
  required boolean not null default true,
  default_fee_cents integer check (default_fee_cents is null or default_fee_cents >= 0),
  unique (template_id, position_order)
);

create table if not exists public.organization_usage_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  captured_on date not null default current_date,
  active_officials integer not null default 0 check (active_officials >= 0),
  games_created integer not null default 0 check (games_created >= 0),
  assignments_created integer not null default 0 check (assignments_created >= 0),
  primary key (organization_id, captured_on)
);

alter table public.saas_plan_definitions enable row level security;
alter table public.saas_plan_entitlements enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_entitlement_overrides enable row level security;
alter table public.organization_league_coverage enable row level security;
alter table public.organization_assignor_coverage enable row level security;
alter table public.league_assignment_templates enable row level security;
alter table public.league_assignment_template_positions enable row level security;
alter table public.organization_usage_snapshots enable row level security;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.can_access_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
  ) or public.is_super_admin();
$$;

create or replace function private.can_manage_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner','admin')
  ) or public.is_super_admin();
$$;

revoke all on function private.can_access_organization(uuid) from public, anon;
revoke all on function private.can_manage_organization(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_access_organization(uuid) to authenticated;
grant execute on function private.can_manage_organization(uuid) to authenticated;

grant select on public.saas_plan_definitions, public.saas_plan_entitlements to authenticated;
grant select on public.organizations, public.organization_memberships,
  public.organization_entitlement_overrides, public.organization_league_coverage,
  public.organization_assignor_coverage, public.league_assignment_templates,
  public.league_assignment_template_positions, public.organization_usage_snapshots
  to authenticated;
grant insert, update, delete on public.organization_memberships,
  public.organization_league_coverage, public.organization_assignor_coverage,
  public.league_assignment_templates, public.league_assignment_template_positions
  to authenticated;

create policy "Authenticated users read plan definitions" on public.saas_plan_definitions
for select to authenticated using (true);
create policy "Authenticated users read plan entitlements" on public.saas_plan_entitlements
for select to authenticated using (true);

create policy "Members read organizations" on public.organizations
for select to authenticated using (private.can_access_organization(id));

create policy "Members read organization memberships" on public.organization_memberships
for select to authenticated using (
  user_id = (select auth.uid()) or private.can_manage_organization(organization_id)
);
create policy "Managers add organization memberships" on public.organization_memberships
for insert to authenticated with check (private.can_manage_organization(organization_id));
create policy "Managers update organization memberships" on public.organization_memberships
for update to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));
create policy "Managers remove organization memberships" on public.organization_memberships
for delete to authenticated using (private.can_manage_organization(organization_id));

create policy "Members read organization subscriptions" on public.refassign_subscriptions
for select to authenticated using (
  user_id = (select auth.uid())
  or (organization_id is not null and private.can_access_organization(organization_id))
);

create policy "Members read entitlement overrides" on public.organization_entitlement_overrides
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Members read coverage" on public.organization_league_coverage
for select to authenticated using (private.can_access_organization(organization_id));
create policy "Managers add coverage" on public.organization_league_coverage
for insert to authenticated with check (private.can_manage_organization(organization_id));
create policy "Managers update coverage" on public.organization_league_coverage
for update to authenticated using (private.can_manage_organization(organization_id))
with check (private.can_manage_organization(organization_id));
create policy "Managers remove coverage" on public.organization_league_coverage
for delete to authenticated using (private.can_manage_organization(organization_id));

create policy "Assigned users read coverage roles" on public.organization_assignor_coverage
for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.organization_league_coverage coverage
    where coverage.id = coverage_id
      and private.can_manage_organization(coverage.organization_id)
  )
);
create policy "Managers add coverage roles" on public.organization_assignor_coverage
for insert to authenticated with check (exists (
  select 1 from public.organization_league_coverage coverage
  where coverage.id = coverage_id
    and private.can_manage_organization(coverage.organization_id)
));
create policy "Managers update coverage roles" on public.organization_assignor_coverage
for update to authenticated using (exists (
  select 1 from public.organization_league_coverage coverage
  where coverage.id = coverage_id
    and private.can_manage_organization(coverage.organization_id)
)) with check (exists (
  select 1 from public.organization_league_coverage coverage
  where coverage.id = coverage_id
    and private.can_manage_organization(coverage.organization_id)
));
create policy "Managers remove coverage roles" on public.organization_assignor_coverage
for delete to authenticated using (exists (
  select 1 from public.organization_league_coverage coverage
  where coverage.id = coverage_id
    and private.can_manage_organization(coverage.organization_id)
));

create policy "Coverage users read templates" on public.league_assignment_templates
for select to authenticated using (exists (
  select 1 from public.organization_league_coverage coverage
  left join public.organization_assignor_coverage access
    on access.coverage_id = coverage.id and access.user_id = (select auth.uid())
  where coverage.id = coverage_id
    and (access.user_id is not null or private.can_access_organization(coverage.organization_id))
));
create policy "Coverage users manage templates" on public.league_assignment_templates
for all to authenticated using (exists (
  select 1 from public.organization_league_coverage coverage
  left join public.organization_assignor_coverage access
    on access.coverage_id = coverage.id and access.user_id = (select auth.uid())
  where coverage.id = coverage_id
    and (access.role in ('owner','admin','assignor') or private.can_manage_organization(coverage.organization_id))
)) with check (exists (
  select 1 from public.organization_league_coverage coverage
  left join public.organization_assignor_coverage access
    on access.coverage_id = coverage.id and access.user_id = (select auth.uid())
  where coverage.id = coverage_id
    and (access.role in ('owner','admin','assignor') or private.can_manage_organization(coverage.organization_id))
));

create policy "Coverage users read template positions" on public.league_assignment_template_positions
for select to authenticated using (exists (
  select 1 from public.league_assignment_templates template
  where template.id = template_id
));
create policy "Coverage users manage template positions" on public.league_assignment_template_positions
for all to authenticated using (exists (
  select 1 from public.league_assignment_templates template
  where template.id = template_id
)) with check (exists (
  select 1 from public.league_assignment_templates template
  where template.id = template_id
));

create policy "Members read usage" on public.organization_usage_snapshots
for select to authenticated using (private.can_access_organization(organization_id));

insert into public.saas_plan_definitions
  (code,display_name,annual_price_cents,included_officials)
values
  ('starter','Starter',29900,50),
  ('pro','Pro',59900,100),
  ('pro_founding','Pro — Founding Organization',49900,100),
  ('premier','Premier',99900,250),
  ('enterprise','Enterprise',null,null)
on conflict (code) do update set
  display_name=excluded.display_name,
  annual_price_cents=excluded.annual_price_cents,
  included_officials=excluded.included_officials,
  updated_at=now();

insert into public.saas_plan_entitlements(plan_code,feature_key,enabled)
select plan.code, feature.feature_key, feature.enabled
from (values
  ('starter','game_management',true),
  ('starter','official_assignments',true),
  ('starter','basic_reporting',true),
  ('pro','game_management',true),
  ('pro','official_assignments',true),
  ('pro','basic_reporting',true),
  ('pro','payroll_processing',true),
  ('pro','advanced_reporting',true),
  ('pro','custom_rules',true),
  ('pro','priority_support',true),
  ('pro_founding','game_management',true),
  ('pro_founding','official_assignments',true),
  ('pro_founding','basic_reporting',true),
  ('pro_founding','payroll_processing',true),
  ('pro_founding','advanced_reporting',true),
  ('pro_founding','custom_rules',true),
  ('pro_founding','priority_support',true),
  ('premier','game_management',true),
  ('premier','official_assignments',true),
  ('premier','basic_reporting',true),
  ('premier','payroll_processing',true),
  ('premier','advanced_reporting',true),
  ('premier','custom_rules',true),
  ('premier','priority_support',true),
  ('premier','multi_sport',true),
  ('premier','advanced_analytics',true),
  ('premier','custom_integrations',true),
  ('enterprise','game_management',true),
  ('enterprise','official_assignments',true),
  ('enterprise','basic_reporting',true),
  ('enterprise','payroll_processing',true),
  ('enterprise','advanced_reporting',true),
  ('enterprise','custom_rules',true),
  ('enterprise','priority_support',true),
  ('enterprise','multi_sport',true),
  ('enterprise','advanced_analytics',true),
  ('enterprise','custom_integrations',true),
  ('enterprise','dedicated_account_manager',true),
  ('enterprise','onboarding_and_training',true),
  ('enterprise','custom_development',true)
) as feature(plan_code,feature_key,enabled)
join public.saas_plan_definitions plan on plan.code=feature.plan_code
on conflict (plan_code,feature_key) do update set enabled=excluded.enabled;

create or replace function public.create_pending_organization_subscription(
  p_user_id uuid,
  p_organization_name text,
  p_plan text,
  p_official_limit integer,
  p_stripe_price_id text,
  p_founding_offer boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_subscription_id uuid;
begin
  if p_user_id is null or length(trim(coalesce(p_organization_name,''))) not between 1 and 160 then
    raise exception 'A user and organization name are required.';
  end if;
  if not exists(select 1 from public.saas_plan_definitions where code=p_plan and active=true) then
    raise exception 'Unknown or inactive subscription plan.';
  end if;

  insert into public.organizations(name)
  values(trim(p_organization_name))
  returning id into v_organization_id;

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_organization_id,p_user_id,'owner');

  insert into public.refassign_subscriptions(
    user_id,organization_id,organization_name,plan,official_limit,
    stripe_price_id,status,founding_offer
  ) values (
    p_user_id,v_organization_id,trim(p_organization_name),p_plan,p_official_limit,
    p_stripe_price_id,'pending',p_founding_offer
  ) returning id into v_subscription_id;

  return v_subscription_id;
end;
$$;

revoke all on function public.create_pending_organization_subscription(uuid,text,text,integer,text,boolean)
  from public, anon, authenticated;
grant execute on function public.create_pending_organization_subscription(uuid,text,text,integer,text,boolean)
  to service_role;

-- Authoritative active-official definition for subscription capacity:
--   1. the official account logged in during the rolling prior six months; AND
--   2. the official accepted or declined a game covered by the organization during
--      the rolling prior six months.
-- This function remains a draft because it must be tested against a non-production
-- copy before becoming part of the migration sequence.
create or replace function public.count_active_officials_for_organization(
  p_organization_id uuid,
  p_as_of timestamptz default now()
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(distinct official.id)::integer
  from public.officials official
  join auth.users account on account.id = official.auth_user_id
  join public.assignments assignment on assignment.official_id = official.id
  join public.games game on game.id = assignment.game_id
  where official.active = true
    and account.last_sign_in_at >= p_as_of - interval '6 months'
    and assignment.status in ('accepted', 'declined')
    and assignment.responded_at >= p_as_of - interval '6 months'
    and exists (
      select 1
      from public.organization_league_coverage coverage
      where coverage.organization_id = p_organization_id
        and coverage.league_id = game.league_id
        and (coverage.location_id is null or coverage.location_id = game.location_id)
        and coverage.active = true
        and coverage.effective_from <= p_as_of::date
        and (coverage.effective_through is null or coverage.effective_through >= p_as_of::date)
    );
$$;

revoke all on function public.count_active_officials_for_organization(uuid,timestamptz)
  from public, anon, authenticated;
