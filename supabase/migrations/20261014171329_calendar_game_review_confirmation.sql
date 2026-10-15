alter table public.games
  add column if not exists calendar_needs_review boolean not null default false,
  add column if not exists calendar_reviewed_at timestamptz,
  add column if not exists calendar_reviewed_by uuid references auth.users(id) on delete set null;

create or replace function public.mark_new_calendar_game_for_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_system in ('gobound','ical','calendar') then
    if tg_op = 'INSERT' then
      new.calendar_needs_review := true;
      new.calendar_reviewed_at := null;
      new.calendar_reviewed_by := null;
    elsif old.source_system is distinct from new.source_system then
      new.calendar_needs_review := true;
      new.calendar_reviewed_at := null;
      new.calendar_reviewed_by := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger games_mark_new_calendar_review
before insert or update of source_system on public.games
for each row execute function public.mark_new_calendar_game_for_review();

update public.games set calendar_needs_review=true
where source_system in ('gobound','ical','calendar') and calendar_reviewed_at is null;

create or replace function public.confirm_calendar_game_review(p_game_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_reviewed integer;
  v_confirmed_ids uuid[];
begin
  if v_user_id is null then raise exception 'Sign in to confirm calendar game review.' using errcode='42501'; end if;
  if coalesce(cardinality(p_game_ids),0)=0 then raise exception 'Select at least one calendar game to review.'; end if;
  -- Authorize the entire selection before changing any row, including cross-league selections.
  if exists (
    select 1 from (select distinct unnest(p_game_ids) id) requested
    left join public.games g on g.id=requested.id
    where g.id is null or not coalesce(private.can_manage_organization_league(g.organization_id,g.league_id,v_user_id),false)
  ) then
    raise exception 'You cannot confirm review for one or more selected games.' using errcode='42501';
  end if;
  update public.games
  set calendar_needs_review=false,calendar_reviewed_at=now(),calendar_reviewed_by=v_user_id
  where id=any(p_game_ids) and calendar_needs_review and source_system in ('gobound','ical','calendar');
  get diagnostics v_reviewed = row_count;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_confirmed_ids from public.games
  where id=any(p_game_ids) and not calendar_needs_review and calendar_reviewed_at is not null;
  return jsonb_build_object('reviewed',v_reviewed,'confirmed_ids',v_confirmed_ids);
end;
$$;

revoke all on function public.confirm_calendar_game_review(uuid[]) from public,anon;
grant execute on function public.confirm_calendar_game_review(uuid[]) to authenticated;
