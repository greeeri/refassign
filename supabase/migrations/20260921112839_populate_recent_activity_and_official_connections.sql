alter table public.audit_history drop constraint if exists audit_history_entity_type_check;
alter table public.audit_history add constraint audit_history_entity_type_check
  check (entity_type in ('assignment', 'game', 'official'));

update public.audit_history audit set organization_id = game.organization_id
from public.games game
where audit.organization_id is null and audit.game_id = game.id and game.organization_id is not null;

create or replace function public.log_assignment_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text; v_summary text; v_game_number text; v_organization_id uuid; v_official text; v_position text; v_actor uuid:=(select auth.uid()); v_row public.assignments;
begin
  v_row:=case when tg_op='DELETE' then old else new end;
  select g.game_number,g.organization_id into v_game_number,v_organization_id from public.games g where g.id=v_row.game_id;
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
  insert into public.audit_history(organization_id,entity_type,entity_id,game_id,assignment_id,action,actor_user_id,actor_name,summary,old_data,new_data)
  values(v_organization_id,'assignment',v_row.id,v_row.game_id,v_row.id,v_action,v_actor,public.audit_actor_name(v_actor),v_summary,
    case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.log_game_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_action text; v_summary text; v_actor uuid:=(select auth.uid());
begin
  if old.status is distinct from new.status then v_action:='game_status_changed'; v_summary:='Game #'||coalesce(new.game_number,'—')||' status changed from '||old.status||' to '||new.status;
  else v_action:='game_edited'; v_summary:='Game #'||coalesce(new.game_number,'—')||' details edited'; end if;
  insert into public.audit_history(organization_id,entity_type,entity_id,game_id,action,actor_user_id,actor_name,summary,old_data,new_data)
  values(new.organization_id,'game',new.id,new.id,v_action,v_actor,public.audit_actor_name(v_actor),v_summary,to_jsonb(old),to_jsonb(new));
  return new;
end; $$;

create or replace function private.log_official_league_connection()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_official_name text; v_league_name text;
begin
  select coalesce(nullif(trim(concat_ws(' ',official.first_name,official.last_name)),''),nullif(trim(official.full_name),''),nullif(trim(official.email),''),'Official') into v_official_name
  from public.officials official where official.id=new.official_id;
  select league.name into v_league_name from public.leagues league where league.id=new.league_id;
  insert into public.audit_history(organization_id,entity_type,entity_id,action,actor_user_id,actor_name,summary,new_data,occurred_at)
  select organization_official.organization_id,'official',new.official_id,'official_connected',v_actor,
    coalesce(v_official_name,public.audit_actor_name(v_actor)),
    coalesce(v_official_name,'Official')||' connected to '||coalesce(v_league_name,'a league')||' and is ready to assign',
    jsonb_build_object('league_id',new.league_id,'league_name',v_league_name),now()
  from public.organization_officials organization_official
  where organization_official.official_id=new.official_id and organization_official.active
    and exists(select 1 from public.organization_league_coverage coverage where coverage.organization_id=organization_official.organization_id and coverage.league_id=new.league_id and coverage.active);
  return new;
end; $$;

revoke all on function private.log_official_league_connection() from public,anon,authenticated;
drop trigger if exists official_league_connection_audit_trigger on public.official_league_eligibility;
create trigger official_league_connection_audit_trigger after insert on public.official_league_eligibility
for each row execute function private.log_official_league_connection();

insert into public.audit_history(organization_id,entity_type,entity_id,action,actor_user_id,actor_name,summary,new_data,occurred_at)
select organization_official.organization_id,'official',official.id,'official_connected',official.auth_user_id,
  coalesce(nullif(trim(concat_ws(' ',official.first_name,official.last_name)),''),nullif(trim(official.full_name),''),nullif(trim(official.email),''),'Official'),
  coalesce(nullif(trim(concat_ws(' ',official.first_name,official.last_name)),''),nullif(trim(official.full_name),''),nullif(trim(official.email),''),'Official')||' connected to '||league.name||' and is ready to assign',
  jsonb_build_object('league_id',league.id,'league_name',league.name,'backfilled',true),organization_official.joined_at
from public.official_league_eligibility eligibility
join public.officials official on official.id=eligibility.official_id
join public.leagues league on league.id=eligibility.league_id
join public.organization_officials organization_official on organization_official.official_id=eligibility.official_id and organization_official.active
where organization_official.joined_at>=now()-interval '7 days'
and exists(select 1 from public.organization_league_coverage coverage where coverage.organization_id=organization_official.organization_id and coverage.league_id=eligibility.league_id and coverage.active)
and not exists(select 1 from public.audit_history existing where existing.organization_id=organization_official.organization_id and existing.entity_type='official' and existing.entity_id=official.id and existing.action='official_connected' and existing.new_data->>'league_id'=league.id::text);

notify pgrst,'reload schema';
