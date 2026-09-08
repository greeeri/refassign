create or replace function private.can_manage_organization(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization_id
      and membership.user_id=(select auth.uid())
      and membership.role in ('owner','admin','assignor')
  ) or public.is_super_admin()
$$;

create or replace function private.bulk_search_organization_official_emails_impl(p_organization_id uuid,p_emails text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;v_results jsonb:='[]'::jsonb;v_item jsonb;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if coalesce(array_length(p_emails,1),0)>500 then raise exception 'A bulk upload is limited to 500 email addresses.'; end if;
  for v_email in select distinct lower(trim(value)) from unnest(coalesce(p_emails,array[]::text[])) value where trim(value)<>'' loop
    if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      v_item:=jsonb_build_object('email',v_email,'valid',false,'found',false,'existing_account',false,'already_connected',false);
    else
      v_item:=private.search_organization_official_email_impl(p_organization_id,v_email)||jsonb_build_object('valid',true);
    end if;
    v_results:=v_results||jsonb_build_array(v_item);
  end loop;
  return v_results;
end $$;

create or replace function public.bulk_search_organization_official_emails(p_organization_id uuid,p_emails text[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.bulk_search_organization_official_emails_impl(p_organization_id,p_emails)
$$;

create or replace function private.bulk_add_organization_official_emails_impl(p_organization_id uuid,p_emails text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text;v_results jsonb:='[]'::jsonb;
begin
  if (select auth.uid()) is null or not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
  if coalesce(array_length(p_emails,1),0)>500 then raise exception 'A bulk upload is limited to 500 email addresses.'; end if;
  for v_email in select distinct lower(trim(value)) from unnest(coalesce(p_emails,array[]::text[])) value where trim(value)<>'' and lower(trim(value))~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' loop
    v_results:=v_results||jsonb_build_array(private.add_organization_official_by_email_impl(p_organization_id,v_email));
  end loop;
  return v_results;
end $$;

create or replace function public.bulk_add_organization_official_emails(p_organization_id uuid,p_emails text[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.bulk_add_organization_official_emails_impl(p_organization_id,p_emails)
$$;

revoke all on function private.bulk_search_organization_official_emails_impl(uuid,text[]) from public,anon;
revoke all on function public.bulk_search_organization_official_emails(uuid,text[]) from public,anon;
revoke all on function private.bulk_add_organization_official_emails_impl(uuid,text[]) from public,anon;
revoke all on function public.bulk_add_organization_official_emails(uuid,text[]) from public,anon;
grant execute on function private.bulk_search_organization_official_emails_impl(uuid,text[]) to authenticated;
grant execute on function public.bulk_search_organization_official_emails(uuid,text[]) to authenticated;
grant execute on function private.bulk_add_organization_official_emails_impl(uuid,text[]) to authenticated;
grant execute on function public.bulk_add_organization_official_emails(uuid,text[]) to authenticated;
