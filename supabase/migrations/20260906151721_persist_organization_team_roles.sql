create or replace function private.get_organization_team_impl(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.';
  end if;

  if not private.can_manage_organization(p_organization_id) then
    raise exception 'Only organization owners and administrators can view team access.';
  end if;

  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.user_id::text || ':' || m.role,
          'email', lower(u.email),
          'role', m.role,
          'status', 'active'
        )
        order by case m.role when 'owner' then 0 when 'admin' then 1 when 'assignor' then 2 when 'billing' then 3 else 4 end,
                 lower(u.email)
      )
      from public.organization_memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = p_organization_id
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'email', lower(i.email),
          'role', i.role,
          'status', i.status
        )
        order by i.created_at desc
      )
      from public.organization_invitations i
      where i.organization_id = p_organization_id
        and i.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_organization_team(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_organization_team_impl(p_organization_id)
$$;

revoke all on function private.get_organization_team_impl(uuid) from public, anon;
revoke all on function public.get_organization_team(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.get_organization_team_impl(uuid) to authenticated;
grant execute on function public.get_organization_team(uuid) to authenticated;
