-- Assign the pre-organization production dataset to one legacy workspace.
-- This migration intentionally does not replace existing operational RLS policies.

alter table public.games
  add column if not exists organization_id uuid
  references public.organizations(id) on delete restrict;

alter table public.auto_assign_rules
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

alter table public.import_error_log
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

alter table public.audit_history
  add column if not exists organization_id uuid
  references public.organizations(id) on delete cascade;

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','assignor','billing','viewer')),
  created_at timestamptz not null default now(),
  viewer_permissions text[] not null default '{}'::text[],
  primary key (organization_id,user_id,role)
);

create table if not exists public.organization_league_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  effective_from date not null default current_date,
  effective_through date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  coverage_type text not null default 'All locations'
    check (coverage_type in ('All locations','Selected locations only','Shared by region')),
  check (effective_through is null or effective_through >= effective_from)
);

create table if not exists public.organization_officials (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (organization_id,official_id)
);

create table if not exists public.organization_locations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  display_name text,
  notes text,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id,location_id)
);

create table if not exists public.organization_member_league_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id,league_id)
);

alter table public.organization_memberships enable row level security;
alter table public.organization_league_coverage enable row level security;
alter table public.organization_officials enable row level security;
alter table public.organization_locations enable row level security;
alter table public.organization_member_league_access enable row level security;

create unique index if not exists organization_league_coverage_scope_idx
  on public.organization_league_coverage (
    organization_id,
    league_id,
    coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),
    effective_from
  );

create index if not exists games_organization_league_idx
  on public.games(organization_id,league_id,starts_at);
create index if not exists auto_assign_rules_organization_idx
  on public.auto_assign_rules(organization_id);
create index if not exists import_error_log_organization_idx
  on public.import_error_log(organization_id);
create index if not exists audit_history_organization_idx
  on public.audit_history(organization_id);

do $$
declare
  v_organization_id uuid;
  v_owner_id uuid;
  v_test_count integer;
  v_owner_count integer;
begin
  select count(*) into v_test_count
  from public.organizations
  where lower(name)=lower('Test');

  if v_test_count > 1 then
    raise exception 'More than one Test organization exists; legacy backfill was stopped.';
  end if;

  if v_test_count = 0 then
    insert into public.organizations(name)
    values ('Test')
    returning id into v_organization_id;
  else
    select id into v_organization_id
    from public.organizations
    where lower(name)=lower('Test');
  end if;

  select count(distinct user_id) into v_owner_count
  from public.user_roles
  where role='super_admin';

  if v_owner_count <> 1 then
    raise exception 'Expected exactly one super-admin owner; found %.',v_owner_count;
  end if;

  select user_id into v_owner_id
  from public.user_roles
  where role='super_admin'
  limit 1;

  insert into public.organization_memberships(
    organization_id,user_id,role,viewer_permissions
  )
  values (v_organization_id,v_owner_id,'owner','{}'::text[])
  on conflict (organization_id,user_id,role) do nothing;

  insert into public.organization_league_coverage(
    organization_id,league_id,coverage_type
  )
  select v_organization_id,league.id,'All locations'
  from public.leagues league
  where not exists (
    select 1
    from public.organization_league_coverage coverage
    where coverage.organization_id=v_organization_id
      and coverage.league_id=league.id
      and coverage.location_id is null
      and coverage.active
  );

  insert into public.organization_member_league_access(
    organization_id,user_id,league_id
  )
  select v_organization_id,v_owner_id,league.id
  from public.leagues league
  on conflict (organization_id,user_id,league_id) do nothing;

  insert into public.organization_officials(
    organization_id,official_id,active,added_by
  )
  select v_organization_id,official.id,official.active,v_owner_id
  from public.officials official
  on conflict (organization_id,official_id) do update
    set active=excluded.active;

  insert into public.organization_locations(
    organization_id,location_id,active,added_by
  )
  select v_organization_id,location.id,location.active,v_owner_id
  from public.locations location
  on conflict (organization_id,location_id) do update
    set active=excluded.active;

  update public.teams set organization_id=v_organization_id;
  update public.games set organization_id=v_organization_id;
  update public.auto_assign_rules set organization_id=v_organization_id;
  update public.import_error_log set organization_id=v_organization_id;
  update public.audit_history set organization_id=v_organization_id;
  update public.refassign_subscriptions set organization_id=v_organization_id;

  if exists(select 1 from public.teams where organization_id is distinct from v_organization_id)
    or exists(select 1 from public.games where organization_id is distinct from v_organization_id)
    or exists(select 1 from public.auto_assign_rules where organization_id is distinct from v_organization_id)
    or exists(select 1 from public.import_error_log where organization_id is distinct from v_organization_id)
    or exists(select 1 from public.audit_history where organization_id is distinct from v_organization_id)
    or exists(select 1 from public.refassign_subscriptions where organization_id is distinct from v_organization_id)
  then
    raise exception 'Legacy organization backfill did not cover every organization-scoped row.';
  end if;
end
$$;
