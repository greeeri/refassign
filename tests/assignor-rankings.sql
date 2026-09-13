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

select set_config('request.jwt.claim.sub',actor_a::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_a,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select public.set_my_official_rankings(official_a,9,9,9,9,9,9),
       public.set_my_official_rankings(official_b,2,2,2,2,2,2),
       public.set_my_team_power(team_a,9), public.set_my_team_power(team_b,1) from rank_fixture;
select pg_temp.assert_true(not exists(select 1 from public.assignor_official_rankings where assignor_id<>auth.uid()),'Actor A read another assignor official rating');
select pg_temp.assert_true(not exists(select 1 from public.assignor_team_power_rankings where assignor_id<>auth.uid()),'Actor A read another assignor team rating');
reset role;

select set_config('request.jwt.claim.sub',actor_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.assignor_official_rankings r join rank_fixture f on r.official_id=f.official_a),'New assignor inherited another assignor rating');
select public.set_my_official_rankings(official_a,3,3,3,3,3,3),
       public.set_my_official_rankings(official_b,8,8,8,8,8,8),
       public.set_my_team_power(team_a,1), public.set_my_team_power(team_b,9) from rank_fixture;
with changed as (update public.assignor_official_rankings r set rank=1 from rank_fixture f where r.assignor_id=f.actor_a returning r.*)
select pg_temp.assert_true(count(*)=0,'Cross-assignor update succeeded') from changed;
with removed as (delete from public.assignor_team_power_rankings r using rank_fixture f where r.assignor_id=f.actor_a returning r.*)
select pg_temp.assert_true(count(*)=0,'Cross-assignor delete succeeded') from removed;
do $$ declare f record; begin
  select * into f from rank_fixture;
  begin
    insert into public.assignor_official_rankings(assignor_id,official_id,rank) values(f.actor_a,f.official_a,1)
    on conflict(assignor_id,official_id) do update set rank=1;
    raise exception 'Cross-assignor upsert succeeded';
  exception when insufficient_privilege then null; end;
  begin
    update public.assignor_team_power_rankings set assignor_id=f.actor_a where assignor_id=f.actor_b and team_id=f.team_a;
    raise exception 'Ownership transfer succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_my_team_power(f.team_a,11);
    raise exception 'Out of range power accepted';
  exception when raise_exception then
    if sqlerrm='Out of range power accepted' then raise; end if;
  end;
end $$;
reset role;

-- Actor A's ratings remain unchanged after B's writes and attempted spoofing.
select pg_temp.assert_true((select r.rank=9 from public.assignor_official_rankings r,rank_fixture f where r.assignor_id=f.actor_a and r.official_id=f.official_a),'Actor A official rank changed');
select pg_temp.assert_true((select r.power=9 from public.assignor_team_power_rankings r,rank_fixture f where r.assignor_id=f.actor_a and r.team_id=f.team_a),'Actor A team power changed');
select set_config('request.jwt.claim.sub',actor_a::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_a,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select public.upsert_my_official_roster_row(org,official_a::text,'RankingTest','One',null,null,null,null,null,null,
  array['Soccer'],null,true,7,6,5,4,array[league],array[level]) from rank_fixture;
select pg_temp.assert_true((select r.ref_rank=7 and r.rank=9 from public.assignor_official_rankings r,rank_fixture f where r.official_id=f.official_a),'Shared official import did not save personal position ranks or changed general rank');
select public.set_my_official_rankings(official_a,9,9,9,9,9,9) from rank_fixture;
select public.run_my_auto_assign(org,'2099-01-15','2099-01-15',1) from rank_fixture;
select pg_temp.assert_true((select exists(select 1 from public.assignments a where a.game_id=f.game_a and a.official_id=f.official_a) from rank_fixture f),'AutoAssign did not use actor A team priority and official rank');
reset role;
delete from public.assignments a using rank_fixture f where a.game_id in (f.game_a,f.game_b);

select set_config('request.jwt.claim.sub',actor_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor_b,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select pg_temp.assert_true((select r.ref_rank=3 from public.assignor_official_rankings r,rank_fixture f where r.official_id=f.official_a),'Actor A import changed actor B rating');
select public.run_my_auto_assign(org,'2099-01-15','2099-01-15',1) from rank_fixture;
select pg_temp.assert_true((select exists(select 1 from public.assignments a where a.game_id=f.game_b and a.official_id=f.official_b) from rank_fixture f),'AutoAssign did not use actor B team priority and official rank');
reset role;

select pg_temp.assert_true(not has_table_privilege('anon','public.assignor_official_rankings','SELECT'),'Anonymous official rating access');
select pg_temp.assert_true(not has_table_privilege('anon','public.assignor_team_power_rankings','SELECT'),'Anonymous team rating access');
select set_config('request.jwt.claim.sub',outsider::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from rank_fixture;
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from public.assignor_official_rankings),'Outsider can read official ratings');
select pg_temp.assert_true(not exists(select 1 from public.assignor_team_power_rankings),'Outsider can read team ratings');
reset role;
select 'PASS: seed preservation, private CRUD, spoof protection, shared import, both AutoAssign actors, anonymous and outsider isolation' as result;
rollback;
