create or replace function private.get_organization_plan_status_impl(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with subscription as (
  select s.*,p.display_name,p.included_officials from public.refassign_subscriptions s
  join public.saas_plan_definitions p on p.code=s.plan
  where s.organization_id=p_organization_id order by s.created_at desc limit 1
 ), usage as (
  select public.count_active_officials_for_organization(p_organization_id,now()) active_officials
 ), features as (
  select coalesce(jsonb_object_agg(e.feature_key,jsonb_build_object('enabled',coalesce(o.enabled,e.enabled),'limit',coalesce(o.limit_value,e.limit_value),'configuration',e.configuration)),'{}'::jsonb) value
  from subscription s join public.saas_plan_entitlements e on e.plan_code=s.plan
  left join public.organization_entitlement_overrides o on o.organization_id=p_organization_id and o.feature_key=e.feature_key and o.effective_at<=now() and (o.expires_at is null or o.expires_at>now())
 )
 select jsonb_build_object('organization_id',p_organization_id,'plan',s.plan,'display_name',s.display_name,'status',s.status,
  'included_officials',s.included_officials,'additional_blocks',s.additional_official_blocks,
  'capacity',case when s.included_officials is null then null else s.included_officials+(s.additional_official_blocks*25) end,
  'active_officials',u.active_officials,'features',f.value)
 from subscription s cross join usage u cross join features f
 where private.can_access_organization(p_organization_id);
$$;

create or replace function public.get_organization_plan_status(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_organization_plan_status_impl(p_organization_id) $$;

revoke all on function private.get_organization_plan_status_impl(uuid) from public,anon;
grant execute on function private.get_organization_plan_status_impl(uuid) to authenticated;
revoke all on function public.get_organization_plan_status(uuid) from public,anon;
grant execute on function public.get_organization_plan_status(uuid) to authenticated;
