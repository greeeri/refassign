create table if not exists public.game_mentor_slots (
  game_id uuid primary key references public.games(id) on delete cascade,
  position_id uuid not null references public.sport_positions(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.game_mentor_slots enable row level security;
revoke all on public.game_mentor_slots from public, anon;
grant select on public.game_mentor_slots to authenticated;

create policy "Organization members read mentor slots" on public.game_mentor_slots
for select using (exists(select 1 from public.games game where game.id=game_id and private.can_access_organization(game.organization_id)));

create or replace function public.add_game_mentor_slot(p_game_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_position_id uuid;
begin
  if not private.can_manage_game(p_game_id) then
    raise exception 'Only an Administrator or Assignor can add a mentor slot.' using errcode='42501';
  end if;
  select position.id into v_position_id
  from public.games game join public.sport_positions position on position.sport_id=game.sport_id
  where game.id=p_game_id and lower(position.name) like '%mentor%'
  order by position.sort_order,position.id limit 1;
  if v_position_id is null then raise exception 'A Mentor position is not configured for this sport.'; end if;
  insert into public.game_mentor_slots(game_id,position_id,created_by)
  values(p_game_id,v_position_id,(select auth.uid())) on conflict(game_id) do nothing;
  return v_position_id;
end; $$;

create or replace function public.assign_game_mentor(p_game_id uuid,p_official_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_position_id uuid;v_assignment_id uuid;
begin
  if not private.can_manage_game(p_game_id) then
    raise exception 'Only an Administrator or Assignor can assign a mentor.' using errcode='42501';
  end if;
  select position_id into v_position_id from public.game_mentor_slots where game_id=p_game_id;
  if v_position_id is null then v_position_id:=public.add_game_mentor_slot(p_game_id); end if;
  if not exists(select 1 from public.official_mentor_certifications where official_id=p_official_id and certified) then
    raise exception 'The selected official is not mentor certified.';
  end if;
  select id into v_assignment_id from public.assignments
  where game_id=p_game_id and position_id=v_position_id and status<>'declined' order by assigned_at desc limit 1 for update;
  if v_assignment_id is null then
    insert into public.assignments(game_id,official_id,position_id,status,assignment_source)
    values(p_game_id,p_official_id,v_position_id,'proposed','manager') returning id into v_assignment_id;
  else
    update public.assignments set official_id=p_official_id,status='proposed',assignment_source='manager',published_at=null,
      accept_by=null,published_by=null,email_sent_at=null,resend_email_id=null,email_error=null,response_token=null,
      responded_at=null,decline_reason=null where id=v_assignment_id;
  end if;
  return v_assignment_id;
end; $$;

create or replace function public.self_assign_game_mentor(p_game_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_game public.games%rowtype;v_official_id uuid;v_position_id uuid;v_assignment_id uuid;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if v_game.id is null or v_game.starts_at<now() or v_game.status not in ('active','open') then
    raise exception 'This game is no longer available for mentor self-assignment.';
  end if;
  if not exists(
    select 1 from public.organization_user_access_profiles access
    where access.organization_id=v_game.organization_id and access.user_id=(select auth.uid()) and 'mentor'=any(access.roles)
      and (cardinality(access.league_ids)=0 or v_game.league_id=any(access.league_ids))
  ) and not exists(
    select 1 from public.organization_memberships membership
    join public.organization_member_league_access league_access on league_access.organization_id=membership.organization_id and league_access.user_id=membership.user_id and league_access.league_id=v_game.league_id
    where membership.organization_id=v_game.organization_id and membership.user_id=(select auth.uid()) and membership.role='mentor'
  ) then raise exception 'Mentor access is required.' using errcode='42501'; end if;
  select id into v_official_id from public.officials where auth_user_id=(select auth.uid()) and active limit 1;
  if v_official_id is null or not exists(select 1 from public.official_mentor_certifications where official_id=v_official_id and certified) then
    raise exception 'An active mentor-certified official profile is required.';
  end if;
  select position.id into v_position_id from public.sport_positions position
  where position.sport_id=v_game.sport_id and lower(position.name) like '%mentor%'
  order by position.sort_order,position.id limit 1;
  if v_position_id is null then raise exception 'A Mentor position is not configured for this sport.'; end if;
  insert into public.game_mentor_slots(game_id,position_id,created_by) values(p_game_id,v_position_id,(select auth.uid()))
  on conflict(game_id) do nothing;
  if exists(select 1 from public.assignments where game_id=p_game_id and position_id=v_position_id and status<>'declined') then
    raise exception 'This game already has a mentor assigned.';
  end if;
  insert into public.assignments(game_id,official_id,position_id,status,assignment_source,published_at,responded_at)
  values(p_game_id,v_official_id,v_position_id,'accepted','self_assign',now(),now()) returning id into v_assignment_id;
  return v_assignment_id;
end; $$;

revoke all on function public.add_game_mentor_slot(uuid),public.assign_game_mentor(uuid,uuid),public.self_assign_game_mentor(uuid) from public,anon;
grant execute on function public.add_game_mentor_slot(uuid),public.assign_game_mentor(uuid,uuid),public.self_assign_game_mentor(uuid) to authenticated;
