-- Complete the assignment record used by the shared RefAssign workspace.
-- The isolated tier-test database originally carried only the legacy core
-- columns, while the workspace reads the publishing, response, notification,
-- source, review, and payroll fields below.
alter table public.assignments
  add column if not exists published_at timestamptz,
  add column if not exists accept_by timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists response_token uuid,
  add column if not exists email_sent_at timestamptz,
  add column if not exists resend_email_id text,
  add column if not exists email_error text,
  add column if not exists decline_reason text,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists assignment_source text not null default 'manager',
  add column if not exists status_before_cancellation text,
  add column if not exists cancellation_notified_at timestamptz,
  add column if not exists cancellation_email_id text,
  add column if not exists cancellation_email_error text,
  add column if not exists overdue_reviewed_at timestamptz,
  add column if not exists overdue_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists overdue_review_action text,
  add column if not exists game_fee numeric(10,2) not null default 0,
  add column if not exists mileage_miles numeric(8,2) not null default 0,
  add column if not exists mileage_rate numeric(6,3) not null default 0,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists paid_at timestamptz,
  add column if not exists payroll_notes text,
  add column if not exists payroll_updated_at timestamptz,
  add column if not exists payroll_updated_by uuid references auth.users(id) on delete set null;

alter table public.assignments drop constraint if exists assignments_status_check;
alter table public.assignments add constraint assignments_status_check
  check (status in ('proposed','accepted','declined','confirmed','cancelled'));

alter table public.assignments drop constraint if exists assignments_assignment_source_check;
alter table public.assignments add constraint assignments_assignment_source_check
  check (assignment_source in ('manager','self_assign','auto_assign'));

alter table public.assignments drop constraint if exists assignments_status_before_cancellation_check;
alter table public.assignments add constraint assignments_status_before_cancellation_check
  check (status_before_cancellation is null or status_before_cancellation in ('proposed','accepted','confirmed'));

alter table public.assignments drop constraint if exists assignments_overdue_review_action_check;
alter table public.assignments add constraint assignments_overdue_review_action_check
  check (overdue_review_action is null or overdue_review_action in ('kept'));

alter table public.assignments drop constraint if exists assignments_payment_status_check;
alter table public.assignments add constraint assignments_payment_status_check
  check (payment_status in ('unpaid','approved','paid','void'));

alter table public.assignments drop constraint if exists assignments_game_fee_check;
alter table public.assignments add constraint assignments_game_fee_check check (game_fee >= 0);
alter table public.assignments drop constraint if exists assignments_mileage_miles_check;
alter table public.assignments add constraint assignments_mileage_miles_check check (mileage_miles >= 0);
alter table public.assignments drop constraint if exists assignments_mileage_rate_check;
alter table public.assignments add constraint assignments_mileage_rate_check check (mileage_rate >= 0);

create unique index if not exists assignments_response_token_key
  on public.assignments(response_token) where response_token is not null;
create index if not exists assignments_published_game_idx
  on public.assignments(game_id, published_at);
create index if not exists assignments_automatic_reminder_idx
  on public.assignments(reminder_sent_at, game_id)
  where published_at is not null and status not in ('declined','cancelled');
create index if not exists assignments_payment_status_idx
  on public.assignments(payment_status, paid_at);

create or replace function public.publish_game_assignments(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if not exists (
    select 1
      from public.games g
      join public.organization_league_coverage coverage
        on coverage.league_id=g.league_id and coverage.active
      join public.organization_memberships membership
        on membership.organization_id=coverage.organization_id
       and membership.user_id=auth.uid()
       and membership.role in ('owner','admin','assignor')
     where g.id=p_game_id
  ) then
    raise exception 'Not authorized to publish assignments for this game';
  end if;
  update public.assignments
     set published_at = now(),
         accept_by = now() + interval '24 hours',
         published_by = auth.uid(),
         response_token = coalesce(response_token, gen_random_uuid()),
         responded_at = null,
         decline_reason = null,
         email_sent_at = null,
         resend_email_id = null,
         email_error = null,
         reminder_sent_at = null
   where game_id = p_game_id
     and published_at is null
     and status = 'proposed';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_assignment_by_token(p_token uuid)
returns table(
  assignment_id uuid, game_id uuid, game_number text, starts_at timestamptz,
  home_team text, away_team text, location_name text, location_address text,
  location_city text, location_state text, league_name text, level_name text,
  position_name text, status text, published_at timestamptz, accept_by timestamptz,
  responded_at timestamptz, decline_reason text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, g.id, g.game_number, g.starts_at,
         home.name, away.name, l.name, l.address, l.city, l.state,
         league.name, level.name, position.name, a.status, a.published_at,
         a.accept_by, a.responded_at, a.decline_reason
    from public.assignments a
    join public.games g on g.id=a.game_id
    left join public.teams home on home.id=g.home_team_id
    left join public.teams away on away.id=g.away_team_id
    left join public.locations l on l.id=g.location_id
    left join public.leagues league on league.id=g.league_id
    left join public.levels level on level.id=g.level_id
    left join public.sport_positions position on position.id=a.position_id
   where a.response_token=p_token and a.published_at is not null;
$$;

create or replace function public.respond_to_assignment(
  p_token uuid, p_response text, p_decline_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_response not in ('accepted','declined') then
    raise exception 'Response must be accepted or declined';
  end if;
  if p_response='declined' and nullif(trim(p_decline_reason),'') is null then
    raise exception 'A decline reason is required';
  end if;
  update public.assignments
     set status=p_response,
         responded_at=now(),
         decline_reason=case when p_response='declined' then trim(p_decline_reason) else null end
   where response_token=p_token
     and published_at is not null
     and status='proposed';
  if not found then raise exception 'Assignment is unavailable or already answered'; end if;
end;
$$;

create or replace function public.my_official_assignments()
returns table(
  assignment_id uuid, game_id uuid, game_number text, game_status text,
  position_name text, starts_at timestamptz, home_team text, away_team text,
  location_name text, location_address text, location_city text,
  location_state text, league_name text, level_name text, notes text,
  status text, published_at timestamptz, accept_by timestamptz,
  responded_at timestamptz, decline_reason text, response_token uuid
)
language sql
security invoker
set search_path = ''
as $$
  select a.id, g.id, g.game_number, g.status, position.name, g.starts_at,
         home.name, away.name, l.name, l.address, l.city, l.state,
         league.name, level.name, g.notes, a.status, a.published_at,
         a.accept_by, a.responded_at, a.decline_reason, a.response_token
    from public.assignments a
    join public.officials o on o.id=a.official_id
    join public.games g on g.id=a.game_id
    left join public.teams home on home.id=g.home_team_id
    left join public.teams away on away.id=g.away_team_id
    left join public.locations l on l.id=g.location_id
    left join public.leagues league on league.id=g.league_id
    left join public.levels level on level.id=g.level_id
    left join public.sport_positions position on position.id=a.position_id
   where o.auth_user_id=auth.uid() and a.published_at is not null
   order by g.starts_at;
$$;

revoke all on function public.publish_game_assignments(uuid) from public, anon;
grant execute on function public.publish_game_assignments(uuid) to authenticated;
revoke all on function public.get_assignment_by_token(uuid) from public;
grant execute on function public.get_assignment_by_token(uuid) to anon, authenticated;
revoke all on function public.respond_to_assignment(uuid,text,text) from public;
grant execute on function public.respond_to_assignment(uuid,text,text) to anon, authenticated;
revoke all on function public.my_official_assignments() from public, anon;
grant execute on function public.my_official_assignments() to authenticated;

notify pgrst, 'reload schema';
