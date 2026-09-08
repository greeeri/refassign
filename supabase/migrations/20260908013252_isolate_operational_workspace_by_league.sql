create table if not exists public.organization_member_league_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id,league_id)
);

alter table public.organization_member_league_access enable row level security;

create or replace function private.is_organization_owner_or_admin(
  p_organization_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user_id is not null and exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization_id
      and membership.user_id=p_user_id
      and membership.role in ('owner','admin')
  )
$$;

create or replace function private.can_access_organization_league(
  p_organization_id uuid,
  p_league_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user_id is not null
    and exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id=p_organization_id
        and coverage.league_id=p_league_id
        and coverage.active
    )
    and (
      private.is_organization_owner_or_admin(p_organization_id,p_user_id)
      or exists (
        select 1
        from public.organization_memberships membership
        join public.organization_member_league_access access
          on access.organization_id=membership.organization_id
         and access.user_id=membership.user_id
         and access.league_id=p_league_id
        where membership.organization_id=p_organization_id
          and membership.user_id=p_user_id
          and membership.role in ('assignor','viewer','billing')
      )
    )
$$;

create or replace function private.can_manage_organization_league(
  p_organization_id uuid,
  p_league_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_organization_owner_or_admin(p_organization_id,p_user_id)
    or exists (
      select 1
      from public.organization_memberships membership
      join public.organization_member_league_access access
        on access.organization_id=membership.organization_id
       and access.user_id=membership.user_id
       and access.league_id=p_league_id
      where membership.organization_id=p_organization_id
        and membership.user_id=p_user_id
        and membership.role='assignor'
    )
$$;

-- Preserve current assignor access before enforcing explicit league scopes.
insert into public.organization_member_league_access(organization_id,user_id,league_id)
select distinct membership.organization_id,membership.user_id,coverage.league_id
from public.organization_memberships membership
join public.organization_league_coverage coverage
  on coverage.organization_id=membership.organization_id and coverage.active
where membership.role='assignor'
on conflict do nothing;

drop policy if exists "Users read own league access" on public.organization_member_league_access;
create policy "Users read own league access"
on public.organization_member_league_access for select to authenticated
using (
  user_id=(select auth.uid())
  or private.is_organization_owner_or_admin(organization_id,(select auth.uid()))
);

drop policy if exists "Organization admins manage league access" on public.organization_member_league_access;
create policy "Organization admins manage league access"
on public.organization_member_league_access for all to authenticated
using (private.is_organization_owner_or_admin(organization_id,(select auth.uid())))
with check (
  private.is_organization_owner_or_admin(organization_id,(select auth.uid()))
  and exists (
    select 1 from public.organization_league_coverage coverage
    where coverage.organization_id=organization_member_league_access.organization_id
      and coverage.league_id=organization_member_league_access.league_id
      and coverage.active
  )
);

alter table public.games
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists games_organization_league_idx
  on public.games(organization_id,league_id,starts_at);

-- Safe backfill only where a league belongs to exactly one organization.
with unique_coverage as (
  select league_id,min(organization_id::text)::uuid organization_id
  from public.organization_league_coverage
  where active
  group by league_id
  having count(distinct organization_id)=1
)
update public.games game
set organization_id=coverage.organization_id
from unique_coverage coverage
where game.organization_id is null and game.league_id=coverage.league_id;

create or replace function private.validate_game_organization_league()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.organization_id is null then
    raise exception 'Organization is required for operational workspace games.';
  end if;
  if new.league_id is null or not exists (
    select 1 from public.organization_league_coverage coverage
    where coverage.organization_id=new.organization_id
      and coverage.league_id=new.league_id
      and coverage.active
  ) then
    raise exception 'The selected league is not connected to this organization.';
  end if;
  return new;
end $$;

drop trigger if exists validate_game_organization_league on public.games;
create trigger validate_game_organization_league
before insert or update of organization_id,league_id on public.games
for each row execute function private.validate_game_organization_league();

create or replace function private.can_read_organization_game(
  p_game_id uuid,
  p_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.games game
    where game.id=p_game_id
      and game.organization_id is not null
      and game.league_id is not null
      and (
        private.can_access_organization_league(game.organization_id,game.league_id,p_user_id)
        or exists (
          select 1
          from public.assignments assignment
          join public.officials official on official.id=assignment.official_id
          where assignment.game_id=game.id and official.auth_user_id=p_user_id
        )
      )
  )
$$;

alter table public.games enable row level security;
drop policy if exists "Organization league users read games" on public.games;
create policy "Organization league users read games"
on public.games for select to authenticated
using (private.can_read_organization_game(id,(select auth.uid())));

drop policy if exists "Organization league managers create games" on public.games;
create policy "Organization league managers create games"
on public.games for insert to authenticated
with check (
  organization_id is not null and league_id is not null
  and private.can_manage_organization_league(organization_id,league_id,(select auth.uid()))
);

drop policy if exists "Organization league managers update games" on public.games;
create policy "Organization league managers update games"
on public.games for update to authenticated
using (
  organization_id is not null and league_id is not null
  and private.can_manage_organization_league(organization_id,league_id,(select auth.uid()))
)
with check (
  organization_id is not null and league_id is not null
  and private.can_manage_organization_league(organization_id,league_id,(select auth.uid()))
);

drop policy if exists "Organization league managers delete games" on public.games;
create policy "Organization league managers delete games"
on public.games for delete to authenticated
using (
  organization_id is not null and league_id is not null
  and private.can_manage_organization_league(organization_id,league_id,(select auth.uid()))
);

alter table public.assignments enable row level security;
drop policy if exists "Officials view own assignments" on public.assignments;
drop policy if exists "Organization users read assignments" on public.assignments;
create policy "Organization users read assignments"
on public.assignments for select to authenticated
using (
  private.can_read_organization_game(game_id,(select auth.uid()))
  or exists (
    select 1 from public.officials official
    where official.id=assignments.official_id
      and official.auth_user_id=(select auth.uid())
  )
);

drop policy if exists "Organization league managers create assignments" on public.assignments;
create policy "Organization league managers create assignments"
on public.assignments for insert to authenticated
with check (
  exists (
    select 1 from public.games game
    where game.id=assignments.game_id
      and private.can_manage_organization_league(game.organization_id,game.league_id,(select auth.uid()))
  )
);

drop policy if exists "Organization league managers update assignments" on public.assignments;
create policy "Organization league managers update assignments"
on public.assignments for update to authenticated
using (
  exists (
    select 1 from public.games game
    where game.id=assignments.game_id
      and private.can_manage_organization_league(game.organization_id,game.league_id,(select auth.uid()))
  )
)
with check (
  exists (
    select 1 from public.games game
    where game.id=assignments.game_id
      and private.can_manage_organization_league(game.organization_id,game.league_id,(select auth.uid()))
  )
);

drop policy if exists "Organization league managers delete assignments" on public.assignments;
create policy "Organization league managers delete assignments"
on public.assignments for delete to authenticated
using (
  exists (
    select 1 from public.games game
    where game.id=assignments.game_id
      and private.can_manage_organization_league(game.organization_id,game.league_id,(select auth.uid()))
  )
);

revoke all on function private.is_organization_owner_or_admin(uuid,uuid) from public,anon;
revoke all on function private.can_access_organization_league(uuid,uuid,uuid) from public,anon;
revoke all on function private.can_manage_organization_league(uuid,uuid,uuid) from public,anon;
revoke all on function private.can_read_organization_game(uuid,uuid) from public,anon;
revoke all on function private.validate_game_organization_league() from public,anon,authenticated;
grant execute on function private.is_organization_owner_or_admin(uuid,uuid) to authenticated;
grant execute on function private.can_access_organization_league(uuid,uuid,uuid) to authenticated;
grant execute on function private.can_manage_organization_league(uuid,uuid,uuid) to authenticated;
grant execute on function private.can_read_organization_game(uuid,uuid) to authenticated;
grant select,insert,update,delete on public.organization_member_league_access to authenticated;

notify pgrst,'reload schema';
