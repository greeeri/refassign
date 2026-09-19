-- The browser calls the public wrapper. It must be able to enter the private
-- implementation without requiring the caller to have privileges in the
-- private schema. Authentication is still enforced inside the implementation
-- with auth.uid().
create or replace function public.claim_league_connection_link(p_token uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.claim_league_connection_link_impl(p_token)
$$;

revoke all on function public.claim_league_connection_link(uuid) from public, anon;
grant execute on function public.claim_league_connection_link(uuid) to authenticated;

-- Only the public wrapper should be callable by application users.
revoke all on function private.claim_league_connection_link_impl(uuid)
  from public, anon, authenticated;
