create table public.audit_history (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('assignment','game')),
  entity_id uuid not null,
  game_id uuid references public.games(id) on delete set null,
  assignment_id uuid,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  summary text not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_history_game_time_idx on public.audit_history(game_id,occurred_at desc);
create index audit_history_entity_time_idx on public.audit_history(entity_type,entity_id,occurred_at desc);
create index audit_history_actor_time_idx on public.audit_history(actor_user_id,occurred_at desc);

alter table public.audit_history enable row level security;
create policy "Managers view audit history" on public.audit_history for select to authenticated
using ((select public.can_manage_game_setup()));
grant select on public.audit_history to authenticated;

create or replace function public.audit_actor_name(p_user_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select p.full_name from public.profiles p where p.id=p_user_id),
                  (select u.email from auth.users u where u.id=p_user_id),
                  'System');
$$;

create or replace function public.log_assignment_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text; v_summary text; v_game_number text; v_official text; v_position text; v_actor uuid:=auth.uid(); v_row public.assignments;
begin
  v_row:=case when tg_op='DELETE' then old else new end;
  select g.game_number into v_game_number from public.games g where g.id=v_row.game_id;
  select trim(o.first_name||' '||o.last_name) into v_official from public.officials o where o.id=v_row.official_id;
  select sp.name into v_position from public.sport_positions sp where sp.id=v_row.position_id;
  if tg_op='INSERT' then v_action:='assigned'; v_summary:=coalesce(v_official,'Official')||' assigned as '||coalesce(v_position,'Official')||' on Game #'||coalesce(v_game_number,'—');
  elsif tg_op='DELETE' then v_action:='unassigned'; v_summary:=coalesce(v_official,'Official')||' unassigned from '||coalesce(v_position,'Official')||' on Game #'||coalesce(v_game_number,'—');
  elsif old.official_id is distinct from new.official_id or old.position_id is distinct from new.position_id then v_action:='assignment_changed'; v_summary:='Assignment changed on Game #'||coalesce(v_game_number,'—');
  elsif old.status is distinct from new.status then
    v_action:=case new.status when 'confirmed' then 'confirmed' when 'cancelled' then 'assignment_cancelled' else 'assignment_status_changed' end;
    v_summary:=coalesce(v_official,'Official')||' status changed from '||old.status||' to '||new.status||' on Game #'||coalesce(v_game_number,'—');
  elsif old.published_at is distinct from new.published_at then v_action:='published'; v_summary:='Assignment published for '||coalesce(v_official,'Official')||' on Game #'||coalesce(v_game_number,'—');
  else return new; end if;
  insert into public.audit_history(entity_type,entity_id,game_id,assignment_id,action,actor_user_id,actor_name,summary,old_data,new_data)
  values('assignment',v_row.id,v_row.game_id,v_row.id,v_action,v_actor,public.audit_actor_name(v_actor),v_summary,
    case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.log_game_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text; v_summary text; v_actor uuid:=auth.uid();
begin
  if old.status is distinct from new.status then
    v_action:='game_status_changed'; v_summary:='Game #'||coalesce(new.game_number,'—')||' status changed from '||old.status||' to '||new.status;
  else
    v_action:='game_edited'; v_summary:='Game #'||coalesce(new.game_number,'—')||' details edited';
  end if;
  insert into public.audit_history(entity_type,entity_id,game_id,action,actor_user_id,actor_name,summary,old_data,new_data)
  values('game',new.id,new.id,v_action,v_actor,public.audit_actor_name(v_actor),v_summary,to_jsonb(old),to_jsonb(new));
  return new;
end; $$;

drop trigger if exists assignment_audit_trigger on public.assignments;
create trigger assignment_audit_trigger after insert or update or delete on public.assignments
for each row execute function public.log_assignment_audit();
drop trigger if exists game_audit_trigger on public.games;
create trigger game_audit_trigger after update on public.games
for each row when (old.* is distinct from new.*) execute function public.log_game_audit();

revoke all on function public.audit_actor_name(uuid) from public,anon,authenticated;
revoke all on function public.log_assignment_audit() from public,anon,authenticated;
revoke all on function public.log_game_audit() from public,anon,authenticated;
