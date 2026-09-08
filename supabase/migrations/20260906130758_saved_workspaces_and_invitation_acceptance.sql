alter table public.organization_memberships drop constraint organization_memberships_role_check;
alter table public.organization_memberships add constraint organization_memberships_role_check check (role in ('owner','admin','assignor','billing','viewer'));

create or replace function private.get_my_test_workspaces_impl()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(workspace order by workspace->>'created_at' desc),'[]'::jsonb)
 from (
  select jsonb_build_object(
   'organization_id',o.id,'name',o.name,'created_at',o.created_at,'role',m.role,
   'plan',s.plan,'official_limit',s.official_limit,'additional_official_blocks',s.additional_official_blocks,'status',s.status,
   'leagues',coalesce((select jsonb_agg(jsonb_build_object('name',l.name,'region',loc.name,'coverage',case when c.location_id is null then 'All locations' else 'Selected locations or region' end))
    from public.organization_league_coverage c join public.leagues l on l.id=c.league_id left join public.locations loc on loc.id=c.location_id where c.organization_id=o.id and c.active=true),'[]'::jsonb)
  ) workspace
  from public.organization_memberships m join public.organizations o on o.id=m.organization_id
  left join lateral (select * from public.refassign_subscriptions rs where rs.organization_id=o.id order by rs.created_at desc limit 1) s on true
  where m.user_id=(select auth.uid())
 ) rows;
$$;

create or replace function public.get_my_test_workspaces()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_my_test_workspaces_impl() $$;

create or replace function private.accept_my_organization_invitations_impl()
returns integer language plpgsql security definer set search_path='' as $$
declare v_email text; v_count integer;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
 select lower(email) into v_email from auth.users where id=(select auth.uid());
 with accepted as (
  update public.organization_invitations set status='accepted',accepted_at=now()
  where lower(email)=v_email and status='pending' returning organization_id,role
 ), inserted as (
  insert into public.organization_memberships(organization_id,user_id,role)
  select organization_id,(select auth.uid()),role from accepted on conflict do nothing returning 1
 ) select count(*) into v_count from inserted;
 return v_count;
end;
$$;

create or replace function public.accept_my_organization_invitations()
returns integer language sql security invoker set search_path='' as $$ select private.accept_my_organization_invitations_impl() $$;

revoke all on function private.get_my_test_workspaces_impl() from public,anon;
revoke all on function private.accept_my_organization_invitations_impl() from public,anon;
grant execute on function private.get_my_test_workspaces_impl() to authenticated;
grant execute on function private.accept_my_organization_invitations_impl() to authenticated;
revoke all on function public.get_my_test_workspaces() from public,anon;
revoke all on function public.accept_my_organization_invitations() from public,anon;
grant execute on function public.get_my_test_workspaces() to authenticated;
grant execute on function public.accept_my_organization_invitations() to authenticated;
