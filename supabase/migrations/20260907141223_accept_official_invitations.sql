create or replace function private.accept_my_official_invitations_impl()
returns integer language plpgsql security definer set search_path='' as $$
declare v_email text;v_count integer:=0;
begin
  if (select auth.uid()) is null then return 0; end if;
  select lower(email) into v_email from auth.users where id=(select auth.uid());
  update public.officials set auth_user_id=(select auth.uid())
  where lower(email)=v_email and auth_user_id is null;
  update public.organization_official_invitations
  set status='accepted',accepted_at=now()
  where lower(email)=v_email and status='pending';
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function public.accept_my_official_invitations()
returns integer language sql security invoker set search_path='' as $$
  select private.accept_my_official_invitations_impl()
$$;

revoke all on function private.accept_my_official_invitations_impl() from public,anon;
revoke all on function public.accept_my_official_invitations() from public,anon;
grant execute on function private.accept_my_official_invitations_impl() to authenticated;
grant execute on function public.accept_my_official_invitations() to authenticated;
