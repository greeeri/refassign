-- Source reporting, acknowledgment, and operational holds are independent.
-- No existing game statuses are changed by deployment. The next successful feed
-- check reconciles source cancellations and evaluates current hold evidence.
alter table public.games
  add column bound_source_status text,
  add column bound_hold_reasons text[] not null default '{}',
  add column bound_hold_resolution_candidate boolean not null default false,
  add column bound_hold_checked_at timestamptz,
  add column bound_hold_checked_game jsonb;
alter table public.calendar_sync_events add column normalized_event jsonb;

create function private.bound_hold_game_signature(g public.games) returns jsonb
language sql immutable set search_path='' as $$
 select private.bound_game_state(g)||jsonb_build_object('venue_conflict_hold',g.venue_conflict_hold,'notes',g.notes);
$$;
revoke all on function private.bound_hold_game_signature(public.games) from public,anon,authenticated;
grant execute on function private.bound_hold_game_signature(public.games) to service_role;

-- Correct the legacy cancellation exception: a hold must not mask cancellation.
do $fix$
declare d text; old_clause text := 'and facts->>''status''=''CANCELLED'' and g.status<>''suspended''';
begin
 select pg_get_functiondef('public.apply_bound_calendar_feed(uuid,uuid,jsonb,text,text,text)'::regprocedure) into d;
 if position(old_clause in d)=0 then raise exception 'Unexpected Bound sync definition'; end if;
 d:=replace(d,old_clause,'and facts->>''status''=''CANCELLED''');
 -- Canceled source peers do not occupy resources.
 d:=replace(d,'o->>''uid''<>uid and not','o->>''uid''<>uid and upper(coalesce(o->''facts''->>''status'',''''))<>''CANCELLED'' and not');
 d:=replace(d,'then ''canceled'' else ''active'' end','then ''canceled'' when facts->>''status''=''CONFIRMED'' then ''active'' else ''suspended'' end');
 d:=replace(d,'facts->>''status''=''TENTATIVE'' or','coalesce(facts->>''status'',''UNKNOWN'') not in(''CONFIRMED'',''CANCELLED'') or');
 execute d;
end $fix$;

alter function public.apply_bound_calendar_feed(uuid,uuid,jsonb,text,text,text) rename to apply_bound_calendar_feed_base;
alter function public.apply_bound_calendar_feed_base(uuid,uuid,jsonb,text,text,text) set schema private;
revoke all on function private.apply_bound_calendar_feed_base(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function private.apply_bound_calendar_feed_base(uuid,uuid,jsonb,text,text,text) to service_role;

create function public.apply_bound_calendar_feed(p_feed_id uuid,p_run_id uuid,p_events jsonb,p_hash text,p_etag text default null,p_last_modified text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 result jsonb; f public.calendar_sync_feeds; g public.games; s public.calendar_sync_events;
 e jsonb; facts jsonb; reasons text[]; candidate boolean; next_status text; source_status text;
 previous_game public.games; changed boolean; n_rechecked int:=0; has_source_overlap boolean; has_db_overlap boolean;
begin
 -- The base function validates and locks the lease, serializes organization sync,
 -- preserves manual overrides and assignments, and handles source removals.
 result:=private.apply_bound_calendar_feed_base(p_feed_id,p_run_id,p_events,p_hash,p_etag,p_last_modified);
 select * into strict f from public.calendar_sync_feeds where id=p_feed_id;
 perform set_config('refassign.bound_sync','on',true);
 if p_events is not null then
  update public.calendar_sync_events ce set normalized_event=x.value
  from jsonb_array_elements(p_events) x
  where ce.feed_id=p_feed_id and ce.uid=x.value->>'uid';
 end if;
 -- Includes unchanged games, removed games and HTTP 304 checks. Recheck after
 -- applying the entire payload so source ordering cannot leave stale blockers.
 for s in select ce.* from public.calendar_sync_events ce where ce.feed_id=p_feed_id loop
  select * into g from public.games where id=s.game_id for update;
  if not found or g.archived_at is not null or g.source_system<>'gobound'
     or g.source_event_id is distinct from f.source_event_id then continue; end if;
  e:=s.normalized_event; facts:=s.source_facts;
  source_status:=coalesce(upper(nullif(trim(facts->>'status'),'')),'UNKNOWN');
  -- Ongoing resolution work is deliberately bounded to held/canceled games.
  -- Existing active games receive source metadata only; no blanket re-hold.
  if g.status not in('suspended','canceled','cancelled') and source_status<>'CANCELLED' then
   update public.games set bound_source_status=source_status,bound_hold_checked_at=now() where id=g.id;
   continue;
  end if;
  reasons:='{}'; next_status:=g.status; candidate:=false;
  if source_status='CANCELLED' then
   next_status:='canceled';
  else
   if not s.present and not exists(select 1 from public.calendar_sync_events ce where ce.game_id=g.id and ce.present) then reasons:=array_append(reasons,'source_removed'); end if;
   if source_status='TENTATIVE' then reasons:=array_append(reasons,'source_tentative');
   elsif source_status is null or source_status<>'CONFIRMED' then reasons:=array_append(reasons,'source_status_unknown'); end if;
   if coalesce(g.time_tbd,true) or nullif(facts->>'time','') is null then reasons:=array_append(reasons,'missing_time'); end if;
   if coalesce(g.field_tbd,true) or g.location_id is null or nullif(facts->>'location','') is null then reasons:=array_append(reasons,'missing_venue'); end if;
   if g.level_id is null or nullif(facts->>'level','') is null then reasons:=array_append(reasons,'missing_level'); end if;
   if lower(coalesce(e->>'source_level',facts->>'level'))='jvr-a' or lower(facts->>'level') like 'jvr-a %' then reasons:=array_append(reasons,'ambiguous_level'); end if;
   if e is null then
    -- Legacy snapshots lack duration normalization. Be conservative until a full
    -- fetch supplies enough evidence; a 304 must never infer resolution.
    reasons:=array_append(reasons,'source_details_unverified');
   elsif coalesce((e->>'duration')::numeric,0) not between 1 and 1440 or (e->>'duration')::numeric<>trunc((e->>'duration')::numeric) then reasons:=array_append(reasons,'invalid_duration'); end if;
   if g.home_team_id is null or g.away_team_id is null or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and (t.source_system='refassign-placeholder' or t.name ilike '%TBD%'))
      or (e is not null and (e->>'home_school' is null or e->>'away_school' is null)) then reasons:=array_append(reasons,'missing_teams'); end if;
   select exists(
    select 1 from public.calendar_sync_events other
    where other.feed_id=p_feed_id and other.uid<>s.uid and other.present
     and upper(coalesce(other.source_facts->>'status',''))<>'CANCELLED'
     and not coalesce((other.normalized_event->>'time_tbd')::boolean,true)
     and not coalesce((other.normalized_event->>'field_tbd')::boolean,true)
     and not g.time_tbd and not g.field_tbd
     and lower(trim(other.source_facts->>'location'))=lower(trim(facts->>'location'))
     and exists(select 1 from public.locations l where l.id=g.location_id and lower(trim(l.name))=lower(trim(facts->>'location')))
     and (other.normalized_event->>'starts_at')::timestamptz<g.starts_at+make_interval(mins=>g.duration_minutes)
     and (other.normalized_event->>'starts_at')::timestamptz+make_interval(mins=>case when (other.normalized_event->>'duration')::numeric between 1 and 1440 then (other.normalized_event->>'duration')::numeric::int else 110 end)>g.starts_at
   ) into has_source_overlap;
   select exists(
    select 1 from public.games x where x.id<>g.id and x.organization_id=g.organization_id and x.archived_at is null and not x.time_tbd and not g.time_tbd
     and x.status not in('canceled','cancelled','rained_out')
     -- Exclude owner-source cancellations before their loop turn, so the
     -- first pass is deterministic even for legacy suspended cancellations.
     and not exists(select 1 from public.calendar_sync_events canceled_source
       where canceled_source.feed_id=p_feed_id and canceled_source.game_id=x.id
       and x.source_event_id=f.source_event_id
       and upper(canceled_source.source_facts->>'status')='CANCELLED')
     and x.starts_at<g.starts_at+make_interval(mins=>g.duration_minutes)
     and x.starts_at+make_interval(mins=>x.duration_minutes)>g.starts_at
     and ((not g.field_tbd and not x.field_tbd and x.location_id=g.location_id)
       or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and t.id in(x.home_team_id,x.away_team_id) and coalesce(t.source_system,'')<>'refassign-placeholder'))
   ) into has_db_overlap;
   if has_source_overlap then reasons:=array_append(reasons,'source_overlap'); end if;
   if has_db_overlap then reasons:=array_append(reasons,'database_overlap'); end if;
   if cardinality(reasons)>0 and g.status not in('canceled','cancelled','rained_out') then next_status:='suspended'; end if;
   candidate:=next_status='suspended' and g.venue_conflict_hold and cardinality(reasons)=0 and s.present;
  end if;
  previous_game:=g;
  changed:=g.bound_source_status is distinct from source_status or g.bound_hold_reasons is distinct from reasons or g.bound_hold_resolution_candidate is distinct from candidate or g.status is distinct from next_status;
  update public.games set
   bound_source_status=source_status,bound_hold_reasons=reasons,bound_hold_resolution_candidate=candidate,bound_hold_checked_at=now(),
   status=next_status,venue_conflict_hold=venue_conflict_hold or ('source_overlap'=any(reasons) or 'database_overlap'=any(reasons)),
   calendar_needs_review=case when changed then true else calendar_needs_review end,
   calendar_reviewed_at=case when changed then null else calendar_reviewed_at end,
   calendar_reviewed_by=case when changed then null else calendar_reviewed_by end
  where id=g.id returning * into g;
  update public.games set bound_hold_checked_game=private.bound_hold_game_signature(g) where id=g.id;
  if changed then
   n_rechecked:=n_rechecked+1;
   insert into public.calendar_sync_changes(run_id,game_id,uid,kind,before_source,after_source,details)
   values(p_run_id,g.id,s.uid,'hold_recheck',facts,facts,
    'Status: '||previous_game.status||' -> '||next_status||'; blockers: ['||array_to_string(previous_game.bound_hold_reasons,', ')||'] -> ['||array_to_string(reasons,', ')||']; candidate: '||previous_game.bound_hold_resolution_candidate::text||' -> '||candidate::text||'. '||
    case when candidate then 'Hold blockers no longer detected. Assignor review required; game remains On Hold.'
         when source_status='CANCELLED' then 'Source cancellation preserved; acknowledgment does not reactivate the game.'
         else 'Current hold blockers: '||array_to_string(reasons,', ')||'. No automatic hold release.' end);
  end if;
 end loop;
 perform set_config('refassign.bound_sync','off',true);
 return result||jsonb_build_object('holds_rechecked',n_rechecked);
end;
$$;
revoke all on function public.apply_bound_calendar_feed(uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_bound_calendar_feed(uuid,uuid,jsonb,text,text,text) to service_role;

-- The generic resource guard intentionally ignores held peers. Bound source
-- blockers must therefore also be cleared by a successful check before release.
create function public.guard_bound_hold_activation() returns trigger
language plpgsql set search_path='' as $$
begin
 if (old.source_system='gobound' or new.source_system='gobound')
    and lower(trim(new.status)) in('active','open')
    and lower(trim(old.status)) not in('active','open')
    and (old.bound_source_status='CANCELLED' or cardinality(old.bound_hold_reasons)>0) then
  raise exception 'Bound source conflict or unresolved details: recheck the calendar and resolve blockers before activating this game.' using errcode='23514';
 end if;
 return new;
end;
$$;
create trigger games_guard_bound_hold_activation before update of status on public.games
for each row execute function public.guard_bound_hold_activation();

-- Acknowledgment is metadata only. Preserve the same assignment/fee protections
-- used during source checks, including when legacy triggers fire on all updates.
do $review$
declare d text;
begin
 select pg_get_functiondef('public.confirm_calendar_game_review(uuid[])'::regprocedure) into d;
 if position('  v_reviewed integer;' in d)=0 then raise exception 'Unexpected calendar review definition'; end if;
 d:=replace(d,'  v_reviewed integer;','  v_reviewed integer; v_previous_sync text := current_setting(''refassign.bound_sync'',true);');
 d:=replace(d,'  update public.games',E'  perform set_config(''refassign.bound_sync'',''on'',true);\n  update public.games');
 d:=replace(d,'  get diagnostics v_reviewed = row_count;',E'  get diagnostics v_reviewed = row_count;\n  perform set_config(''refassign.bound_sync'',coalesce(v_previous_sync,''off''),true);');
 execute d;
end $review$;

-- Conditional HTTP requests cannot fill legacy snapshots. Request a full fetch
-- until every present event has the normalized evidence needed for rechecks.
do $claim$
declare d text; marker text := 'jsonb_build_object(''run_id'',r)';
begin
 select pg_get_functiondef('public.claim_bound_calendar_feed(uuid,boolean)'::regprocedure) into d;
 if position(marker in d)=0 then raise exception 'Unexpected Bound claim definition'; end if;
 execute replace(d,marker,'jsonb_build_object(''run_id'',r,''needs_full_fetch'',exists(select 1 from public.calendar_sync_events ce where ce.feed_id=f.id and ce.present and ce.normalized_event is null))');
end $claim$;

-- Atomic acknowledgment and safe release. This is not an overlap override.
create function public.review_and_release_bound_game(p_game_id uuid,p_expected_hold_checked_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); g public.games; before_game jsonb; outcome text;
 previous_sync text := current_setting('refassign.bound_sync',true);
begin
 if actor is null then raise exception 'Sign in to review and release a hold.' using errcode='42501'; end if;
 select * into g from public.games where id=p_game_id;
 if not found or not coalesce(private.can_manage_organization_league(g.organization_id,g.league_id,actor),false) then
  raise exception 'You cannot review and release this game.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(g.organization_id::text||':gobound',0));
 -- Prevent new or edited peers appearing between the live overlap check and
 -- activation. Kept only for this short transaction; no external work occurs.
 lock table public.games in share row exclusive mode;
 select * into g from public.games where id=p_game_id for update;
 if not coalesce(private.can_manage_organization_league(g.organization_id,g.league_id,actor),false) then
  raise exception 'You cannot review and release this game.' using errcode='42501';
 end if;
 if g.source_system is distinct from 'gobound' or g.archived_at is not null then raise exception 'Only current Bound calendar holds can be reviewed here.'; end if;
 if p_expected_hold_checked_at is null or g.bound_hold_checked_at is distinct from p_expected_hold_checked_at
    or g.bound_hold_checked_game is distinct from private.bound_hold_game_signature(g) then
  raise exception 'This game changed since its last hold check. Refresh the calendar and review it again.' using errcode='40001';
 end if;
 before_game:=to_jsonb(g);
 if g.status='canceled' or g.bound_source_status='CANCELLED' then
  if g.status<>'canceled' then raise exception 'Refresh the calendar to reconcile the source cancellation first.'; end if;
  outcome:='canceled_reviewed';
 elsif g.status='active' and not g.venue_conflict_hold and not g.calendar_needs_review and g.calendar_reviewed_at is not null then
  return jsonb_build_object('outcome','already_released','status',g.status,'reviewed',false,'released',false,'game_id',g.id);
 else
  if g.status<>'suspended' or not g.venue_conflict_hold or not g.bound_hold_resolution_candidate or cardinality(g.bound_hold_reasons)>0
     or g.bound_source_status is distinct from 'CONFIRMED' then
   raise exception 'This hold is not eligible for release. Resolve its blockers and recheck the calendar first.' using errcode='23514';
  end if;
  if g.time_tbd or g.field_tbd or g.location_id is null or g.level_id is null or g.home_team_id is null or g.away_team_id is null
     or g.duration_minutes not between 1 and 1440
     or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and (t.source_system='refassign-placeholder' or t.name ilike '%TBD%')) then raise exception 'Confirm the game details before releasing this hold.' using errcode='23514'; end if;
  if exists(select 1 from public.games x where x.id<>g.id and x.organization_id=g.organization_id and x.archived_at is null
      and not x.time_tbd and x.status not in('canceled','cancelled','rained_out')
      and x.starts_at<g.starts_at+make_interval(mins=>g.duration_minutes)
      and x.starts_at+make_interval(mins=>x.duration_minutes)>g.starts_at
      and ((not x.field_tbd and x.location_id=g.location_id)
       or exists(select 1 from public.teams t where t.id in(g.home_team_id,g.away_team_id) and t.id in(x.home_team_id,x.away_team_id) and coalesce(t.source_system,'')<>'refassign-placeholder'))) then
   raise exception 'A current resource overlap still blocks release. Refresh the calendar and resolve it first.' using errcode='23514';
  end if;
  outcome:='released';
 end if;
 if outcome='canceled_reviewed' and not g.calendar_needs_review and g.calendar_reviewed_at is not null then
  return jsonb_build_object('outcome',outcome,'status',g.status,'reviewed',false,'released',false,'game_id',g.id);
 end if;
 perform set_config('refassign.bound_sync','on',true);
 update public.games set status=case when outcome='released' then 'active' else status end,
  calendar_needs_review=false,calendar_reviewed_at=now(),calendar_reviewed_by=actor,
  bound_hold_resolution_candidate=false where id=g.id returning * into g;
 update public.games set bound_hold_checked_game=private.bound_hold_game_signature(g) where id=g.id;
 insert into public.audit_history(organization_id,entity_type,entity_id,game_id,action,actor_user_id,summary,old_data,new_data)
 values(g.organization_id,'game',g.id,g.id,'bound_review_release',actor,
  case when outcome='released' then 'Reviewed and released resolved Bound resource hold.' else 'Reviewed source cancellation; game remains canceled.' end,before_game,to_jsonb(g));
 perform set_config('refassign.bound_sync',coalesce(previous_sync,'off'),true);
 return jsonb_build_object('outcome',outcome,'status',g.status,'reviewed',true,'released',outcome='released','game_id',g.id);
end;
$$;
revoke all on function public.review_and_release_bound_game(uuid,timestamptz) from public,anon;
grant execute on function public.review_and_release_bound_game(uuid,timestamptz) to authenticated;
