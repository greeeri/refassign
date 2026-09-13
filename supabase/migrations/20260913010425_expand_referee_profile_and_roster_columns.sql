alter table public.officials
  add column if not exists date_of_birth date,
  add column if not exists is_minor boolean not null default false,
  add column if not exists gender text,
  add column if not exists ethnicity text,
  add column if not exists secondary_email text,
  add column if not exists address_unit text,
  add column if not exists country text,
  add column if not exists mobile_phone text,
  add column if not exists license text,
  add column if not exists license_status text,
  add column if not exists license_issue_date date,
  add column if not exists license_expiration_date date,
  add column if not exists license_issuer text,
  add column if not exists curriculum text,
  add column if not exists background_screening text,
  add column if not exists background_screening_expiration_date date,
  add column if not exists safesport text,
  add column if not exists safesport_expiration_date date,
  add column if not exists intro_player_safety text,
  add column if not exists intro_player_safety_expiration_date date,
  add column if not exists safe_soccer text,
  add column if not exists safe_soccer_expiration_date date,
  add column if not exists provisional_status text,
  add column if not exists referee_years_experience integer;

alter table public.officials
  drop constraint if exists officials_referee_years_experience_check;
alter table public.officials
  add constraint officials_referee_years_experience_check
  check (referee_years_experience is null or referee_years_experience >= 0);

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
  referee_years_experience integer, home_area text, sports text[],
  certification_level text, active boolean
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
    o.home_area,o.sports,o.certification_level,oo.active
  from public.organization_officials oo
  join public.officials o on o.id=oo.official_id
  where oo.organization_id=p_organization_id and oo.active
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
  referee_years_experience integer, home_area text, sports text[],
  certification_level text, active boolean
)
language sql security invoker set search_path='' as $$
  select * from private.get_organization_official_directory_impl(p_organization_id)
$$;

revoke all on function private.get_organization_official_directory_impl(uuid) from public,anon;
revoke all on function public.get_organization_official_directory(uuid) from public,anon;
grant execute on function private.get_organization_official_directory_impl(uuid) to authenticated;
grant execute on function public.get_organization_official_directory(uuid) to authenticated;

