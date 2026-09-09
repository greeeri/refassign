-- Bind operational writes to the organization that owns their parent record.

alter table public.assignment_templates
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.assignment_templates template
set organization_id = coalesce(
  (
    select coverage.organization_id
    from public.organization_league_coverage coverage
    where coverage.league_id = template.league_id
      and coverage.active
    order by coverage.created_at
    limit 1
  ),
  'b428f7c8-c499-4e0a-96e4-c5e9fbcba6ed'::uuid
)
where template.organization_id is null;

alter table public.assignment_templates
  alter column organization_id set not null;

create index if not exists assignment_templates_organization_idx
  on public.assignment_templates(organization_id, updated_at desc);

alter table public.game_link_groups
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.game_link_groups link_group
set organization_id = coalesce(
  (
    select game.organization_id
    from public.game_link_members member
    join public.games game on game.id = member.game_id
    where member.group_id = link_group.id
    order by member.sort_order, member.created_at
    limit 1
  ),
  'b428f7c8-c499-4e0a-96e4-c5e9fbcba6ed'::uuid
)
where link_group.organization_id is null;

alter table public.game_link_groups
  alter column organization_id set not null;

create index if not exists game_link_groups_organization_idx
  on public.game_link_groups(organization_id, created_at desc);

create or replace function private.validate_assignment_organization_official()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select game.organization_id
  into v_organization_id
  from public.games game
  where game.id = new.game_id;

  if v_organization_id is null then
    raise exception 'Assignment game must belong to an organization.';
  end if;

  if new.official_id is not null and not exists (
    select 1
    from public.organization_officials organization_official
    where organization_official.organization_id = v_organization_id
      and organization_official.official_id = new.official_id
      and organization_official.active
  ) then
    raise exception 'The selected official is not active in this game''s organization.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_assignment_organization_official() from public, anon, authenticated;

drop trigger if exists validate_assignment_organization_official on public.assignments;
create trigger validate_assignment_organization_official
before insert or update of game_id, official_id on public.assignments
for each row execute function private.validate_assignment_organization_official();

create or replace function private.validate_assignment_template_slot_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select template.organization_id
  into v_organization_id
  from public.assignment_templates template
  where template.id = new.template_id;

  if v_organization_id is null then
    raise exception 'Saved crew must belong to an organization.';
  end if;

  if new.official_id is not null and not exists (
    select 1
    from public.organization_officials organization_official
    where organization_official.organization_id = v_organization_id
      and organization_official.official_id = new.official_id
      and organization_official.active
  ) then
    raise exception 'The selected official is not active in this saved crew''s organization.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_assignment_template_slot_organization() from public, anon, authenticated;

drop trigger if exists validate_assignment_template_slot_organization on public.assignment_template_slots;
create trigger validate_assignment_template_slot_organization
before insert or update of template_id, official_id on public.assignment_template_slots
for each row execute function private.validate_assignment_template_slot_organization();

create or replace function private.prevent_operational_organization_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Operational records cannot be moved between organizations.';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_operational_organization_move() from public, anon, authenticated;

drop trigger if exists prevent_assignment_template_organization_move on public.assignment_templates;
create trigger prevent_assignment_template_organization_move
before update of organization_id on public.assignment_templates
for each row execute function private.prevent_operational_organization_move();

drop trigger if exists prevent_game_link_group_organization_move on public.game_link_groups;
create trigger prevent_game_link_group_organization_move
before update of organization_id on public.game_link_groups
for each row execute function private.prevent_operational_organization_move();

create or replace function private.validate_game_link_member_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_organization_id uuid;
  v_game_organization_id uuid;
begin
  select link_group.organization_id into v_group_organization_id
  from public.game_link_groups link_group
  where link_group.id = new.group_id;

  select game.organization_id into v_game_organization_id
  from public.games game
  where game.id = new.game_id;

  if v_group_organization_id is null or v_game_organization_id is null
     or v_group_organization_id <> v_game_organization_id then
    raise exception 'Linked games must belong to the same organization as their group.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_game_link_member_organization() from public, anon, authenticated;

drop trigger if exists validate_game_link_member_organization on public.game_link_members;
create trigger validate_game_link_member_organization
before insert or update of group_id, game_id on public.game_link_members
for each row execute function private.validate_game_link_member_organization();

drop policy if exists "Managers view assignment templates" on public.assignment_templates;
drop policy if exists "Managers create assignment templates" on public.assignment_templates;
drop policy if exists "Managers update assignment templates" on public.assignment_templates;
drop policy if exists "Managers delete assignment templates" on public.assignment_templates;

create policy "Organization users view assignment templates"
on public.assignment_templates for select to authenticated
using ((select private.can_access_organization(organization_id)));

