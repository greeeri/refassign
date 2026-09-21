-- League connection links are durable bearer links. They have no clock-based
-- expiration and remain reusable for the life of the active league. The
-- league foreign key already uses ON DELETE CASCADE, so deleting a league
-- removes its link. These lookups also stop honoring the link as soon as the
-- league is archived (leagues.active = false).

comment on table public.league_official_connection_links is
  'Reusable league invitation links with no time expiration; valid until the league is archived or deleted.';

create or replace function private.get_league_connection_link_impl(p_token uuid)
returns table (
  organization_name text,
  league_name text,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select organization.name, league.name,
    link.active and coverage.active and league.active
  from public.league_official_connection_links link
  join public.organizations organization on organization.id = link.organization_id
  join public.leagues league on league.id = link.league_id
  join public.organization_league_coverage coverage
    on coverage.organization_id = link.organization_id
   and coverage.league_id = link.league_id
   and coverage.active
  where link.token = p_token
  limit 1
$$;

create or replace function private.get_or_create_league_connection_link_impl(
  p_organization_id uuid,
  p_league_id uuid,
  p_regenerate boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin', 'assignor')
  ) then
    raise exception 'Only an organization owner, administrator, or assignor can create this link.';
  end if;

  if not exists (
    select 1
    from public.organization_league_coverage coverage
    join public.leagues league on league.id = coverage.league_id
    where coverage.organization_id = p_organization_id
      and coverage.league_id = p_league_id
      and coverage.active
      and league.active
  ) then
    raise exception 'This league is archived or is not active for the selected organization.';
  end if;

  insert into public.league_official_connection_links (
    organization_id, league_id, created_by
  ) values (
    p_organization_id, p_league_id, (select auth.uid())
  )
  on conflict (organization_id, league_id) do update
  set token = case
        when p_regenerate then gen_random_uuid()
        else public.league_official_connection_links.token
      end,
      active = true,
      updated_at = now(),
      created_by = case
        when p_regenerate then (select auth.uid())
        else public.league_official_connection_links.created_by
      end
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function private.claim_league_connection_link_impl(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_link public.league_official_connection_links%rowtype;
  v_official public.officials%rowtype;
  v_organization_name text;
  v_league_name text;
  v_already_connected boolean;
begin
  if v_user_id is null then
    raise exception 'Sign in before connecting to this league.';
  end if;

  select lower(email),
    nullif(trim(raw_user_meta_data ->> 'first_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'last_name'), ''),
    nullif(trim(coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')), '')
  into v_email, v_first_name, v_last_name, v_full_name
  from auth.users where id = v_user_id;

  if v_email is null then
    raise exception 'Your RefAssign account does not have an email address.';
  end if;

  select link.* into v_link
  from public.league_official_connection_links link
  where link.token = p_token and link.active
  for update;

  if v_link.id is null or not exists (
    select 1
    from public.organization_league_coverage coverage
    join public.leagues league on league.id = coverage.league_id
    where coverage.organization_id = v_link.organization_id
      and coverage.league_id = v_link.league_id
      and coverage.active
      and league.active
  ) then
    raise exception 'This league connection link is invalid, or the league has been archived or deleted.';
  end if;

  select * into v_official
  from public.officials
  where auth_user_id = v_user_id or lower(email) = v_email
  order by (auth_user_id = v_user_id) desc
  limit 1;

  if v_official.id is not null
     and v_official.auth_user_id is not null
     and v_official.auth_user_id <> v_user_id then
    raise exception 'This email is already connected to another RefAssign account.';
  end if;

  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name, ' ', 1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name) > 0 then
    v_last_name := trim(substr(v_full_name, position(' ' in v_full_name) + 1));
  end if;

  if v_official.id is null then
    insert into public.officials (
      auth_user_id, full_name, email, first_name, last_name
    ) values (
      v_user_id,
      coalesce(v_full_name, v_email),
      v_email,
      coalesce(v_first_name, ''),
      coalesce(v_last_name, '')
    ) returning * into v_official;
  else
    update public.officials
    set auth_user_id = v_user_id,
        first_name = coalesce(nullif(trim(first_name), ''), v_first_name, ''),
        last_name = coalesce(nullif(trim(last_name), ''), v_last_name, ''),
        full_name = coalesce(nullif(trim(full_name), ''), v_full_name, v_email)
    where id = v_official.id
    returning * into v_official;
  end if;

  select exists (
    select 1 from public.organization_officials organization_official
    join public.official_league_eligibility eligibility
      on eligibility.official_id = organization_official.official_id
     and eligibility.league_id = v_link.league_id
    where organization_official.organization_id = v_link.organization_id
      and organization_official.official_id = v_official.id
      and organization_official.active
  ) into v_already_connected;

  insert into public.organization_officials (
    organization_id, official_id, active, added_by
  ) values (
    v_link.organization_id, v_official.id, true, v_link.created_by
  ) on conflict (organization_id, official_id)
  do update set active = true;

  insert into public.official_league_eligibility (official_id, league_id)
  values (v_official.id, v_link.league_id)
  on conflict (official_id, league_id) do nothing;

  if not v_already_connected then
    update public.league_official_connection_links
    set join_count = join_count + 1, last_joined_at = now()
    where id = v_link.id;
  end if;

  select name into v_organization_name
  from public.organizations where id = v_link.organization_id;
  select name into v_league_name
  from public.leagues where id = v_link.league_id;

  return jsonb_build_object(
    'organization_id', v_link.organization_id,
    'organization_name', v_organization_name,
    'league_id', v_link.league_id,
    'league_name', v_league_name,
    'official_id', v_official.id,
    'already_connected', v_already_connected
  );
end;
$$;
