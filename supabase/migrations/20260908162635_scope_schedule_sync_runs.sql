alter table public.schedule_sync_runs
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

update public.schedule_sync_runs run
set organization_id = scope.organization_id
from (
  select coverage.organization_id
  from public.organization_league_coverage coverage
  join public.leagues league on league.id = coverage.league_id
  where league.name = 'N1' and coverage.active
  order by coverage.created_at
  limit 1
) scope
where run.source_system = 'gotsport'
  and run.source_event_id = '54033'
  and run.organization_id is null;

create index if not exists schedule_sync_runs_organization_time_idx
  on public.schedule_sync_runs(organization_id, started_at desc);
