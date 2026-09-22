-- Regression cases run in temporary tables and rolled back; no real assignments are changed.
begin;
create temp table assignments(id uuid primary key,game_id uuid,position_id uuid,status text,accept_by timestamptz,official_id uuid,response_token uuid,published_at timestamptz,responded_at timestamptz,decline_reason text);
create temp table games(id uuid,starts_at timestamptz,duration_minutes int,game_number text,location_id uuid);
create temp table locations(id uuid,name text);
create temp table assignment_declines(game_id uuid,official_id uuid,position_id uuid,declined_at timestamptz,decline_reason text,unique(game_id,official_id,position_id));
create temp table official_availability_blocks(official_id uuid,block_type text,starts_at timestamptz,ends_at timestamptz,notes text,created_by uuid,source_assignment_id uuid,start_date date,end_date date,location_id uuid,team_id uuid);
create unique index on official_availability_blocks(source_assignment_id) where source_assignment_id is not null;
CREATE OR REPLACE FUNCTION pg_temp.respond_to_assignment(p_token uuid, p_response text, p_decline_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_status text; v_deadline timestamptz; v_assignment_id uuid; v_game_id uuid; v_position_id uuid; v_official_id uuid;
 v_starts_at timestamptz; v_duration integer; v_game_number text; v_location_id uuid; v_location_name text;
 v_note text;
begin
 if p_response not in ('accepted','declined') then raise exception 'Response must be accepted or declined'; end if;
 select a.id,a.game_id,a.position_id,a.status,a.accept_by,a.official_id,g.starts_at,g.duration_minutes,g.game_number,g.location_id,l.name
 into v_assignment_id,v_game_id,v_position_id,v_status,v_deadline,v_official_id,v_starts_at,v_duration,v_game_number,v_location_id,v_location_name
 from pg_temp.assignments a
 join pg_temp.games g on g.id=a.game_id
 left join pg_temp.locations l on l.id=g.location_id
 where a.response_token=p_token and a.published_at is not null for update of a;
 if not found then raise exception 'Assignment not found'; end if;
 if v_status in ('accepted','confirmed') then return v_status; end if;
 if v_status is distinct from 'proposed' then raise exception 'Assignment is no longer available'; end if;
 if p_response='declined' and nullif(trim(coalesce(p_decline_reason,'')),'') is null then raise exception 'A decline reason is required'; end if;
 if p_response='accepted' then
   update pg_temp.assignments set status='accepted',responded_at=now(),decline_reason=null where id=v_assignment_id;
   return 'accepted';
 end if;

 insert into pg_temp.assignment_declines(game_id,official_id,position_id,declined_at,decline_reason)
 values(v_game_id,v_official_id,v_position_id,now(),trim(p_decline_reason))
 on conflict(game_id,official_id,position_id) do update set declined_at=excluded.declined_at,decline_reason=excluded.decline_reason;

 v_note := 'DECLINED — Game #'||coalesce(v_game_number,'—')||' | '||to_char(v_starts_at at time zone 'America/Chicago','MM/DD/YYYY')||' | '||to_char(v_starts_at at time zone 'America/Chicago','FMHH12:MI AM')||' | '||coalesce(v_location_name,'TBD')||' | Reason: '||trim(p_decline_reason);

 insert into pg_temp.official_availability_blocks(official_id,block_type,starts_at,ends_at,notes,created_by,source_assignment_id)
 values(v_official_id,'time',v_starts_at,v_starts_at+make_interval(mins=>coalesce(v_duration,120)),v_note,v_official_id,v_assignment_id)
 on conflict (source_assignment_id) where source_assignment_id is not null do update
 set block_type='time',starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=null,end_date=null,location_id=null,team_id=null,notes=excluded.notes;

 delete from pg_temp.assignments where id=v_assignment_id;
 return 'declined';
end; $function$;

do $test$
declare a uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); result text;
begin
insert into pg_temp.games values(g,now()+interval '2 days',90,'TEST',null);
insert into pg_temp.assignments(id,game_id,position_id,status,accept_by,official_id,response_token,published_at) values(a,g,p,'proposed',now()-interval '1 day',o,t,now()-interval '2 days');
result:=pg_temp.respond_to_assignment(t,'accepted',null);
if result<>'accepted' or not exists(select from pg_temp.assignments where id=a and status='accepted') then raise exception 'Late accept failed'; end if;
update pg_temp.assignments set status='proposed' where id=a;
result:=pg_temp.respond_to_assignment(t,'declined','Test reason');
if result<>'declined' or exists(select from pg_temp.assignments where id=a) or not exists(select from pg_temp.assignment_declines where game_id=g) then raise exception 'Late decline failed'; end if;
begin perform pg_temp.respond_to_assignment(t,'accepted',null); raise exception 'Removed assignment allowed'; exception when others then if SQLERRM<>'Assignment not found' then raise; end if; end;
insert into pg_temp.assignments(id,game_id,position_id,status,accept_by,official_id,response_token,published_at) values(a,g,p,'cancelled',now()-interval '1 day',o,t,now()-interval '2 days');
begin perform pg_temp.respond_to_assignment(t,'accepted',null); raise exception 'Cancelled assignment allowed'; exception when others then if SQLERRM<>'Assignment is no longer available' then raise; end if; end;
update pg_temp.assignments set status='proposed' where id=a;
begin perform pg_temp.respond_to_assignment(t,'declined',''); raise exception 'Empty reason allowed'; exception when others then if SQLERRM<>'A decline reason is required' then raise; end if; end;
end $test$;
rollback;
