-- Rename the organization in place so every existing membership, league,
-- game, assignment, and development record remains connected.
update public.organizations
set name = 'Iowa Referee Committee'
where lower(trim(name)) = 'iowa soccer';
