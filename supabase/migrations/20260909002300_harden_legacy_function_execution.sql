-- Internal authorization helpers are available only to signed-in callers.
revoke all on function public.can_manage_rank() from public,anon;
revoke all on function public.contact_can_view_game(uuid) from public,anon;
revoke all on function public.current_contact_id() from public,anon;
revoke all on function public.current_contact_type() from public,anon;
revoke all on function public.is_refassign_staff() from public,anon;
grant execute on function public.can_manage_rank() to authenticated;
grant execute on function public.contact_can_view_game(uuid) to authenticated;
grant execute on function public.current_contact_id() to authenticated;
grant execute on function public.current_contact_type() to authenticated;
grant execute on function public.is_refassign_staff() to authenticated;

-- Trigger functions execute through their triggers and must not be callable as
-- standalone Data API RPCs.
revoke all on function public.create_default_official_rank() from public,anon,authenticated;
revoke all on function public.create_default_soccer_position_ranks() from public,anon,authenticated;
revoke all on function public.create_default_team_power() from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.log_game_update() from public,anon,authenticated;
revoke all on function public.reset_assignments_after_game_update() from public,anon,authenticated;

-- Manager mutations require a signed-in user. Their function bodies retain the
-- existing authorization checks.
revoke all on function public.publish_game_assignments(uuid) from public,anon;
revoke all on function public.upsert_official_roster_row(text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) from public,anon;
grant execute on function public.publish_game_assignments(uuid) to authenticated;
grant execute on function public.upsert_official_roster_row(text,text,text,text,text,text,text,text,text,text[],text,boolean,numeric,numeric,numeric,numeric,uuid[],uuid[],text,text,text) to authenticated;

-- Pin legacy function lookup paths to prevent object-shadowing attacks.
alter function public.sync_official_full_name() set search_path='';
alter function public.haversine_miles(numeric,numeric,numeric,numeric) set search_path='';
