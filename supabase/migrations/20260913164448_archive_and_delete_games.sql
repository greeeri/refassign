alter table public.games
  add column if not exists archived_at timestamptz;

create index if not exists games_organization_archived_starts_idx
  on public.games (organization_id, archived_at, starts_at);

comment on column public.games.archived_at is
  'When set, the game is hidden from the working schedule but retained for historical reporting.';

-- During a cascading game deletion, the parent game is no longer visible when
-- assignment AFTER DELETE triggers run. Keep the audit record, but do not point
-- its foreign key at a game that is being removed.
create or replace function public.log_assignment_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_action text;
  v_summary text;
  v_game_number text;
  v_official text;
  v_position text;
  v_actor uuid:=auth.uid();
  v_row public.assignments;
  v_audit_game_id uuid;
begin
  v_row:=case when tg_op='DELETE' then old else new end;
  select g.game_number, g.id into v_game_number, v_audit_game_id
  from public.games g where g.id=v_row.game_id;
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
  values('assignment',v_row.id,v_audit_game_id,v_row.id,v_action,v_actor,public.audit_actor_name(v_actor),v_summary,
    case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return case when tg_op='DELETE' then old else new end;
end; $$;

revoke all on function public.log_assignment_audit() from public, anon, authenticated;
