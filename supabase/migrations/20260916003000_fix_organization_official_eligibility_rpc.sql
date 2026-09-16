create or replace function public.set_organization_official_eligibility(
  p_organization_id uuid,
  p_official_id uuid,
  p_league_ids uuid[] default '{}'::uuid[],
  p_level_ids uuid[] default '{}'::uuid[]
) returns void
language sql security definer set search_path='' as $$
  select private.set_organization_official_eligibility(
    p_organization_id,p_official_id,p_league_ids,p_level_ids
  )
$$;

revoke all on function public.set_organization_official_eligibility(uuid,uuid,uuid[],uuid[]) from public,anon;
grant execute on function public.set_organization_official_eligibility(uuid,uuid,uuid[],uuid[]) to authenticated;
