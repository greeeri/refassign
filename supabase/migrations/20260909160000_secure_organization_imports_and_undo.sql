-- Keep imports and undo operations inside the selected organization.

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

      if v_row->>'action' = 'update' then
        update public.games
        set sport_id = (v_row->>'sport_id')::uuid,
            league_id = v_league_id,
            level_id = v_level_id,
            level = v_row->>'level_name',
            home_team_id = v_home_team_id,
            away_team_id = v_away_team_id,
            location_id = v_location_id,
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
          home_team_id, away_team_id, location_id, starts_at,
          duration_minutes, officials_needed, notes, status
        ) values (
          v_organization_id, nullif(v_row->>'game_number', ''),
          (v_row->>'sport_id')::uuid, v_league_id, v_level_id,
          v_row->>'level_name', v_home_team_id, v_away_team_id,
          v_location_id, (v_row->>'starts_at')::timestamptz,
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

create or replace function public.import_payroll_rows(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_assignment_id uuid;
  v_organization_id uuid;
  v_sheet_row integer;
  v_payment_status text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The payroll import contains no rows.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sheet_row := coalesce((v_row->>'spreadsheet_row')::integer, v_count + 2);
    begin
      v_assignment_id := (v_row->>'assignment_id')::uuid;
      v_organization_id := (v_row->>'organization_id')::uuid;
    exception when others then
      raise exception 'Spreadsheet row %: Assignment or Organization ID is invalid.', v_sheet_row;
    end;
    if auth.uid() is null or not private.can_manage_organization(v_organization_id) then
      raise exception 'Spreadsheet row %: you cannot import payroll for this organization.', v_sheet_row using errcode = '42501';
    end if;
    v_payment_status := lower(coalesce(v_row->>'payment_status', ''));
    if v_payment_status not in ('unpaid', 'approved', 'paid', 'void') then
      raise exception 'Spreadsheet row %: Payment Status is invalid.', v_sheet_row;
    end if;
    if (v_row->>'game_fee')::numeric < 0
      or (v_row->>'mileage_miles')::numeric < 0
      or (v_row->>'mileage_rate')::numeric < 0 then
      raise exception 'Spreadsheet row %: payroll amounts cannot be negative.', v_sheet_row;
    end if;

    update public.assignments a
    set game_fee = (v_row->>'game_fee')::numeric,
        mileage_miles = (v_row->>'mileage_miles')::numeric,
        mileage_rate = (v_row->>'mileage_rate')::numeric,
        payment_status = v_payment_status,
        paid_at = case when v_payment_status = 'paid' then coalesce(a.paid_at, now()) else null end,
        payroll_notes = nullif(trim(v_row->>'payroll_notes'), ''),
        payroll_updated_at = now(), payroll_updated_by = auth.uid()
    where a.id = v_assignment_id
      and a.status in ('accepted', 'confirmed')
      and exists (select 1 from public.games g where g.id = a.game_id and g.organization_id = v_organization_id);
    if not found then
      raise exception 'Spreadsheet row %: accepted assignment was not found in the selected organization.', v_sheet_row;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

drop function if exists public.upsert_official_roster_row(text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text);
create function public.upsert_official_roster_row(
  p_organization_id uuid,
  p_supplied_id text, p_first_name text, p_last_name text, p_email text,
  p_phone text, p_home_address text, p_home_city text, p_home_state text,
  p_home_zip text, p_sports text[], p_certification text, p_active boolean,
  p_ref_rank numeric, p_ar1_rank numeric, p_ar2_rank numeric, p_fourth_rank numeric,
  p_league_ids uuid[], p_level_ids uuid[], p_college_license text default null,
  p_high_school_license text default null, p_us_soccer_license text default null
)
returns table(result_official_id uuid, result_action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_action text;
  v_shared boolean := false;
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'You cannot import officials for this organization' using errcode = '42501';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' then raise exception 'Column first_name: missing value'; end if;
  if p_last_name is null or btrim(p_last_name) = '' then raise exception 'Column last_name: missing value'; end if;
  if p_ref_rank not between 1 and 10 then raise exception 'Column ref_rank: must be 1.0-10.0'; end if;
  if p_ar1_rank not between 1 and 10 then raise exception 'Column ar1_rank: must be 1.0-10.0'; end if;
  if p_ar2_rank not between 1 and 10 then raise exception 'Column ar2_rank: must be 1.0-10.0'; end if;
  if p_fourth_rank not between 1 and 10 then raise exception 'Column fourth_rank: must be 1.0-10.0'; end if;
  if exists (
    select 1 from unnest(coalesce(p_league_ids, '{}'::uuid[])) candidate(league_id)
    where not exists (
      select 1 from public.organization_league_coverage coverage
      where coverage.organization_id = p_organization_id
        and coverage.league_id = candidate.league_id and coverage.active
    )
  ) then raise exception 'Column leagues: one or more leagues are not active for this organization'; end if;
  if exists (
    select 1 from unnest(coalesce(p_level_ids, '{}'::uuid[])) candidate(level_id)
    where not exists (
      select 1 from public.organization_levels organization_level
      where organization_level.organization_id = p_organization_id
        and organization_level.level_id = candidate.level_id and organization_level.active
    )
  ) then raise exception 'Column levels: one or more levels are not active for this organization'; end if;

  begin
    if nullif(btrim(coalesce(p_supplied_id, '')), '') is not null then
      select o.id into v_id from public.officials o where o.id = p_supplied_id::uuid;
    end if;
  exception when invalid_text_representation then v_id := null;
  end;
  if v_id is null and nullif(btrim(coalesce(p_email, '')), '') is not null then
    select o.id into v_id from public.officials o where lower(btrim(o.email)) = lower(btrim(p_email)) limit 1;
  end if;
  if v_id is null then
    select o.id into v_id from public.officials o
    where lower(btrim(o.first_name)) = lower(btrim(p_first_name))
      and lower(btrim(o.last_name)) = lower(btrim(p_last_name)) limit 1;
  end if;

  if v_id is null then
    insert into public.officials(
      first_name,last_name,email,phone,home_address,home_city,home_state,home_zip,
      sports,certification_level,college_license_level,high_school_license_level,
      us_soccer_license_level,active
    ) values (
      btrim(p_first_name),btrim(p_last_name),nullif(btrim(coalesce(p_email,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_home_address,'')),''),
      nullif(btrim(coalesce(p_home_city,'')),''),nullif(btrim(coalesce(p_home_state,'')),''),
      nullif(btrim(coalesce(p_home_zip,'')),''),coalesce(p_sports,array['Soccer']::text[]),
      nullif(btrim(coalesce(p_certification,'')),''),nullif(btrim(coalesce(p_college_license,'')),''),
      nullif(btrim(coalesce(p_high_school_license,'')),''),nullif(btrim(coalesce(p_us_soccer_license,'')),''),
      coalesce(p_active,true)
    ) returning id into v_id;
    v_action := 'Add';
  else
    select exists (
      select 1 from public.organization_officials link
      where link.official_id = v_id and link.organization_id <> p_organization_id
    ) into v_shared;
    if v_shared then
      v_action := 'Connect';
    else
      update public.officials o set
        first_name=btrim(p_first_name), last_name=btrim(p_last_name),
        email=nullif(btrim(coalesce(p_email,'')),''), phone=nullif(btrim(coalesce(p_phone,'')),''),
        home_address=nullif(btrim(coalesce(p_home_address,'')),''), home_city=nullif(btrim(coalesce(p_home_city,'')),''),
        home_state=nullif(btrim(coalesce(p_home_state,'')),''), home_zip=nullif(btrim(coalesce(p_home_zip,'')),''),
        sports=coalesce(p_sports,array['Soccer']::text[]), certification_level=nullif(btrim(coalesce(p_certification,'')),''),
        college_license_level=nullif(btrim(coalesce(p_college_license,'')),''),
        high_school_license_level=nullif(btrim(coalesce(p_high_school_license,'')),''),
        us_soccer_license_level=nullif(btrim(coalesce(p_us_soccer_license,'')),''),
        active=coalesce(p_active,true), updated_at=now()
      where o.id=v_id;
      v_action := 'Update';
    end if;
  end if;

  insert into public.organization_officials(organization_id,official_id,active,added_by)
  values(p_organization_id,v_id,true,auth.uid())
  on conflict(organization_id,official_id) do update set active=true;

  if not v_shared then
    insert into public.official_soccer_position_rankings(official_id,ref_rank,ar1_rank,ar2_rank,fourth_rank,updated_at)
    values(v_id,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank,now())
    on conflict(official_id) do update set ref_rank=excluded.ref_rank,ar1_rank=excluded.ar1_rank,
      ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,updated_at=now();
    delete from public.official_league_eligibility where official_id=v_id;
    insert into public.official_league_eligibility(official_id,league_id)
      select v_id,x from (select distinct unnest(coalesce(p_league_ids,'{}'::uuid[])) x) d;
    delete from public.official_level_eligibility where official_id=v_id;
    insert into public.official_level_eligibility(official_id,level_id)
      select v_id,x from (select distinct unnest(coalesce(p_level_ids,'{}'::uuid[])) x) d;
  end if;
  result_official_id := v_id; result_action := v_action; return next;
end;
$$;

alter table public.undo_operations add column if not exists organization_id uuid references public.organizations(id);
update public.undo_operations operation
set organization_id = coalesce(
  (select coalesce(change.new_data->>'organization_id', change.old_data->>'organization_id')::uuid
   from public.undo_changes change where change.operation_id=operation.id and change.table_name='games' limit 1),
  (select game.organization_id from public.undo_changes change
   join public.games game on game.id=coalesce(change.new_data->>'game_id',change.old_data->>'game_id')::uuid
   where change.operation_id=operation.id and change.table_name in ('assignments','assignment_self_assign_slots') limit 1),
  (select organization.id from public.organizations organization where lower(organization.name)='test' order by organization.created_at limit 1)
)
where organization_id is null;
alter table public.undo_operations alter column organization_id set not null;
create index if not exists undo_operations_actor_organization_created_idx
  on public.undo_operations(actor_user_id,organization_id,created_at desc);

create or replace function public.capture_undo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_id uuid;
  v_existing_organization_id uuid;
  v_organization_id uuid;
  v_description text;
  v_row_id uuid := coalesce(new.id, old.id);
  v_old jsonb := case when tg_op='INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op='DELETE' then null else to_jsonb(new) end;
begin
  if auth.uid() is null or current_setting('refassign.undoing',true)='true' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  select operation.id, operation.organization_id into v_operation_id,v_existing_organization_id
  from public.undo_operations operation
  where operation.transaction_id=txid_current() and operation.actor_user_id=auth.uid();
  if tg_table_name='games' then
    v_organization_id := coalesce(v_new->>'organization_id',v_old->>'organization_id')::uuid;
  else
    select game.organization_id into v_organization_id from public.games game
    where game.id=coalesce(v_new->>'game_id',v_old->>'game_id')::uuid;
  end if;
  v_organization_id := coalesce(v_organization_id,v_existing_organization_id);
  if v_organization_id is null or not private.can_manage_organization(v_organization_id) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if v_existing_organization_id is not null and v_existing_organization_id <> v_organization_id then
    raise exception 'A single Undo action cannot span organizations';
  end if;
  if tg_table_name='assignments' and tg_op='UPDATE'
    and v_old->'game_id' is not distinct from v_new->'game_id'
    and v_old->'official_id' is not distinct from v_new->'official_id'
    and v_old->'position_id' is not distinct from v_new->'position_id'
    and v_old->'status' is not distinct from v_new->'status'
    and v_old->'fee' is not distinct from v_new->'fee'
    and v_old->'published_at' is not distinct from v_new->'published_at'
    and v_old->'accept_by' is not distinct from v_new->'accept_by' then return new;
  end if;
  v_description := case
    when tg_table_name='assignments' and tg_op='INSERT' then 'Assignment added'
    when tg_table_name='assignments' and tg_op='DELETE' then 'Official unassigned'
    when tg_table_name='assignments' then 'Assignment changed'
    when tg_table_name='games' and tg_op='INSERT' then 'Game import'
    when tg_table_name='games' and tg_op='UPDATE' and v_old->'status' is distinct from v_new->'status' then 'Game status changed'
    when tg_table_name='games' then 'Game updated' else 'Schedule changed' end;
  if v_operation_id is null then
    insert into public.undo_operations(transaction_id,actor_user_id,organization_id,description)
    values(txid_current(),auth.uid(),v_organization_id,v_description) returning id into v_operation_id;
  end if;
  insert into public.undo_changes(operation_id,table_name,row_id,operation,old_data,new_data)
  values(v_operation_id,tg_table_name,v_row_id,tg_op,v_old,v_new);
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

drop policy if exists "Managers view own undo operations" on public.undo_operations;
drop policy if exists "Managers update own undo operations" on public.undo_operations;
drop policy if exists "Managers delete own undo operations" on public.undo_operations;
create policy "Managers view own undo operations" on public.undo_operations for select to authenticated
  using(actor_user_id=(select auth.uid()) and private.can_manage_organization(organization_id));
create policy "Managers update own undo operations" on public.undo_operations for update to authenticated
  using(actor_user_id=(select auth.uid()) and private.can_manage_organization(organization_id))
  with check(actor_user_id=(select auth.uid()) and private.can_manage_organization(organization_id));
create policy "Managers delete own undo operations" on public.undo_operations for delete to authenticated
  using(actor_user_id=(select auth.uid()) and private.can_manage_organization(organization_id));

drop function if exists public.latest_undo_operation();
create function public.latest_undo_operation(p_organization_id uuid)
returns table(id uuid,description text,created_at timestamptz,expires_at timestamptz)
language sql stable security invoker set search_path=''
as $$
  select operation.id,operation.description,operation.created_at,operation.expires_at
  from public.undo_operations operation
  where operation.actor_user_id=auth.uid() and operation.organization_id=p_organization_id
    and private.can_manage_organization(p_organization_id)
    and operation.undone_at is null and operation.expires_at>now()
  order by operation.created_at desc limit 1
$$;

drop function if exists public.group_undo_operations(uuid[],text);
create function public.group_undo_operations(p_operation_ids uuid[],p_description text,p_organization_id uuid)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare v_ids uuid[]; v_group_id uuid;
begin
  if auth.uid() is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized'; end if;
  select array_agg(id order by created_at) into v_ids from public.undo_operations
  where actor_user_id=auth.uid() and organization_id=p_organization_id and undone_at is null and id=any(p_operation_ids);
  if coalesce(array_length(v_ids,1),0)<>coalesce(array_length(p_operation_ids,1),0) then
    raise exception 'One or more Undo actions are missing, expired, or outside the selected organization';
  end if;
  if coalesce(array_length(v_ids,1),0)=0 then return null; end if;
  if array_length(v_ids,1)=1 then
    update public.undo_operations set description=p_description where id=v_ids[1]; return v_ids[1];
  end if;
  insert into public.undo_operations(transaction_id,actor_user_id,organization_id,description)
  values(txid_current(),auth.uid(),p_organization_id,p_description) returning id into v_group_id;
  update public.undo_changes set operation_id=v_group_id where operation_id=any(v_ids);
  update public.undo_operations set undone_at=now() where id=any(v_ids);
  return v_group_id;
end;
$$;

drop function if exists public.undo_operation(uuid);
create function public.undo_operation(p_operation_id uuid,p_organization_id uuid)
returns text language plpgsql security invoker set search_path=''
as $$
declare
  v_operation public.undo_operations;
  v_change public.undo_changes;
  v_columns text;
  v_data jsonb;
  v_game_id uuid;
begin
  select * into v_operation from public.undo_operations
  where id=p_operation_id and actor_user_id=auth.uid() and organization_id=p_organization_id for update;
  if v_operation.id is null then raise exception 'Undo action not found in the selected organization'; end if;
  if v_operation.undone_at is not null then raise exception 'This action was already undone'; end if;
  if v_operation.expires_at<=now() then raise exception 'The Undo window has expired'; end if;
  if auth.uid() is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized'; end if;
  perform set_config('refassign.undoing','true',true);
  for v_change in select * from public.undo_changes where operation_id=p_operation_id order by id desc loop
    v_data := coalesce(v_change.new_data,v_change.old_data);
    if v_change.table_name='games' then
      if (v_data->>'organization_id')::uuid<>p_organization_id then raise exception 'Undo contains a game outside the selected organization'; end if;
    else
      v_game_id := (v_data->>'game_id')::uuid;
      if not exists(select 1 from public.games g where g.id=v_game_id and g.organization_id=p_organization_id)
         and not exists(select 1 from public.undo_changes c where c.operation_id=p_operation_id and c.table_name='games' and c.row_id=v_game_id and coalesce(c.new_data->>'organization_id',c.old_data->>'organization_id')::uuid=p_organization_id) then
        raise exception 'Undo contains schedule data outside the selected organization';
      end if;
    end if;
    if v_change.operation='INSERT' then
      execute format('delete from public.%I where id=$1',v_change.table_name) using v_change.row_id;
    elsif v_change.operation='DELETE' then
      execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).*',v_change.table_name,v_change.table_name) using v_change.old_data;
    else
      select string_agg(quote_ident(attribute.attname),',' order by attribute.attnum) into v_columns
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid=format('public.%I',v_change.table_name)::regclass
        and attribute.attnum>0 and not attribute.attisdropped and attribute.attgenerated='';
      execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where id=$2',v_change.table_name,v_columns,v_columns,v_change.table_name)
      using v_change.old_data,v_change.row_id;
    end if;
  end loop;
  update public.undo_operations set undone_at=now() where id=p_operation_id;
  return v_operation.description;
end;
$$;

revoke all on function public.apply_game_import(jsonb) from public,anon;
revoke all on function public.import_payroll_rows(jsonb) from public,anon;
revoke all on function public.upsert_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) from public,anon;
revoke all on function public.latest_undo_operation(uuid) from public,anon;
revoke all on function public.group_undo_operations(uuid[],text,uuid) from public,anon;
revoke all on function public.undo_operation(uuid,uuid) from public,anon;
grant execute on function public.apply_game_import(jsonb) to authenticated;
grant execute on function public.import_payroll_rows(jsonb) to authenticated;
grant execute on function public.upsert_official_roster_row(uuid,text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) to authenticated;
grant execute on function public.latest_undo_operation(uuid) to authenticated;
grant execute on function public.group_undo_operations(uuid[],text,uuid) to authenticated;
grant execute on function public.undo_operation(uuid,uuid) to authenticated;
