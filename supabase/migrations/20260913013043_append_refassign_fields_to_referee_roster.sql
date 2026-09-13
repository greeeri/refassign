-- Append RefAssign operational fields to the USSF referee profile roster.
-- Performance rankings are returned and written only for the signed-in assignor.

drop function if exists public.get_organization_official_directory(uuid);
drop function if exists private.get_organization_official_directory_impl(uuid);

create function private.get_organization_official_directory_impl(p_organization_id uuid)
returns table(
  id uuid, first_name text, last_name text, date_of_birth date, is_minor boolean,
  gender text, ethnicity text, email text, secondary_email text, home_address text,
  address_unit text, home_city text, home_state text, home_zip text, country text,
  phone text, mobile_phone text, license text, license_status text,
  license_issue_date date, license_expiration_date date, license_issuer text,
  curriculum text, background_screening text,
  background_screening_expiration_date date, safesport text,
  safesport_expiration_date date, intro_player_safety text,
  intro_player_safety_expiration_date date, safe_soccer text,
  safe_soccer_expiration_date date, provisional_status text,
  referee_years_experience integer, sports text[], home_area text,
  certification_level text, college_license_level text,
  high_school_license_level text, us_soccer_license_level text,
  organization_active boolean, max_games_per_day integer,
  eligible_leagues text, eligible_levels text, general_rank numeric,
  ref_rank numeric, ar1_rank numeric, ar2_rank numeric, fourth_rank numeric,
  mentor_certified boolean, notes text
)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then
    raise exception 'Not authorized.';
  end if;
  return query
  select o.id,o.first_name,o.last_name,o.date_of_birth,o.is_minor,o.gender,
    o.ethnicity,o.email,o.secondary_email,o.home_address,o.address_unit,
    o.home_city,o.home_state,o.home_zip,o.country,o.phone,o.mobile_phone,
    o.license,o.license_status,o.license_issue_date,o.license_expiration_date,
    o.license_issuer,o.curriculum,o.background_screening,
    o.background_screening_expiration_date,o.safesport,o.safesport_expiration_date,
    o.intro_player_safety,o.intro_player_safety_expiration_date,o.safe_soccer,
    o.safe_soccer_expiration_date,o.provisional_status,o.referee_years_experience,
    o.sports,o.home_area,o.certification_level,o.college_license_level,
    o.high_school_license_level,o.us_soccer_license_level,oo.active,
    o.max_games_per_day,
    coalesce((select string_agg(l.name,', ' order by l.name)
      from public.official_league_eligibility e join public.leagues l on l.id=e.league_id
      where e.official_id=o.id and exists(select 1 from public.organization_league_coverage c
        where c.organization_id=p_organization_id and c.league_id=e.league_id and c.active)),''),
    coalesce((select string_agg(lv.name,', ' order by lv.name)
      from public.official_level_eligibility e join public.levels lv on lv.id=e.level_id
      where e.official_id=o.id and exists(select 1 from public.organization_levels ol
        where ol.organization_id=p_organization_id and ol.level_id=e.level_id and ol.active)),''),
    coalesce(r.rank,1),coalesce(r.ref_rank,1),coalesce(r.ar1_rank,1),
    coalesce(r.ar2_rank,1),coalesce(r.fourth_rank,1),coalesce(mc.certified,false),o.notes
  from public.organization_officials oo
  join public.officials o on o.id=oo.official_id
  left join public.assignor_official_rankings r
    on r.official_id=o.id and r.assignor_id=auth.uid()
  left join public.official_mentor_certifications mc on mc.official_id=o.id
  where oo.organization_id=p_organization_id
  order by o.last_name nulls last,o.first_name nulls last,o.email;
end $$;

