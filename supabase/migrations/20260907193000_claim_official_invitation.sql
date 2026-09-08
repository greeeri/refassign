-- Claim an official invitation from its emailed bearer identifier. This avoids
-- relying on email-string matching while still requiring an authenticated user.

create or replace function private.claim_official_invitation_impl(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invitation public.organization_official_invitations%rowtype;
  v_official public.officials%rowtype;
  v_first_name text;
  v_last_name text;
  v_full_name text;
  v_organization_name text;
begin
  if v_user_id is null then
    raise exception 'Sign in before accepting this official invitation.';
  end if;

  select * into v_invitation
  from public.organization_official_invitations
  where id = p_invitation_id
    and status in ('pending', 'accepted');

  if v_invitation.id is null then
    raise exception 'This official invitation is invalid or no longer available.';
  end if;

  select * into v_official
  from public.officials
  where lower(email) = lower(v_invitation.email)
  limit 1;

  if v_official.id is null then
    raise exception 'The official record for this invitation was not found.';
  end if;

  if v_official.auth_user_id is not null and v_official.auth_user_id <> v_user_id then
    raise exception 'This invitation has already been claimed by another account.';
  end if;

  select
    nullif(trim(raw_user_meta_data ->> 'first_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'last_name'), ''),
    nullif(trim(coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', '')), '')
  into v_first_name, v_last_name, v_full_name
  from auth.users
  where id = v_user_id;

  if v_first_name is null and v_full_name is not null then
    v_first_name := split_part(v_full_name, ' ', 1);
  end if;
  if v_last_name is null and v_full_name is not null and position(' ' in v_full_name) > 0 then
    v_last_name := trim(substr(v_full_name, position(' ' in v_full_name) + 1));
  end if;

  update public.officials
  set auth_user_id = v_user_id,
      first_name = coalesce(nullif(trim(first_name), ''), v_first_name, ''),
      last_name = coalesce(nullif(trim(last_name), ''), v_last_name, ''),
      full_name = coalesce(nullif(trim(full_name), ''), v_full_name, v_invitation.email)
  where id = v_official.id;

  insert into public.organization_officials (organization_id, official_id, active, added_by)
  values (v_invitation.organization_id, v_official.id, true, v_invitation.invited_by)
  on conflict (organization_id, official_id)
  do update set active = true;

  update public.organization_official_invitations
  set status = 'accepted', accepted_at = coalesce(accepted_at, now())
  where id = v_invitation.id;

  select name into v_organization_name
  from public.organizations
  where id = v_invitation.organization_id;

  return jsonb_build_object(
    'organization_id', v_invitation.organization_id,
    'organization_name', v_organization_name,
    'official_id', v_official.id
  );
end;
$$;

create or replace function public.claim_official_invitation(p_invitation_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_official_invitation_impl(p_invitation_id)
$$;

revoke all on function private.claim_official_invitation_impl(uuid) from public, anon;
revoke all on function public.claim_official_invitation(uuid) from public, anon;
grant execute on function private.claim_official_invitation_impl(uuid) to authenticated;
grant execute on function public.claim_official_invitation(uuid) to authenticated;
