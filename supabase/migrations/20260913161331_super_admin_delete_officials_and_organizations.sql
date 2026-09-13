create or replace function public.super_admin_delete_official(
  p_actor_user_id uuid,
  p_official_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_official public.officials%rowtype;
begin
  if not exists (
    select 1 from public.protected_accounts where user_id = p_actor_user_id
  ) then
    raise exception 'Super-admin access required.';
  end if;

  select * into v_official from public.officials where id = p_official_id;
  if not found then raise exception 'Official not found.'; end if;
  if v_official.auth_user_id is not null and exists (
    select 1 from public.protected_accounts where user_id = v_official.auth_user_id
  ) then
    raise exception 'The protected owner official cannot be deleted.';
  end if;

  update public.assignment_self_assign_slots
  set claimed_by = null, claimed_at = null
  where claimed_by = p_official_id;

  delete from public.officials where id = p_official_id;

  insert into public.super_admin_audit(actor_user_id, action, details)
  values (
    p_actor_user_id,
    'official_deleted',
    jsonb_build_object(
      'official_id', p_official_id,
      'email', v_official.email,
      'name', coalesce(nullif(trim(concat_ws(' ', v_official.first_name, v_official.last_name)), ''), v_official.full_name),
      'auth_user_id', v_official.auth_user_id
    )
  );

  return jsonb_build_object('deleted', true, 'id', p_official_id);
end;
$$;

create or replace function public.super_admin_delete_organization(
  p_actor_user_id uuid,
  p_organization_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_game_count integer;
  v_official_count integer;
begin
  if not exists (
    select 1 from public.protected_accounts where user_id = p_actor_user_id
  ) then
    raise exception 'Super-admin access required.';
  end if;

  select name into v_name from public.organizations where id = p_organization_id;
  if not found then raise exception 'Organization not found.'; end if;

  if exists (
    select 1 from public.refassign_subscriptions
    where organization_id = p_organization_id
      and lower(coalesce(status, '')) in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
  ) then
    raise exception 'Cancel the organization subscription before deleting it.';
  end if;

  select count(*) into v_game_count from public.games where organization_id = p_organization_id;
  select count(*) into v_official_count from public.organization_officials where organization_id = p_organization_id;

  delete from public.undo_operations where organization_id = p_organization_id;
  delete from public.games where organization_id = p_organization_id;
  delete from public.organizations where id = p_organization_id;

  insert into public.super_admin_audit(actor_user_id, action, details)
  values (
    p_actor_user_id,
    'organization_deleted',
    jsonb_build_object(
      'organization_id', p_organization_id,
      'name', v_name,
      'deleted_games', v_game_count,
      'disconnected_officials', v_official_count
    )
  );

  return jsonb_build_object('deleted', true, 'id', p_organization_id);
end;
$$;

revoke all on function public.super_admin_delete_official(uuid, uuid) from public, anon, authenticated;
revoke all on function public.super_admin_delete_organization(uuid, uuid) from public, anon, authenticated;
grant execute on function public.super_admin_delete_official(uuid, uuid) to service_role;
grant execute on function public.super_admin_delete_organization(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