create policy "Organization managers create assignment templates"
on public.assignment_templates for insert to authenticated
with check (
  (select private.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
);

create policy "Organization managers update assignment templates"
on public.assignment_templates for update to authenticated
using ((select private.can_manage_organization(organization_id)))
with check ((select private.can_manage_organization(organization_id)));

create policy "Organization managers delete assignment templates"
on public.assignment_templates for delete to authenticated
using ((select private.can_manage_organization(organization_id)));

drop policy if exists "Managers view assignment template slots" on public.assignment_template_slots;
drop policy if exists "Managers create assignment template slots" on public.assignment_template_slots;
drop policy if exists "Managers update assignment template slots" on public.assignment_template_slots;
drop policy if exists "Managers delete assignment template slots" on public.assignment_template_slots;

create policy "Organization users view assignment template slots"
on public.assignment_template_slots for select to authenticated
using (exists (
  select 1 from public.assignment_templates template
  where template.id = assignment_template_slots.template_id
    and (select private.can_access_organization(template.organization_id))
));

create policy "Organization managers create assignment template slots"
on public.assignment_template_slots for insert to authenticated
with check (exists (
  select 1 from public.assignment_templates template
  where template.id = assignment_template_slots.template_id
    and (select private.can_manage_organization(template.organization_id))
));

create policy "Organization managers update assignment template slots"
on public.assignment_template_slots for update to authenticated
using (exists (
  select 1 from public.assignment_templates template
  where template.id = assignment_template_slots.template_id
    and (select private.can_manage_organization(template.organization_id))
))
with check (exists (
  select 1 from public.assignment_templates template
  where template.id = assignment_template_slots.template_id
    and (select private.can_manage_organization(template.organization_id))
));

create policy "Organization managers delete assignment template slots"
on public.assignment_template_slots for delete to authenticated
using (exists (
  select 1 from public.assignment_templates template
  where template.id = assignment_template_slots.template_id
    and (select private.can_manage_organization(template.organization_id))
));

drop policy if exists "Managers manage game link groups" on public.game_link_groups;
create policy "Organization users view game link groups"
on public.game_link_groups for select to authenticated
using ((select private.can_access_organization(organization_id)));
create policy "Organization managers create game link groups"
on public.game_link_groups for insert to authenticated
with check (
  (select private.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
);
create policy "Organization managers update game link groups"
on public.game_link_groups for update to authenticated
using ((select private.can_manage_organization(organization_id)))
with check ((select private.can_manage_organization(organization_id)));
create policy "Organization managers delete game link groups"
on public.game_link_groups for delete to authenticated
using ((select private.can_manage_organization(organization_id)));

drop policy if exists "Managers manage game link members" on public.game_link_members;
create policy "Organization users view game link members"
on public.game_link_members for select to authenticated
using (exists (
  select 1 from public.game_link_groups link_group
  where link_group.id = game_link_members.group_id
    and (select private.can_access_organization(link_group.organization_id))
));
create policy "Organization managers create game link members"
on public.game_link_members for insert to authenticated
with check (exists (
  select 1 from public.game_link_groups link_group
  where link_group.id = game_link_members.group_id
    and (select private.can_manage_organization(link_group.organization_id))
));
create policy "Organization managers update game link members"
on public.game_link_members for update to authenticated
using (exists (
  select 1 from public.game_link_groups link_group
  where link_group.id = game_link_members.group_id
    and (select private.can_manage_organization(link_group.organization_id))
))
with check (exists (
  select 1 from public.game_link_groups link_group
  where link_group.id = game_link_members.group_id
    and (select private.can_manage_organization(link_group.organization_id))
));
create policy "Organization managers delete game link members"
on public.game_link_members for delete to authenticated
using (exists (
  select 1 from public.game_link_groups link_group
  where link_group.id = game_link_members.group_id
    and (select private.can_manage_organization(link_group.organization_id))
));

create or replace function public.publish_game_assignments(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := now();
  v_organization_id uuid;
  v_league_id uuid;
begin
  select game.organization_id, game.league_id
  into v_organization_id, v_league_id
  from public.games game
  where game.id = p_game_id;

  if v_organization_id is null or v_league_id is null
     or not private.can_manage_organization_league(v_organization_id, v_league_id, (select auth.uid())) then
    raise exception 'You cannot publish assignments for this organization.';
  end if;

  if exists (
    select 1
    from public.assignments assignment
    left join public.organization_officials organization_official
      on organization_official.organization_id = v_organization_id
     and organization_official.official_id = assignment.official_id
     and organization_official.active
    where assignment.game_id = p_game_id
      and assignment.official_id is not null
      and organization_official.official_id is null
  ) then
    raise exception 'Every assigned official must be active in this organization before publishing.';
  end if;

  update public.assignments
  set published_at = v_now,
      accept_by = v_now + interval '24 hours',
      published_by = (select auth.uid()),
      status = 'proposed',
      response_token = coalesce(response_token, gen_random_uuid()),
      responded_at = null,
      decline_reason = null
  where game_id = p_game_id
    and published_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.publish_game_assignments(uuid) from public, anon;
grant execute on function public.publish_game_assignments(uuid) to authenticated;

create or replace function public.set_game_status(p_game_id uuid, p_status text)
returns public.games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games;
  v_organization_id uuid;
  v_league_id uuid;
begin
  select game.organization_id, game.league_id
  into v_organization_id, v_league_id
  from public.games game
  where game.id = p_game_id;

  if v_organization_id is null or v_league_id is null
     or not private.can_manage_organization_league(v_organization_id, v_league_id, (select auth.uid())) then
    raise exception 'You cannot change status for this organization.';
  end if;
  if p_status not in ('active','canceled','suspended','rained_out') then
    raise exception 'Invalid game status';
  end if;

  update public.games set status = p_status where id = p_game_id returning * into v_game;

  if p_status in ('canceled','rained_out') then
    update public.assignments
    set status_before_cancellation = case when status <> 'cancelled' then status else status_before_cancellation end,
        status = 'cancelled', accept_by = null,
        cancellation_notified_at = null, cancellation_email_id = null, cancellation_email_error = null
    where game_id = p_game_id and status <> 'declined';
    update public.assignment_self_assign_slots set status = 'withdrawn'
    where game_id = p_game_id and status = 'open';
  elsif p_status = 'active' then
    update public.assignments
    set status = coalesce(status_before_cancellation,'proposed'), status_before_cancellation = null,
        cancellation_notified_at = null, cancellation_email_id = null, cancellation_email_error = null
    where game_id = p_game_id and status = 'cancelled';
  end if;

  return v_game;
end;
$$;

revoke all on function public.set_game_status(uuid,text) from public, anon;
grant execute on function public.set_game_status(uuid,text) to authenticated;

create or replace function private.can_manage_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.games game
    where game.id = p_game_id
      and game.organization_id is not null
      and game.league_id is not null
      and private.can_manage_organization_league(
        game.organization_id,
        game.league_id,
        (select auth.uid())
      )
  );
$$;

revoke all on function private.can_manage_game(uuid) from public, anon, authenticated;

create or replace function public.set_self_assign_positions(p_slots jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot jsonb;
  v_game_id uuid;
  v_position_id uuid;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Select at least one open position';
  end if;

  for v_slot in select value from jsonb_array_elements(p_slots)
  loop
    v_game_id := (v_slot->>'game_id')::uuid;
    v_position_id := (v_slot->>'position_id')::uuid;

    if not private.can_manage_game(v_game_id) then
      raise exception 'You cannot open Self Assign positions for this organization.';
    end if;

    if not exists (
      select 1
      from public.games game
      join public.sport_positions position
        on position.id = v_position_id and position.sport_id = game.sport_id
      where game.id = v_game_id
        and game.status in ('active', 'open')
        and (
          select count(*)
          from public.sport_positions preceding
          where preceding.sport_id = game.sport_id
            and (preceding.sort_order, preceding.id) <= (position.sort_order, position.id)
        ) <= game.officials_needed
    ) then
      raise exception 'The selected position is not an active assignment slot';
    end if;

    if exists (
      select 1 from public.assignments assignment
      where assignment.game_id = v_game_id
        and assignment.position_id = v_position_id
        and assignment.status <> 'declined'
    ) then
      raise exception 'A selected position is already assigned';
    end if;

    insert into public.assignment_self_assign_slots
      (game_id, position_id, status, offered_by, offered_at, claimed_by, claimed_at)
    values
      (v_game_id, v_position_id, 'open', (select auth.uid()), now(), null, null)
    on conflict (game_id, position_id) do update
      set status = 'open', offered_by = excluded.offered_by,
          offered_at = excluded.offered_at, claimed_by = null, claimed_at = null;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.set_self_assign_positions(jsonb) from public, anon;
grant execute on function public.set_self_assign_positions(jsonb) to authenticated;

create or replace function public.withdraw_self_assign_position(
  p_game_id uuid,
  p_position_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_game(p_game_id) then
    raise exception 'You cannot withdraw Self Assign positions for this organization.';
  end if;

  update public.assignment_self_assign_slots
  set status = 'withdrawn'
  where game_id = p_game_id
    and position_id = p_position_id
    and status = 'open';
end;
$$;

revoke all on function public.withdraw_self_assign_position(uuid,uuid) from public, anon;
grant execute on function public.withdraw_self_assign_position(uuid,uuid) to authenticated;

comment on column public.assignment_templates.organization_id is
  'Organization that owns and may use this saved crew template.';
comment on column public.game_link_groups.organization_id is
  'Organization that owns this linked-game group.';
