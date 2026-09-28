-- Reuse the existing per-game authorization and crew presentation in one request.
create function public.get_my_game_crews(p_game_ids uuid[])
returns table (
  game_id uuid,
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
language sql stable security invoker set search_path = '' as $$
  select requested.game_id, crew.position_id, crew."position", crew.sort_order,
         crew.assignment_id, crew.name, crew.phone, crew.email,
         crew.profile_picture_url, crew.status
  from (select distinct id as game_id from unnest(p_game_ids) as id) requested
  cross join lateral public.get_my_game_crew(requested.game_id) crew
  where cardinality(p_game_ids) <= 100
  order by requested.game_id, crew.sort_order, crew.name;
$$;

revoke all on function public.get_my_game_crews(uuid[]) from public, anon;
grant execute on function public.get_my_game_crews(uuid[]) to authenticated;

notify pgrst, 'reload schema';
