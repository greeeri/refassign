CREATE OR REPLACE FUNCTION public.respond_to_assignment(p_token uuid, p_response text, p_decline_reason text DEFAULT NULL::text)
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
 from public.assignments a
 join public.games g on g.id=a.game_id
 left join public.locations l on l.id=g.location_id
 where a.response_token=p_token and a.published_at is not null for update of a;
 if not found then raise exception 'Assignment not found'; end if;
 if v_status in ('accepted','confirmed') then return v_status; end if;
 -- A deadline marks an assignment overdue; only removal/cancellation ends response eligibility.
 if v_status is distinct from 'proposed' then raise exception 'Assignment is no longer available'; end if;
 if p_response='declined' and nullif(trim(coalesce(p_decline_reason,'')),'') is null then raise exception 'A decline reason is required'; end if;
 if p_response='accepted' then
   update public.assignments set status='accepted',responded_at=now(),decline_reason=null where id=v_assignment_id;
   return 'accepted';
 end if;

 insert into public.assignment_declines(game_id,official_id,position_id,declined_at,decline_reason)
 values(v_game_id,v_official_id,v_position_id,now(),trim(p_decline_reason))
 on conflict(game_id,official_id,position_id) do update set declined_at=excluded.declined_at,decline_reason=excluded.decline_reason;

 v_note := 'DECLINED — Game #'||coalesce(v_game_number,'—')||' | '||to_char(v_starts_at at time zone 'America/Chicago','MM/DD/YYYY')||' | '||to_char(v_starts_at at time zone 'America/Chicago','FMHH12:MI AM')||' | '||coalesce(v_location_name,'TBD')||' | Reason: '||trim(p_decline_reason);

 insert into public.official_availability_blocks(official_id,block_type,starts_at,ends_at,notes,created_by,source_assignment_id)
 values(v_official_id,'time',v_starts_at,v_starts_at+make_interval(mins=>coalesce(v_duration,120)),v_note,v_official_id,v_assignment_id)
 on conflict (source_assignment_id) where source_assignment_id is not null do update
 set block_type='time',starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=null,end_date=null,location_id=null,team_id=null,notes=excluded.notes;

 delete from public.assignments where id=v_assignment_id;
 return 'declined';
end; $function$;


NOTIFY pgrst, 'reload schema';