create or replace function private.upsert_my_referee_profile_row(
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
  p_referee_years_experience integer
) returns table(result_official_id uuid, result_action text)
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_action text;
begin
  if auth.uid() is null or not (private.can_access_organization(p_organization_id) and exists (
    select 1 from public.organization_memberships m where m.organization_id=p_organization_id
      and m.user_id=auth.uid() and m.role in ('owner','admin','assignor')
  )) then raise exception 'You cannot import officials for this organization' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_first_name,'')),'') is null then raise exception 'Column First name: missing value'; end if;
  if nullif(btrim(coalesce(p_last_name,'')),'') is null then raise exception 'Column Last name: missing value'; end if;
  if p_referee_years_experience is not null and p_referee_years_experience < 0 then raise exception 'Column Referee years exp: must be zero or greater'; end if;
  begin
    if nullif(btrim(coalesce(p_ussf_id,'')),'') is not null then
      select o.id into v_id from public.officials o where o.id=p_ussf_id::uuid;
    end if;
  exception when invalid_text_representation then v_id:=null; end;
  if v_id is null and nullif(btrim(coalesce(p_email,'')),'') is not null then
    select o.id into v_id from public.officials o where lower(btrim(o.email))=lower(btrim(p_email)) limit 1;
  end if;
  if v_id is null then
    insert into public.officials(first_name,last_name,date_of_birth,is_minor,gender,ethnicity,email,
      secondary_email,home_address,address_unit,home_city,home_state,home_zip,country,phone,
      mobile_phone,license,license_status,license_issue_date,license_expiration_date,license_issuer,
      curriculum,background_screening,background_screening_expiration_date,safesport,
      safesport_expiration_date,intro_player_safety,intro_player_safety_expiration_date,safe_soccer,
      safe_soccer_expiration_date,provisional_status,referee_years_experience,sports,active)
    values(btrim(p_first_name),btrim(p_last_name),p_date_of_birth,coalesce(p_is_minor,false),
      nullif(btrim(coalesce(p_gender,'')),''),nullif(btrim(coalesce(p_ethnicity,'')),''),
      nullif(btrim(coalesce(p_email,'')),''),nullif(btrim(coalesce(p_secondary_email,'')),''),
      nullif(btrim(coalesce(p_address,'')),''),nullif(btrim(coalesce(p_address_unit,'')),''),
      nullif(btrim(coalesce(p_city,'')),''),nullif(btrim(coalesce(p_state,'')),''),
      nullif(btrim(coalesce(p_zip,'')),''),nullif(btrim(coalesce(p_country,'')),''),
      nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_mobile_phone,'')),''),
      nullif(btrim(coalesce(p_license,'')),''),nullif(btrim(coalesce(p_status,'')),''),
      p_issue_date,p_expiration_date,nullif(btrim(coalesce(p_issuer,'')),''),
      nullif(btrim(coalesce(p_curriculum,'')),''),nullif(btrim(coalesce(p_background_screening,'')),''),
      p_background_screening_expiration_date,nullif(btrim(coalesce(p_safesport,'')),''),
      p_safesport_expiration_date,nullif(btrim(coalesce(p_intro_player_safety,'')),''),
      p_intro_player_safety_expiration_date,nullif(btrim(coalesce(p_safe_soccer,'')),''),
      p_safe_soccer_expiration_date,nullif(btrim(coalesce(p_provisional_status,'')),''),
      p_referee_years_experience,array['Soccer']::text[],true)
    returning id into v_id;
    v_action:='Add';
  else
    update public.officials o set first_name=btrim(p_first_name),last_name=btrim(p_last_name),
      date_of_birth=p_date_of_birth,is_minor=coalesce(p_is_minor,false),gender=nullif(btrim(coalesce(p_gender,'')),''),
      ethnicity=nullif(btrim(coalesce(p_ethnicity,'')),''),email=nullif(btrim(coalesce(p_email,'')),''),
      secondary_email=nullif(btrim(coalesce(p_secondary_email,'')),''),home_address=nullif(btrim(coalesce(p_address,'')),''),
      address_unit=nullif(btrim(coalesce(p_address_unit,'')),''),home_city=nullif(btrim(coalesce(p_city,'')),''),
      home_state=nullif(btrim(coalesce(p_state,'')),''),home_zip=nullif(btrim(coalesce(p_zip,'')),''),
      country=nullif(btrim(coalesce(p_country,'')),''),phone=nullif(btrim(coalesce(p_phone,'')),''),
      mobile_phone=nullif(btrim(coalesce(p_mobile_phone,'')),''),license=nullif(btrim(coalesce(p_license,'')),''),
      license_status=nullif(btrim(coalesce(p_status,'')),''),license_issue_date=p_issue_date,
      license_expiration_date=p_expiration_date,license_issuer=nullif(btrim(coalesce(p_issuer,'')),''),
      curriculum=nullif(btrim(coalesce(p_curriculum,'')),''),background_screening=nullif(btrim(coalesce(p_background_screening,'')),''),
      background_screening_expiration_date=p_background_screening_expiration_date,safesport=nullif(btrim(coalesce(p_safesport,'')),''),
      safesport_expiration_date=p_safesport_expiration_date,intro_player_safety=nullif(btrim(coalesce(p_intro_player_safety,'')),''),
      intro_player_safety_expiration_date=p_intro_player_safety_expiration_date,safe_soccer=nullif(btrim(coalesce(p_safe_soccer,'')),''),
      safe_soccer_expiration_date=p_safe_soccer_expiration_date,provisional_status=nullif(btrim(coalesce(p_provisional_status,'')),''),
      referee_years_experience=p_referee_years_experience,updated_at=now()
    where o.id=v_id;
    v_action:='Update';
  end if;
  insert into public.organization_officials(organization_id,official_id,active,added_by)
  values(p_organization_id,v_id,true,auth.uid())
  on conflict(organization_id,official_id) do update set active=true;
  result_official_id:=v_id; result_action:=v_action; return next;
end $$;

create or replace function public.upsert_my_referee_profile_row(
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
  p_referee_years_experience integer
) returns table(result_official_id uuid,result_action text)
language sql security invoker set search_path='' as $$
  select * from private.upsert_my_referee_profile_row(p_organization_id,p_ussf_id,
    p_first_name,p_last_name,p_date_of_birth,p_is_minor,p_gender,p_ethnicity,p_email,
    p_secondary_email,p_address,p_address_unit,p_city,p_state,p_zip,p_country,p_phone,
    p_mobile_phone,p_license,p_status,p_issue_date,p_expiration_date,p_issuer,p_curriculum,
    p_background_screening,p_background_screening_expiration_date,p_safesport,
    p_safesport_expiration_date,p_intro_player_safety,p_intro_player_safety_expiration_date,
    p_safe_soccer,p_safe_soccer_expiration_date,p_provisional_status,p_referee_years_experience)
$$;

revoke all on function private.upsert_my_referee_profile_row(uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,date,text,text,text,date,text,date,text,date,text,date,text,integer) from public,anon;
revoke all on function public.upsert_my_referee_profile_row(uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,date,text,text,text,date,text,date,text,date,text,date,text,integer) from public,anon;
grant execute on function private.upsert_my_referee_profile_row(uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,date,text,text,text,date,text,date,text,date,text,date,text,integer) to authenticated;
grant execute on function public.upsert_my_referee_profile_row(uuid,text,text,text,date,boolean,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date,date,text,text,text,date,text,date,text,date,text,date,text,integer) to authenticated;

notify pgrst, 'reload schema';
