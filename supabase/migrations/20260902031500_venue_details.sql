alter table public.locations
  add column if not exists directions text,
  add column if not exists parking_instructions text,
  add column if not exists entrance_information text,
  add column if not exists map_url text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

create or replace function public.get_my_venue_details(p_game_id uuid)
returns table (
  location_name text,
  address text,
  city text,
  state text,
  directions text,
  parking_instructions text,
  entrance_information text,
  map_url text,
  contact_name text,
  contact_phone text,
  contact_email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select location.name, location.address, location.city, location.state,
    location.directions, location.parking_instructions, location.entrance_information,
    location.map_url, location.contact_name, location.contact_phone, location.contact_email
  from public.games game
  join public.locations location on location.id = game.location_id
  where game.id = p_game_id
    and exists (
      select 1
      from public.assignments assignment
      join public.officials official on official.id = assignment.official_id
      where assignment.game_id = game.id
        and assignment.published_at is not null
        and official.auth_user_id = (select auth.uid())
    );
$$;

revoke all on function public.get_my_venue_details(uuid) from public, anon;
grant execute on function public.get_my_venue_details(uuid) to authenticated;
