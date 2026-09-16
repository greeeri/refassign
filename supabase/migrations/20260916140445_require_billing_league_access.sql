-- Billing is a league-scoped operational role. Older records were created
-- before the team editor exposed league selection for Billing Managers, so
-- grant those existing records all currently connected organization leagues.
update public.organization_user_access_profiles access
set league_ids = coalesce(
  (
    select array_agg(coverage.league_id order by coverage.league_id)
    from public.organization_league_coverage coverage
    where coverage.organization_id = access.organization_id
      and coverage.active
  ),
  '{}'::uuid[]
),
updated_at = now()
where 'billing' = any(access.roles)
  and cardinality(access.league_ids) = 0;

insert into public.organization_member_league_access(
  organization_id,
  user_id,
  league_id
)
select access.organization_id, access.user_id, league_id
from public.organization_user_access_profiles access
cross join lateral unnest(access.league_ids) league_id
where 'billing' = any(access.roles)
on conflict do nothing;

update public.organization_invitations invitation
set league_ids = coalesce(
  (
    select array_agg(coverage.league_id order by coverage.league_id)
    from public.organization_league_coverage coverage
    where coverage.organization_id = invitation.organization_id
      and coverage.active
  ),
  '{}'::uuid[]
)
where invitation.status = 'pending'
  and 'billing' = any(
    case
      when cardinality(invitation.roles) > 0 then invitation.roles
      else array[invitation.role]
    end
  )
  and cardinality(invitation.league_ids) = 0;
