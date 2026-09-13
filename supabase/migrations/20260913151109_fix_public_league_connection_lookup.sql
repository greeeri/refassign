-- The public landing page needs a deliberately narrow bearer-token lookup.
-- Keep anon out of the private schema and elevate only this safe wrapper.
create or replace function public.get_league_connection_link(p_token uuid)
returns table (
  organization_name text,
  league_name text,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.get_league_connection_link_impl(p_token)
$$;

revoke all on function private.get_league_connection_link_impl(uuid) from public, anon, authenticated;
revoke all on function public.get_league_connection_link(uuid) from public;
grant execute on function public.get_league_connection_link(uuid) to anon, authenticated;

create index if not exists league_official_connection_links_league_idx
  on public.league_official_connection_links(league_id);
create index if not exists league_official_connection_links_created_by_idx
  on public.league_official_connection_links(created_by);