create function public.get_organization_official_directory(p_organization_id uuid)
returns table(
  id uuid, first_name text, last_name text, date_of_birth date, is_minor boolean,
  gender text, ethnicity text, email text, secondary_email text, home_address text,
  address_unit text, home_city text, home_state text, home_zip text, country text,
  phone text, mobile_phone text, license text, license_status text,
  license_issue_date date, license_expiration_date date, license_issuer text,
  curriculum text, background_screening text,
  background_screening_expiration_date date, safesport text,
  safesport_expiration_date date, intro_player_safety text,
  intro_player_safety_expiration_date date, safe_soccer text,
  safe_soccer_expiration_date date, provisional_status text,
  referee_years_experience integer, sports text[], home_area text,
  certification_level text, college_license_level text,
  high_school_license_level text, us_soccer_license_level text,
  organization_active boolean, max_games_per_day integer,
  eligible_leagues text, eligible_levels text, general_rank numeric,
  ref_rank numeric, ar1_rank numeric, ar2_rank numeric, fourth_rank numeric,
  mentor_certified boolean, notes text
)
language sql security invoker set search_path='' as $$
  select * from private.get_organization_official_directory_impl(p_organization_id)
$$;

revoke all on function private.get_organization_official_directory_impl(uuid) from public,anon;
revoke all on function public.get_organization_official_directory(uuid) from public,anon;
grant execute on function private.get_organization_official_directory_impl(uuid) to authenticated;
grant execute on function public.get_organization_official_directory(uuid) to authenticated;

