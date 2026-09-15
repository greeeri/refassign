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
  if not exists (select 1 from public.protected_accounts where user_id = p_actor_user_id) then
    raise exception 'Super-admin access required.';
  end if;

  select * into v_official from public.officials where id = p_official_id;
  if not found then raise exception 'Official not found.'; end if;
  if v_official.auth_user_id is not null and exists (
    select 1 from public.protected_accounts where user_id = v_official.auth_user_id
  ) then raise exception 'The protected owner official cannot be deleted.'; end if;

  update public.assignment_self_assign_slots set claimed_by = null, claimed_at = null where claimed_by = p_official_id;
  delete from public.payroll_transfers where official_id = p_official_id;
  delete from public.payroll_batch_items where official_id = p_official_id;
  delete from public.officials where id = p_official_id;

  insert into public.super_admin_audit(actor_user_id, action, details)
  values (p_actor_user_id, 'official_purged', jsonb_build_object(
    'official_id', p_official_id, 'email', v_official.email,
    'auth_user_id', v_official.auth_user_id
  ));
  return jsonb_build_object('deleted', true, 'id', p_official_id, 'auth_user_id', v_official.auth_user_id);
end;
$$;

create or replace function public.super_admin_delete_league(
  p_actor_user_id uuid,
  p_league_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_game_count integer;
begin
  if not exists (select 1 from public.protected_accounts where user_id = p_actor_user_id) then
    raise exception 'Super-admin access required.';
  end if;
  select name into v_name from public.leagues where id = p_league_id;
  if not found then raise exception 'League not found.'; end if;
  select count(*) into v_game_count from public.games where league_id = p_league_id;

  delete from public.payment_audit_events where league_id = p_league_id;
  delete from public.payroll_transfers where payroll_batch_id in (select id from public.payroll_batches where league_id = p_league_id);
  delete from public.payroll_batch_items where payroll_batch_id in (select id from public.payroll_batches where league_id = p_league_id);
  delete from public.payment_transactions where league_id = p_league_id;
  delete from public.payroll_batches where league_id = p_league_id;
  delete from public.official_registrations where league_id = p_league_id;
  delete from public.games where league_id = p_league_id;
  delete from public.leagues where id = p_league_id;

  insert into public.super_admin_audit(actor_user_id, action, details)
  values (p_actor_user_id, 'league_purged', jsonb_build_object(
    'league_id', p_league_id, 'name', v_name, 'deleted_games', v_game_count
  ));
  return jsonb_build_object('deleted', true, 'id', p_league_id);
end;
$$;

revoke all on function public.super_admin_delete_official(uuid, uuid) from public, anon, authenticated;
revoke all on function public.super_admin_delete_league(uuid, uuid) from public, anon, authenticated;
grant execute on function public.super_admin_delete_official(uuid, uuid) to service_role;
grant execute on function public.super_admin_delete_league(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
