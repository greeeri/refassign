alter table public.official_level_eligibility
  add column if not exists center_eligible boolean not null default true,
  add column if not exists ar_eligible boolean not null default true;

alter table public.official_level_eligibility drop constraint if exists official_level_eligibility_has_position_check;
alter table public.official_level_eligibility add constraint official_level_eligibility_has_position_check
  check (center_eligible or ar_eligible);

create or replace function public.set_organization_official_position_eligibility(
  p_organization_id uuid,p_official_id uuid,p_league_ids uuid[] default '{}'::uuid[],
  p_center_level_ids uuid[] default '{}'::uuid[],p_ar_level_ids uuid[] default '{}'::uuid[]
) returns void language plpgsql security definer set search_path='' as $$
declare v_level_ids uuid[];
begin
  select coalesce(array_agg(distinct selected.id),'{}'::uuid[]) into v_level_ids
  from unnest(coalesce(p_center_level_ids,'{}'::uuid[]) || coalesce(p_ar_level_ids,'{}'::uuid[])) selected(id);
  perform private.set_organization_official_eligibility(p_organization_id,p_official_id,p_league_ids,v_level_ids);
  update public.official_level_eligibility eligibility
  set center_eligible=eligibility.level_id=any(coalesce(p_center_level_ids,'{}'::uuid[])),
      ar_eligible=eligibility.level_id=any(coalesce(p_ar_level_ids,'{}'::uuid[]))
  where eligibility.official_id=p_official_id and eligibility.level_id=any(v_level_ids);
end $$;
revoke all on function public.set_organization_official_position_eligibility(uuid,uuid,uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.set_organization_official_position_eligibility(uuid,uuid,uuid[],uuid[],uuid[]) to authenticated;

do $migration$
declare v_name text;v_definition text;v_original text;
begin
  foreach v_name in array array['run_my_auto_assign','run_organization_auto_assign'] loop
    select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name
      and pg_get_function_identity_arguments(p.oid)='p_organization_id uuid, p_start_date date, p_end_date date, p_same_team_limit integer';
    if v_definition is null then raise exception 'AutoAssign function % was not found',v_name; end if;
    v_original:=v_definition;
    v_definition:=replace(v_definition,
      'and (v_game.level_id is null or level_eligibility.official_id is not null)',
      'and (v_game.level_id is null or (level_eligibility.official_id is not null and case
        when lower(v_pos.name)=''ar1'' or lower(v_pos.name)=''ar2'' or lower(v_pos.name) like ''%assistant referee%'' then level_eligibility.ar_eligible
        when lower(v_pos.name) like ''%center%'' or (lower(v_pos.name) like ''%referee%'' and lower(v_pos.name) not like ''%assistant%'') then level_eligibility.center_eligible
        else true end))');
    if v_definition=v_original then raise exception 'Position-specific AutoAssign rewrite did not match %',v_name; end if;
    execute v_definition;
  end loop;
end $migration$;

do $migration$
declare v_name text;v_args text;v_definition text;v_original text;v_old text;v_new text;
begin
  for v_name,v_args,v_old,v_new in
    select * from (values
      ('list_my_self_assign_opportunities','p_organization_id uuid','e.level_id=game.level_id)',
        'e.level_id=game.level_id and case when lower(position.name) in (''ar1'',''ar2'') or lower(position.name) like ''%assistant referee%'' then e.ar_eligible when lower(position.name) like ''%center%'' or (lower(position.name) like ''%referee%'' and lower(position.name) not like ''%assistant%'') then e.center_eligible else true end)'),
      ('request_self_assign_override','p_slot_id uuid, p_organization_id uuid','e.level_id=v_game.level_id)',
        'e.level_id=v_game.level_id and case when (select lower(name) from public.sport_positions where id=v_slot.position_id) in (''ar1'',''ar2'') or (select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%assistant referee%'' then e.ar_eligible when (select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%center%'' or ((select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%referee%'' and (select lower(name) from public.sport_positions where id=v_slot.position_id) not like ''%assistant%'') then e.center_eligible else true end)'),
      ('claim_self_assign_position','p_slot_id uuid, p_organization_id uuid','eligibility.level_id=v_game.level_id)',
        'eligibility.level_id=v_game.level_id and case when (select lower(name) from public.sport_positions where id=v_slot.position_id) in (''ar1'',''ar2'') or (select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%assistant referee%'' then eligibility.ar_eligible when (select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%center%'' or ((select lower(name) from public.sport_positions where id=v_slot.position_id) like ''%referee%'' and (select lower(name) from public.sport_positions where id=v_slot.position_id) not like ''%assistant%'') then eligibility.center_eligible else true end)')
    ) as rewrites(function_name,identity_args,old_text,new_text)
  loop
    select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name and pg_get_function_identity_arguments(p.oid)=v_args;
    if v_definition is null then raise exception 'Function % was not found',v_name; end if;
    v_original:=v_definition;v_definition:=replace(v_definition,v_old,v_new);
    if v_definition=v_original then raise exception 'Position eligibility rewrite did not match %',v_name; end if;
    execute v_definition;
  end loop;
end $migration$;

comment on column public.official_level_eligibility.center_eligible is 'Official may work the center referee position at this game level.';
comment on column public.official_level_eligibility.ar_eligible is 'Official may work assistant referee positions at this game level.';
notify pgrst,'reload schema';
