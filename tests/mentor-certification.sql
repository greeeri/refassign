-- Run as postgres after the ranking migration. Every change is rolled back.
-- Requires an operational organization with two managers and a soccer game.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

create temporary table rank_fixture on commit drop as
select g.organization_id org, g.league_id league, g.level_id level, g.sport_id sport,
  g.location_id location, managers.ids[1] actor_a, managers.ids[2] actor_b,
  gen_random_uuid() official_a, gen_random_uuid() official_b,
  gen_random_uuid() team_a, gen_random_uuid() team_b,
  gen_random_uuid() game_a, gen_random_uuid() game_b, gen_random_uuid() outsider
from public.games g
join public.sports s on s.id=g.sport_id and lower(s.name)='soccer'
join lateral (
  select array_agg(distinct m.user_id order by m.user_id) ids
  from public.organization_memberships m where m.organization_id=g.organization_id
    and m.role in ('owner','admin','assignor')
) managers on cardinality(managers.ids)>=2
where private.organization_has_operational_access(g.organization_id) and g.league_id is not null
limit 1;
select pg_temp.assert_true((select count(*)=1 from rank_fixture),'Missing ranking test fixture');
grant select on rank_fixture to authenticated;

-- A one-time starting copy must match the legacy value, without a live fallback.
select pg_temp.assert_true(not exists (
  select 1 from public.assignor_official_rankings personal
  left join public.official_rankings legacy using(official_id)
  where personal.rank<>coalesce(legacy.rank,1)
),'Existing general rankings were not preserved');

insert into public.officials(id,first_name,last_name,sports,active)
select official_a,'RankingTest','One',array['Soccer'],true from rank_fixture
union all select official_b,'RankingTest','Two',array['Soccer'],true from rank_fixture;
insert into public.organization_officials(organization_id,official_id,active)
select org,official_a,true from rank_fixture union all select org,official_b,true from rank_fixture;
-- A shared official must still receive the importing assignor's personal ranks.
insert into public.organization_officials(organization_id,official_id,active)
select other.id,f.official_a,true from rank_fixture f
join lateral (select id from public.organizations where id<>f.org limit 1) other on true;
insert into public.teams(id,name,sport_id,level_id,active)
select team_a,'Ranking Test Team A',sport,level,true from rank_fixture
union all select team_b,'Ranking Test Team B',sport,level,true from rank_fixture;
insert into public.organization_teams(organization_id,team_id,active)
select org,team_a,true from rank_fixture union all select org,team_b,true from rank_fixture;
insert into public.organization_member_league_access(organization_id,user_id,league_id)
select org,actor_a,league from rank_fixture union all select org,actor_b,league from rank_fixture
on conflict do nothing;

-- Both games overlap, so the first game's priority consumes the top official.
insert into public.games(id,organization_id,league_id,level_id,sport_id,location_id,home_team_id,starts_at,officials_needed,status,game_number)
select game_a,org,league,level,sport,location,team_a,timestamptz '2099-01-15 18:00:00+00',1,'open','rank-a-'||game_a from rank_fixture
union all select game_b,org,league,level,sport,null::uuid,team_b,timestamptz '2099-01-15 18:00:00+00',1,'open','rank-b-'||game_b from rank_fixture;
-- Restrict candidates only inside this rolled-back transaction.
update public.organization_officials link set active=false from rank_fixture f
where link.organization_id=f.org and link.official_id not in (f.official_a,f.official_b);


-- Make Mentor the only position requested in each one-slot fixture game.
update public.sport_positions set sort_order=-10
where sport_id=(select sport from rank_fixture) and lower(name) like '%mentor%';
select pg_temp.assert_true(exists(select 1 from public.sport_positions where sport_id=(select sport from rank_fixture) and lower(name) like '%mentor%'),'Missing mentor position');
select set_config('request.jwt.claim.sub',actor_a::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_a,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select public.set_my_official_assessment(official_a,10,10,10,10,10,false),
       public.set_my_official_assessment(official_b,2,2,2,2,2,true),
       public.set_my_team_power(team_a,9),public.set_my_team_power(team_b,1) from rank_fixture;
select pg_temp.assert_true((select not r.mentor_certified from public.my_assignment_rankings r,rank_fixture f where r.official_id=f.official_a),'Unchecked official incorrectly certified');
select pg_temp.assert_true((select r.mentor_certified from public.my_assignment_rankings r,rank_fixture f where r.official_id=f.official_b),'Checked certification not saved');
reset role;
select set_config('request.jwt.claim.sub',actor_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select pg_temp.assert_true((select r.mentor_certified and r.rank=1 from public.my_assignment_rankings r,rank_fixture f where r.official_id=f.official_b),'Certification was not shared or another assignor ranking leaked');
-- Even the maximum legacy numeric mentor rank cannot certify an official.
select public.set_my_official_rankings(official_a,9,9,9,9,9,10) from rank_fixture;
select pg_temp.assert_true((select not r.mentor_certified from public.my_assignment_rankings r,rank_fixture f where r.official_id=f.official_a),'Numeric rank incorrectly grants certification');
reset role;
select set_config('request.jwt.claim.sub',actor_a::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_a,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select public.run_my_auto_assign(org,'2099-01-15','2099-01-15',1) from rank_fixture;
select pg_temp.assert_true((select exists(select 1 from public.assignments a where a.game_id=f.game_a and a.official_id=f.official_b) from rank_fixture f),'AutoAssign failed to prefer certified mentor over higher-ranked uncertified official');
select pg_temp.assert_true((select not exists(select 1 from public.assignments a where a.game_id=f.game_b) from rank_fixture f),'AutoAssign assigned uncertified mentor');
do $$ declare f record; p uuid; begin
  select * into f from rank_fixture;
  select id into p from public.sport_positions where sport_id=f.sport and lower(name) like '%mentor%' limit 1;
  begin
    insert into public.assignments(game_id,official_id,position_id,status) values(f.game_b,f.official_a,p,'proposed');
    raise exception 'Uncertified mentor assignment succeeded';
  exception when check_violation then
    if sqlerrm not like '%Mentor certification%' then raise; end if;
  end;
end $$;
select public.set_my_official_assessment(official_b,2,2,2,2,2,false) from rank_fixture;
-- Revoking certification does not break management of an existing assignment.
update public.assignments a set status='accepted' from rank_fixture f where a.game_id=f.game_a and a.official_id=f.official_b;
select pg_temp.assert_true((select exists(select 1 from public.assignments a where a.game_id=f.game_a and a.status='accepted') from rank_fixture f),'Existing mentor assignment could not be accepted after revocation');
reset role;
select set_config('request.jwt.claim.sub',actor_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select pg_temp.assert_true((select not r.mentor_certified from public.my_assignment_rankings r,rank_fixture f where r.official_id=f.official_b),'Unchecking did not update shared certification');
reset role;
select pg_temp.assert_true(not has_table_privilege('anon','public.official_mentor_certifications','SELECT'),'Anonymous certification access');
select 'PASS: checkbox persistence, shared certification/private rankings, numeric rank ignored, AutoAssign gating, direct assignment guard, revocation and existing assignments' result;
rollback;
