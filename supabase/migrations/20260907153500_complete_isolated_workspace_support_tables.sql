-- Complete the operational support schema expected by /workspace in the
-- isolated RefAssign test project. All exposed tables use organization-aware
-- RLS; no Iowa Soccer program tables or data are changed.

alter table public.teams
  add column if not exists level_id uuid references public.levels(id) on delete set null,
  add column if not exists active boolean not null default true;

alter table public.officials
  add column if not exists home_latitude double precision,
  add column if not exists home_longitude double precision;

create table if not exists public.official_soccer_position_rankings (
  official_id uuid primary key references public.officials(id) on delete cascade,
  ref_rank numeric(3,1) not null default 1.0 check (ref_rank between 1 and 10),
  ar1_rank numeric(3,1) not null default 1.0 check (ar1_rank between 1 and 10),
  ar2_rank numeric(3,1) not null default 1.0 check (ar2_rank between 1 and 10),
  fourth_rank numeric(3,1) not null default 1.0 check (fourth_rank between 1 and 10),
  mentor_rank numeric(3,1) not null default 1.0 check (mentor_rank between 1 and 10),
  updated_at timestamptz not null default now()
);

insert into public.official_soccer_position_rankings(official_id)
select id from public.officials on conflict (official_id) do nothing;

create table if not exists public.official_league_eligibility (
  official_id uuid not null references public.officials(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (official_id, league_id)
);

create table if not exists public.official_level_eligibility (
  official_id uuid not null references public.officials(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (official_id, level_id)
);

create table if not exists public.team_power_rankings (
  team_id uuid primary key references public.teams(id) on delete cascade,
  power numeric(3,1) not null default 1.0 check (power between 1 and 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.team_power_rankings(team_id)
select id from public.teams on conflict (team_id) do nothing;

create table if not exists public.official_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  official_id uuid not null references public.officials(id) on delete cascade,
  block_type text not null check (block_type in ('date','location','team','time')),
  start_date date,
  end_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  location_id uuid references public.locations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  notes text,
  source_assignment_id uuid references public.assignments(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists official_availability_blocks_official_idx
  on public.official_availability_blocks(official_id, created_at desc);

create table if not exists public.block_removal_requests (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.official_availability_blocks(id) on delete cascade,
  official_id uuid not null references public.officials(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  request_note text,
  requested_at timestamptz not null default now(),
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  block_type text,
  block_start_date date,
  block_end_date date,
  block_starts_at timestamptz,
  block_ends_at timestamptz,
  block_notes text
);

create index if not exists block_removal_requests_status_idx
  on public.block_removal_requests(status, requested_at desc);

create table if not exists public.auto_assign_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  level_id uuid references public.levels(id) on delete cascade,
  position_id uuid not null references public.sport_positions(id) on delete cascade,
  max_games_per_day integer not null default 2 check (max_games_per_day between 1 and 10),
  rest_days integer not null default 0 check (rest_days between 0 and 30),
  same_team_days integer not null default 7 check (same_team_days between 0 and 90),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auto_assign_rules_scope_key
  on public.auto_assign_rules(organization_id, coalesce(level_id, '00000000-0000-0000-0000-000000000000'::uuid), position_id);

create table if not exists public.import_error_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  import_type text not null,
  file_name text,
  error_message text not null,
  row_number integer,
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists import_error_log_unresolved_idx
  on public.import_error_log(organization_id, created_at desc) where resolved_at is null;

create table if not exists public.audit_history (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('assignment','game')),
  entity_id uuid not null,
  game_id uuid references public.games(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  summary text not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_history_org_time_idx
  on public.audit_history(organization_id, occurred_at desc);
create index if not exists audit_history_game_time_idx
  on public.audit_history(game_id, occurred_at desc);

alter table public.official_soccer_position_rankings enable row level security;
alter table public.official_league_eligibility enable row level security;
alter table public.official_level_eligibility enable row level security;
alter table public.team_power_rankings enable row level security;
alter table public.official_availability_blocks enable row level security;
alter table public.block_removal_requests enable row level security;
alter table public.auto_assign_rules enable row level security;
alter table public.import_error_log enable row level security;
alter table public.audit_history enable row level security;

create policy "Organization members view position rankings"
on public.official_soccer_position_rankings for select to authenticated
using (exists (
  select 1 from public.organization_officials oo
  join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_soccer_position_rankings.official_id and oo.active and m.user_id=(select auth.uid())
));
create policy "Organization managers manage position rankings"
on public.official_soccer_position_rankings for all to authenticated
using (exists (
  select 1 from public.organization_officials oo
  join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_soccer_position_rankings.official_id and oo.active and m.user_id=(select auth.uid())
    and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_officials oo
  join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_soccer_position_rankings.official_id and oo.active and m.user_id=(select auth.uid())
    and m.role in ('owner','admin','assignor')
));

create policy "Organization members view league eligibility"
on public.official_league_eligibility for select to authenticated
using (exists (
  select 1 from public.organization_officials oo
  join public.organization_league_coverage c on c.organization_id=oo.organization_id and c.league_id=official_league_eligibility.league_id
  join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_league_eligibility.official_id and oo.active and c.active and m.user_id=(select auth.uid())
));
create policy "Organization managers manage league eligibility"
on public.official_league_eligibility for all to authenticated
using (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_league_eligibility.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_league_eligibility.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Organization members view level eligibility"
on public.official_level_eligibility for select to authenticated
using (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_level_eligibility.official_id and oo.active and m.user_id=(select auth.uid())
));
create policy "Organization managers manage level eligibility"
on public.official_level_eligibility for all to authenticated
using (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_level_eligibility.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_level_eligibility.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Organization members view team power"
on public.team_power_rankings for select to authenticated
using (exists (
  select 1 from public.teams t join public.organization_memberships m on m.organization_id=t.organization_id
  where t.id=team_power_rankings.team_id and m.user_id=(select auth.uid())
));
create policy "Organization managers manage team power"
on public.team_power_rankings for all to authenticated
using (exists (
  select 1 from public.teams t join public.organization_memberships m on m.organization_id=t.organization_id
  where t.id=team_power_rankings.team_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.teams t join public.organization_memberships m on m.organization_id=t.organization_id
  where t.id=team_power_rankings.team_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Officials and organization members view blocks"
on public.official_availability_blocks for select to authenticated
using (
  exists (select 1 from public.officials o where o.id=official_availability_blocks.official_id and o.auth_user_id=(select auth.uid()))
  or exists (
    select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
    where oo.official_id=official_availability_blocks.official_id and m.user_id=(select auth.uid())
  )
);
create policy "Officials and organization managers create blocks"
on public.official_availability_blocks for insert to authenticated
with check (
  exists (select 1 from public.officials o where o.id=official_availability_blocks.official_id and o.auth_user_id=(select auth.uid()))
  or exists (
    select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
    where oo.official_id=official_availability_blocks.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
  )
);
create policy "Organization managers remove blocks"
on public.official_availability_blocks for delete to authenticated
using (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=official_availability_blocks.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Officials and organization members view removal requests"
on public.block_removal_requests for select to authenticated
using (
  exists (select 1 from public.officials o where o.id=block_removal_requests.official_id and o.auth_user_id=(select auth.uid()))
  or exists (
    select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
    where oo.official_id=block_removal_requests.official_id and m.user_id=(select auth.uid())
  )
);
create policy "Officials request block removal"
on public.block_removal_requests for insert to authenticated
with check (exists (
  select 1 from public.officials o where o.id=block_removal_requests.official_id and o.auth_user_id=(select auth.uid())
));
create policy "Organization managers review block removal"
on public.block_removal_requests for update to authenticated
using (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=block_removal_requests.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_officials oo join public.organization_memberships m on m.organization_id=oo.organization_id
  where oo.official_id=block_removal_requests.official_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Organization members view auto assign rules"
on public.auto_assign_rules for select to authenticated
using (exists (
  select 1 from public.organization_memberships m where m.organization_id=auto_assign_rules.organization_id and m.user_id=(select auth.uid())
));
create policy "Organization managers manage auto assign rules"
on public.auto_assign_rules for all to authenticated
using (exists (
  select 1 from public.organization_memberships m where m.organization_id=auto_assign_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_memberships m where m.organization_id=auto_assign_rules.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Organization managers manage import errors"
on public.import_error_log for all to authenticated
using (exists (
  select 1 from public.organization_memberships m where m.organization_id=import_error_log.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
)) with check (exists (
  select 1 from public.organization_memberships m where m.organization_id=import_error_log.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','assignor')
));

create policy "Organization members view audit history"
on public.audit_history for select to authenticated
using (exists (
  select 1 from public.organization_memberships m where m.organization_id=audit_history.organization_id and m.user_id=(select auth.uid())
));

grant select,insert,update,delete on public.official_soccer_position_rankings to authenticated;
grant select,insert,update,delete on public.official_league_eligibility to authenticated;
grant select,insert,update,delete on public.official_level_eligibility to authenticated;
grant select,insert,update,delete on public.team_power_rankings to authenticated;
grant select,insert,update,delete on public.official_availability_blocks to authenticated;
grant select,insert,update on public.block_removal_requests to authenticated;
grant select,insert,update,delete on public.auto_assign_rules to authenticated;
grant select,insert,update on public.import_error_log to authenticated;
grant select on public.audit_history to authenticated;
grant usage,select on sequence public.import_error_log_id_seq to authenticated;

create or replace function public.set_team_power(p_team_id uuid, p_power numeric)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_power < 1 or p_power > 10 then raise exception 'Power must be between 1 and 10'; end if;
  insert into public.team_power_rankings(team_id,power,updated_at,updated_by)
  values(p_team_id,p_power,now(),auth.uid())
  on conflict(team_id) do update set power=excluded.power,updated_at=now(),updated_by=auth.uid();
end $$;
revoke all on function public.set_team_power(uuid,numeric) from public,anon;
grant execute on function public.set_team_power(uuid,numeric) to authenticated;

notify pgrst, 'reload schema';