create function public.upsert_my_referee_profile_row(
  p_organization_id uuid, p_ussf_id text, p_first_name text, p_last_name text,
  p_date_of_birth date, p_is_minor boolean, p_gender text, p_ethnicity text,
  p_email text, p_secondary_email text, p_address text, p_address_unit text,
  p_city text, p_state text, p_zip text, p_country text, p_phone text,
  p_mobile_phone text, p_license text, p_status text, p_issue_date date,
  p_expiration_date date, p_issuer text, p_curriculum text,
  p_background_screening text, p_background_screening_expiration_date date,
  p_safesport text, p_safesport_expiration_date date, p_intro_player_safety text,
  p_intro_player_safety_expiration_date date, p_safe_soccer text,
  p_safe_soccer_expiration_date date, p_provisional_status text,
  p_referee_years_experience integer, p_sports text[], p_home_area text,
  p_certification_level text, p_college_license_level text,
  p_high_school_license_level text, p_us_soccer_license_level text,
  p_organization_active boolean, p_max_games_per_day integer,
  p_eligible_leagues text[], p_eligible_levels text[], p_general_rank numeric,
  p_ref_rank numeric, p_ar1_rank numeric, p_ar2_rank numeric, p_fourth_rank numeric,
  p_mentor_certified boolean, p_notes text
) returns table(result_official_id uuid,result_action text)
language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid; v_action text; v_missing text;
begin
  select core.result_official_id,core.result_action into v_id,v_action
  from private.upsert_my_referee_profile_row(p_organization_id,p_ussf_id,
    p_first_name,p_last_name,p_date_of_birth,p_is_minor,p_gender,p_ethnicity,p_email,
    p_secondary_email,p_address,p_address_unit,p_city,p_state,p_zip,p_country,p_phone,
    p_mobile_phone,p_license,p_status,p_issue_date,p_expiration_date,p_issuer,p_curriculum,
    p_background_screening,p_background_screening_expiration_date,p_safesport,
    p_safesport_expiration_date,p_intro_player_safety,p_intro_player_safety_expiration_date,
    p_safe_soccer,p_safe_soccer_expiration_date,p_provisional_status,p_referee_years_experience) core;

  if p_max_games_per_day is not null and p_max_games_per_day < 1 then
    raise exception 'Column Max games per day: must be at least 1';
  end if;
  if exists(select 1 from unnest(array[p_general_rank,p_ref_rank,p_ar1_rank,p_ar2_rank,p_fourth_rank]) value
    where value is not null and value not between 1 and 10) then
    raise exception 'Ranking columns must be between 1.0 and 10.0';
  end if;

  select string_agg(requested.name,', ') into v_missing
  from unnest(coalesce(p_eligible_leagues,'{}')) requested(name)
  where not exists(select 1 from public.leagues l
    join public.organization_league_coverage c on c.league_id=l.id
    where c.organization_id=p_organization_id and c.active and lower(btrim(l.name))=lower(btrim(requested.name)));
  if v_missing is not null then raise exception 'Eligible leagues not found in this organization: %',v_missing; end if;
  select string_agg(requested.name,', ') into v_missing
  from unnest(coalesce(p_eligible_levels,'{}')) requested(name)
  where not exists(select 1 from public.levels lv
    join public.organization_levels ol on ol.level_id=lv.id
    where ol.organization_id=p_organization_id and ol.active and lower(btrim(lv.name))=lower(btrim(requested.name)));
  if v_missing is not null then raise exception 'Eligible levels not found in this organization: %',v_missing; end if;

  update public.officials set
    sports=case when cardinality(coalesce(p_sports,'{}'))=0 then array['Soccer']::text[] else p_sports end,
    home_area=nullif(btrim(coalesce(p_home_area,'')),''),
    certification_level=nullif(btrim(coalesce(p_certification_level,'')),''),
    college_license_level=nullif(btrim(coalesce(p_college_license_level,'')),''),
    high_school_license_level=nullif(btrim(coalesce(p_high_school_license_level,'')),''),
    us_soccer_license_level=nullif(btrim(coalesce(p_us_soccer_license_level,'')),''),
    max_games_per_day=coalesce(p_max_games_per_day,2),notes=nullif(btrim(coalesce(p_notes,'')),''),updated_at=now()
  where id=v_id;
  update public.organization_officials set active=coalesce(p_organization_active,false)
  where organization_id=p_organization_id and official_id=v_id;

  delete from public.official_league_eligibility e where e.official_id=v_id and exists(
    select 1 from public.organization_league_coverage c where c.organization_id=p_organization_id and c.league_id=e.league_id);
  insert into public.official_league_eligibility(official_id,league_id)
  select distinct v_id,l.id from unnest(coalesce(p_eligible_leagues,'{}')) requested(name)
  join public.leagues l on lower(btrim(l.name))=lower(btrim(requested.name))
  join public.organization_league_coverage c on c.league_id=l.id and c.organization_id=p_organization_id and c.active
  on conflict do nothing;
  delete from public.official_level_eligibility e where e.official_id=v_id and exists(
    select 1 from public.organization_levels ol where ol.organization_id=p_organization_id and ol.level_id=e.level_id);
  insert into public.official_level_eligibility(official_id,level_id)
  select distinct v_id,lv.id from unnest(coalesce(p_eligible_levels,'{}')) requested(name)
  join public.levels lv on lower(btrim(lv.name))=lower(btrim(requested.name))
  join public.organization_levels ol on ol.level_id=lv.id and ol.organization_id=p_organization_id and ol.active
  on conflict do nothing;

  insert into public.assignor_official_rankings(assignor_id,official_id,rank,ref_rank,ar1_rank,ar2_rank,fourth_rank,updated_at)
  values(auth.uid(),v_id,coalesce(p_general_rank,1),coalesce(p_ref_rank,1),coalesce(p_ar1_rank,1),
    coalesce(p_ar2_rank,1),coalesce(p_fourth_rank,1),now())
  on conflict(assignor_id,official_id) do update set rank=excluded.rank,ref_rank=excluded.ref_rank,
    ar1_rank=excluded.ar1_rank,ar2_rank=excluded.ar2_rank,fourth_rank=excluded.fourth_rank,updated_at=now();
  insert into public.official_mentor_certifications(official_id,certified,updated_by,updated_at)
  values(v_id,coalesce(p_mentor_certified,false),auth.uid(),now())
  on conflict(official_id) do update set certified=excluded.certified,updated_by=auth.uid(),updated_at=now();

  result_official_id:=v_id; result_action:=v_action; return next;
end $$;

revoke all on function public.upsert_my_referee_profile_row(
  uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,
  date,date,text,text,text,date,text,date,text,date,text,date,text,integer,text[],text,text,text,text,text,
  boolean,integer,text[],text[],numeric,numeric,numeric,numeric,numeric,boolean,text
) from public,anon;
grant execute on function public.upsert_my_referee_profile_row(
  uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,
  date,date,text,text,text,date,text,date,text,date,text,date,text,integer,text[],text,text,text,text,text,
  boolean,integer,text[],text[],numeric,numeric,numeric,numeric,numeric,boolean,text
) to authenticated;

notify pgrst,'reload schema';
