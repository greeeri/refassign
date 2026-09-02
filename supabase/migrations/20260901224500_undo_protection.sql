create table if not exists public.undo_operations (
  id uuid primary key default gen_random_uuid(),
  transaction_id bigint not null unique,
  actor_user_id uuid not null references auth.users(id),
  description text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  undone_at timestamptz
);

create table if not exists public.undo_changes (
  id bigint generated always as identity primary key,
  operation_id uuid not null references public.undo_operations(id) on delete cascade,
  table_name text not null check (table_name in ('games','assignments','assignment_self_assign_slots')),
  row_id uuid not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists undo_operations_actor_created_idx
  on public.undo_operations(actor_user_id, created_at desc);
create index if not exists undo_changes_operation_idx
  on public.undo_changes(operation_id, id desc);

alter table public.undo_operations enable row level security;
alter table public.undo_changes enable row level security;

drop policy if exists "Managers view own undo operations" on public.undo_operations;
create policy "Managers view own undo operations" on public.undo_operations
for select to authenticated
using ((select public.can_manage_game_setup()) and actor_user_id = (select auth.uid()));

drop policy if exists "Managers update own undo operations" on public.undo_operations;
create policy "Managers update own undo operations" on public.undo_operations
for update to authenticated
using ((select public.can_manage_game_setup()) and actor_user_id = (select auth.uid()))
with check ((select public.can_manage_game_setup()) and actor_user_id = (select auth.uid()));

drop policy if exists "Managers delete own undo operations" on public.undo_operations;
create policy "Managers delete own undo operations" on public.undo_operations
for delete to authenticated
using ((select public.can_manage_game_setup()) and actor_user_id = (select auth.uid()));

drop policy if exists "Managers view own undo changes" on public.undo_changes;
create policy "Managers view own undo changes" on public.undo_changes
for select to authenticated
using (exists (
  select 1 from public.undo_operations operation
  where operation.id = operation_id and operation.actor_user_id = (select auth.uid())
));

drop policy if exists "Managers update own undo changes" on public.undo_changes;
create policy "Managers update own undo changes" on public.undo_changes
for update to authenticated
using (exists (select 1 from public.undo_operations operation where operation.id = operation_id and operation.actor_user_id = (select auth.uid())))
with check (exists (select 1 from public.undo_operations operation where operation.id = operation_id and operation.actor_user_id = (select auth.uid())));

grant select, update on public.undo_operations to authenticated;
grant select, update on public.undo_changes to authenticated;

create or replace function public.capture_undo_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation_id uuid;
  v_description text;
  v_row_id uuid := coalesce(new.id, old.id);
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  if auth.uid() is null
     or not public.can_manage_game_setup()
     or current_setting('refassign.undoing', true) = 'true' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'assignments' and tg_op = 'UPDATE'
     and v_old->'game_id' is not distinct from v_new->'game_id'
     and v_old->'official_id' is not distinct from v_new->'official_id'
     and v_old->'position_id' is not distinct from v_new->'position_id'
     and v_old->'status' is not distinct from v_new->'status'
     and v_old->'fee' is not distinct from v_new->'fee'
     and v_old->'published_at' is not distinct from v_new->'published_at'
     and v_old->'accept_by' is not distinct from v_new->'accept_by' then
    return new;
  end if;

  v_description := case
    when tg_table_name = 'assignments' and tg_op = 'INSERT' then 'Assignment added'
    when tg_table_name = 'assignments' and tg_op = 'DELETE' then 'Official unassigned'
    when tg_table_name = 'assignments' then 'Assignment changed'
    when tg_table_name = 'games' and tg_op = 'INSERT' then 'Game import'
    when tg_table_name = 'games' and tg_op = 'UPDATE' and v_old->'status' is distinct from v_new->'status' then 'Game status changed'
    when tg_table_name = 'games' then 'Game updated'
    else 'Schedule changed'
  end;

  insert into public.undo_operations(transaction_id, actor_user_id, description)
  values (txid_current(), auth.uid(), v_description)
  on conflict (transaction_id) do update set transaction_id = excluded.transaction_id
  returning id into v_operation_id;

  insert into public.undo_changes(operation_id, table_name, row_id, operation, old_data, new_data)
  values (
    v_operation_id, tg_table_name, v_row_id, tg_op,
    v_old, v_new
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.capture_undo_change() from public, anon, authenticated;

drop trigger if exists undo_capture_games on public.games;
create trigger undo_capture_games after insert or update or delete on public.games
for each row execute function public.capture_undo_change();

drop trigger if exists undo_capture_assignments on public.assignments;
create trigger undo_capture_assignments after insert or update or delete on public.assignments
for each row execute function public.capture_undo_change();

drop trigger if exists undo_capture_self_assign_slots on public.assignment_self_assign_slots;
create trigger undo_capture_self_assign_slots after insert or update or delete on public.assignment_self_assign_slots
for each row execute function public.capture_undo_change();

drop policy if exists "Managers insert self assign slots" on public.assignment_self_assign_slots;
create policy "Managers insert self assign slots" on public.assignment_self_assign_slots
for insert to authenticated with check ((select public.can_manage_game_setup()));
drop policy if exists "Managers update self assign slots" on public.assignment_self_assign_slots;
create policy "Managers update self assign slots" on public.assignment_self_assign_slots
for update to authenticated using ((select public.can_manage_game_setup()))
with check ((select public.can_manage_game_setup()));
drop policy if exists "Managers delete self assign slots" on public.assignment_self_assign_slots;
create policy "Managers delete self assign slots" on public.assignment_self_assign_slots
for delete to authenticated using ((select public.can_manage_game_setup()));

create or replace function public.latest_undo_operation()
returns table(id uuid, description text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select operation.id, operation.description, operation.created_at, operation.expires_at
  from public.undo_operations operation
  where operation.actor_user_id = auth.uid()
    and operation.undone_at is null
    and operation.expires_at > now()
  order by operation.created_at desc
  limit 1
$$;

drop function if exists public.group_recent_undo_operations(timestamptz,text);
create or replace function public.group_undo_operations(p_operation_ids uuid[], p_description text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_group_id uuid;
begin
  if not public.can_manage_game_setup() then raise exception 'Not authorized'; end if;
  select array_agg(id order by created_at) into v_ids
  from public.undo_operations
  where actor_user_id = auth.uid() and undone_at is null and id = any(p_operation_ids);
  if coalesce(array_length(v_ids, 1), 0) <> coalesce(array_length(p_operation_ids, 1), 0) then
    raise exception 'One or more Undo actions are missing, expired, or do not belong to you';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then return null; end if;
  if array_length(v_ids, 1) = 1 then
    update public.undo_operations set description = p_description where id = v_ids[1];
    return v_ids[1];
  end if;
  insert into public.undo_operations(transaction_id, actor_user_id, description)
  values(txid_current(), auth.uid(), p_description) returning id into v_group_id;
  update public.undo_changes set operation_id = v_group_id where operation_id = any(v_ids);
  update public.undo_operations set undone_at = now() where id = any(v_ids);
  return v_group_id;
end;
$$;

create or replace function public.undo_operation(p_operation_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_operation public.undo_operations;
  v_change public.undo_changes;
  v_columns text;
begin
  select * into v_operation from public.undo_operations
  where id = p_operation_id and actor_user_id = auth.uid()
  for update;
  if v_operation.id is null then raise exception 'Undo action not found'; end if;
  if v_operation.undone_at is not null then raise exception 'This action was already undone'; end if;
  if v_operation.expires_at <= now() then raise exception 'The Undo window has expired'; end if;
  if not public.can_manage_game_setup() then raise exception 'Not authorized'; end if;

  perform set_config('refassign.undoing', 'true', true);
  for v_change in
    select * from public.undo_changes where operation_id = p_operation_id order by id desc
  loop
    if v_change.operation = 'INSERT' then
      execute format('delete from public.%I where id = $1', v_change.table_name)
      using v_change.row_id;
    elsif v_change.operation = 'DELETE' then
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, $1)).*',
        v_change.table_name, v_change.table_name
      ) using v_change.old_data;
    else
      select string_agg(quote_ident(attribute.attname), ',' order by attribute.attnum)
      into v_columns
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = format('public.%I', v_change.table_name)::regclass
        and attribute.attnum > 0 and not attribute.attisdropped and attribute.attgenerated = '';
      execute format(
        'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2',
        v_change.table_name, v_columns, v_columns, v_change.table_name
      ) using v_change.old_data, v_change.row_id;
    end if;
  end loop;

  update public.undo_operations set undone_at = now() where id = p_operation_id;
  return v_operation.description;
end;
$$;

revoke all on function public.latest_undo_operation() from public, anon;
revoke all on function public.group_undo_operations(uuid[],text) from public, anon;
revoke all on function public.undo_operation(uuid) from public, anon;
grant execute on function public.latest_undo_operation() to authenticated;
grant execute on function public.group_undo_operations(uuid[],text) to authenticated;
grant execute on function public.undo_operation(uuid) to authenticated;
