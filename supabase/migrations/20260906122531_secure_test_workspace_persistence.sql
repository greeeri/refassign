create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null, role text not null check (role in ('admin','assignor','billing','viewer')),
  invited_by uuid not null references auth.users(id) on delete cascade, status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(), accepted_at timestamptz, unique (organization_id,email)
);
alter table public.organization_invitations enable row level security;
create policy "Managers read invitations" on public.organization_invitations for select to authenticated using (private.can_manage_organization(organization_id));
create policy "Managers create invitations" on public.organization_invitations for insert to authenticated with check (private.can_manage_organization(organization_id) and invited_by=(select auth.uid()));
create policy "Managers update invitations" on public.organization_invitations for update to authenticated using (private.can_manage_organization(organization_id)) with check (private.can_manage_organization(organization_id));
create policy "Managers delete invitations" on public.organization_invitations for delete to authenticated using (private.can_manage_organization(organization_id));

create or replace function private.create_test_organization_workspace_impl(p_organization_name text,p_plan text,p_official_limit integer,p_additional_official_blocks integer,p_leagues jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user_id uuid := (select auth.uid()); v_organization_id uuid; v_league jsonb; v_league_id uuid; v_location_id uuid;
begin
 if v_user_id is null then raise exception 'Authentication required.'; end if;
 if length(trim(coalesce(p_organization_name,''))) not between 1 and 160 then raise exception 'Organization name is required.'; end if;
 if not exists(select 1 from public.saas_plan_definitions where code=p_plan and active=true) then raise exception 'Unknown or inactive plan.'; end if;
 if p_additional_official_blocks < 0 then raise exception 'Additional blocks cannot be negative.'; end if;
 insert into public.organizations(name) values(trim(p_organization_name)) returning id into v_organization_id;
 insert into public.organization_memberships(organization_id,user_id,role) values(v_organization_id,v_user_id,'owner');
 insert into public.refassign_subscriptions(user_id,organization_id,organization_name,plan,official_limit,status,founding_offer,additional_official_blocks)
 values(v_user_id,v_organization_id,trim(p_organization_name),p_plan,p_official_limit,'pending',p_plan='pro_founding',p_additional_official_blocks);
 for v_league in select value from jsonb_array_elements(coalesce(p_leagues,'[]'::jsonb)) loop
  if length(trim(coalesce(v_league->>'name',''))) > 0 then
   select id into v_league_id from public.leagues where lower(name)=lower(trim(v_league->>'name')) limit 1;
   if v_league_id is null then insert into public.leagues(name) values(trim(v_league->>'name')) returning id into v_league_id; end if;
   v_location_id:=null;
   if coalesce(v_league->>'coverage','All locations')<>'All locations' and length(trim(coalesce(v_league->>'region','')))>0 then
    select id into v_location_id from public.locations where lower(name)=lower(trim(v_league->>'region')) limit 1;
    if v_location_id is null then insert into public.locations(name) values(trim(v_league->>'region')) returning id into v_location_id; end if;
   end if;
   insert into public.organization_league_coverage(organization_id,league_id,location_id) values(v_organization_id,v_league_id,v_location_id) on conflict do nothing;
  end if;
 end loop;
 return v_organization_id;
end; $$;

create or replace function public.create_test_organization_workspace(p_organization_name text,p_plan text,p_official_limit integer,p_additional_official_blocks integer,p_leagues jsonb default '[]'::jsonb)
returns uuid language sql security invoker set search_path='' as $$ select private.create_test_organization_workspace_impl(p_organization_name,p_plan,p_official_limit,p_additional_official_blocks,p_leagues) $$;

create or replace function private.create_organization_invitation_impl(p_organization_id uuid,p_email text,p_role text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.can_manage_organization(p_organization_id) then raise exception 'Not authorized.'; end if;
 if p_role not in ('admin','assignor','billing','viewer') then raise exception 'Invalid role.'; end if;
 if position('@' in coalesce(p_email,''))<2 then raise exception 'Valid email required.'; end if;
 insert into public.organization_invitations(organization_id,email,role,invited_by) values(p_organization_id,lower(trim(p_email)),p_role,(select auth.uid()))
 on conflict(organization_id,email) do update set role=excluded.role,status='pending',invited_by=excluded.invited_by,created_at=now() returning id into v_id;
 return v_id;
end; $$;

create or replace function public.create_organization_invitation(p_organization_id uuid,p_email text,p_role text)
returns uuid language sql security invoker set search_path='' as $$ select private.create_organization_invitation_impl(p_organization_id,p_email,p_role) $$;

revoke all on function private.create_test_organization_workspace_impl(text,text,integer,integer,jsonb) from public,anon;
revoke all on function private.create_organization_invitation_impl(uuid,text,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.create_test_organization_workspace_impl(text,text,integer,integer,jsonb) to authenticated;
grant execute on function private.create_organization_invitation_impl(uuid,text,text) to authenticated;
revoke all on function public.create_test_organization_workspace(text,text,integer,integer,jsonb) from public,anon;
revoke all on function public.create_organization_invitation(uuid,text,text) from public,anon;
grant execute on function public.create_test_organization_workspace(text,text,integer,integer,jsonb) to authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text) to authenticated;
