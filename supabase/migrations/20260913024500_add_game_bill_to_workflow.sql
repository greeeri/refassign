create table if not exists public.bill_to_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

alter table public.bill_to_accounts enable row level security;
revoke all on public.bill_to_accounts from public, anon, authenticated;
grant select on public.bill_to_accounts to authenticated;
grant all on public.bill_to_accounts to service_role;

create policy "Organization members view Bill To accounts"
on public.bill_to_accounts for select to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = bill_to_accounts.organization_id
      and membership.user_id = (select auth.uid())
  )
);

alter table public.games add column if not exists bill_to_id uuid;
alter table public.games drop constraint if exists games_bill_to_requires_organization;
alter table public.games add constraint games_bill_to_requires_organization
  check (bill_to_id is null or organization_id is not null);
alter table public.games drop constraint if exists games_organization_bill_to_fkey;
alter table public.games add constraint games_organization_bill_to_fkey
  foreign key (organization_id, bill_to_id)
  references public.bill_to_accounts(organization_id, id)
  on delete set null (bill_to_id);

create index if not exists bill_to_accounts_organization_name_idx
  on public.bill_to_accounts(organization_id, lower(name));
create index if not exists games_bill_to_idx on public.games(bill_to_id);

create or replace function public.apply_game_import(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_organization_id uuid;
  v_league_id uuid;
  v_level_id uuid;
  v_home_team_id uuid;
  v_away_team_id uuid;
  v_location_id uuid;
  v_bill_to_id uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import payload must be an array';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if v_row->>'action' = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      v_organization_id := (v_row->>'organization_id')::uuid;
      v_league_id := (v_row->>'league_id')::uuid;
      v_level_id := (v_row->>'level_id')::uuid;
      v_home_team_id := (v_row->>'home_team_id')::uuid;
      v_away_team_id := (v_row->>'away_team_id')::uuid;
      v_location_id := (v_row->>'location_id')::uuid;
      v_bill_to_id := nullif(v_row->>'bill_to_id', '')::uuid;

      if auth.uid() is null or not private.can_manage_organization(v_organization_id) then
        raise exception 'You cannot import games for this organization' using errcode = '42501';
      end if;
      if not private.can_manage_organization_league(v_organization_id, v_league_id, auth.uid()) then
        raise exception 'The selected league is not available to this organization' using errcode = '42501';
      end if;
      if not exists (select 1 from public.organization_levels x where x.organization_id = v_organization_id and x.level_id = v_level_id and x.active) then
        raise exception 'The selected level is not active for this organization';
      end if;
      if not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_home_team_id and x.active)
         or not exists (select 1 from public.organization_teams x where x.organization_id = v_organization_id and x.team_id = v_away_team_id and x.active) then
        raise exception 'One or both teams are not active for this organization';
      end if;
      if not exists (select 1 from public.organization_locations x where x.organization_id = v_organization_id and x.location_id = v_location_id and x.active) then
        raise exception 'The selected location is not active for this organization';
      end if;
      if v_bill_to_id is not null and not exists (
        select 1 from public.bill_to_accounts x
        where x.id = v_bill_to_id and x.organization_id = v_organization_id and x.active
      ) then
        raise exception 'The selected Bill To is not active for this organization';
      end if;

      if v_row->>'action' = 'update' then
        update public.games
        set sport_id = (v_row->>'sport_id')::uuid,
            league_id = v_league_id,
            level_id = v_level_id,
            level = v_row->>'level_name',
            home_team_id = v_home_team_id,
            away_team_id = v_away_team_id,
            location_id = v_location_id,
            bill_to_id = v_bill_to_id,
            starts_at = (v_row->>'starts_at')::timestamptz,
            duration_minutes = (v_row->>'duration_minutes')::integer,
            officials_needed = (v_row->>'officials_needed')::integer,
            notes = nullif(v_row->>'notes', '')
        where id = (v_row->>'game_id')::uuid
          and organization_id = v_organization_id;
        if not found then raise exception 'The game being updated is not in the selected organization'; end if;
        v_updated := v_updated + 1;
      elsif v_row->>'action' = 'add' then
        insert into public.games (
          organization_id, game_number, sport_id, league_id, level_id, level,
          home_team_id, away_team_id, location_id, bill_to_id, starts_at,
          duration_minutes, officials_needed, notes, status
        ) values (
          v_organization_id, nullif(v_row->>'game_number', ''),
          (v_row->>'sport_id')::uuid, v_league_id, v_level_id,
          v_row->>'level_name', v_home_team_id, v_away_team_id,
          v_location_id, v_bill_to_id, (v_row->>'starts_at')::timestamptz,
          (v_row->>'duration_minutes')::integer,
          (v_row->>'officials_needed')::integer,
          nullif(v_row->>'notes', ''), 'open'
        );
        v_added := v_added + 1;
      else
        raise exception 'Unsupported import action: %', coalesce(v_row->>'action', 'blank');
      end if;
    exception when others then
      raise exception 'Spreadsheet row % — Game % — %',
        coalesce(v_row->>'row', '?'),
        coalesce(nullif(v_row->>'game_number', ''), 'NEW'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
