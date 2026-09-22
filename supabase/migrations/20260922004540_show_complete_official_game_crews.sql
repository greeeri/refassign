create or replace function public.get_my_game_crew(p_game_id uuid)
returns table (
  position_id uuid,
  "position" text,
  sort_order integer,
  assignment_id uuid,
  name text,
  phone text,
  email text,
  profile_picture_url text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with accessible_game as (
    select game.id, game.sport_id, game.officials_needed
    from public.games game
    where game.id = p_game_id
      and (select auth.uid()) is not null
      and exists (
        select 1
        from public.assignments my_assignment
        join public.officials me on me.id = my_assignment.official_id
        where my_assignment.game_id = game.id
          and me.auth_user_id = (select auth.uid())
          and my_assignment.published_at is not null
          and lower(my_assignment.status) not in ('declined', 'cancelled')
      )
  ), crew_positions as (
    select sport_position.id, sport_position.name, sport_position.sort_order
    from accessible_game game
    join public.sport_positions sport_position
      on sport_position.sport_id = game.sport_id
     and sport_position.sort_order <= game.officials_needed
    union
    select sport_position.id, sport_position.name, sport_position.sort_order
    from accessible_game game
    join public.assignments assignment on assignment.game_id = game.id
    join public.sport_positions sport_position on sport_position.id = assignment.position_id
    where assignment.published_at is not null
      and lower(assignment.status) not in ('declined', 'cancelled')
  )
  select crew_position.id,
    crew_position.name,
    crew_position.sort_order,
    assignment.id,
    official.full_name,
    coalesce(nullif(official.mobile_phone, ''), official.phone),
    official.email,
    official.profile_picture_url,
    coalesce(assignment.status, 'open')
  from crew_positions crew_position
  left join public.assignments assignment
    on assignment.game_id = p_game_id
   and assignment.position_id = crew_position.id
   and assignment.published_at is not null
   and lower(assignment.status) not in ('declined', 'cancelled')
  left join public.officials official on official.id = assignment.official_id
  order by crew_position.sort_order, official.full_name;
$$;

revoke all on function public.get_my_game_crew(uuid) from public, anon;
grant execute on function public.get_my_game_crew(uuid) to authenticated;

notify pgrst, 'reload schema';
