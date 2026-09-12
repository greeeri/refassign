-- Apply the migration inside the same BEGIN/ROLLBACK transaction before this script.
create function pg_temp.check_cc(ok boolean,msg text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception '%',msg;end if;end$$;
create temp table cc_fixture as select m.organization_id org,m.user_id actor,gen_random_uuid() child,gen_random_uuid() adult,gen_random_uuid() outsider,gen_random_uuid() self_user from public.organization_memberships m where m.role in('owner','admin','assignor') and private.organization_has_operational_access(m.organization_id) limit 1;
grant select on cc_fixture to authenticated;
select pg_temp.check_cc((select count(*)=1 from cc_fixture),'Missing test manager');
insert into public.officials(id,first_name,last_name,active) select child,'CC Test','Child',true from cc_fixture union all select adult,'CC Test','Adult',true from cc_fixture;
insert into public.organization_officials(organization_id,official_id,active) select org,child,true from cc_fixture union all select org,adult,true from cc_fixture;
select set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from cc_fixture;
set local role authenticated;
-- Age 13 is optional; age 12 is mandatory, with no destructive deletion escape.
select public.save_official_cc_contact(adult,(current_date-interval '13 years')::date,'',null,null) from cc_fixture;
do $$declare id uuid; begin select child into id from cc_fixture; begin perform public.save_official_cc_contact(id,(current_date-interval '12 years')::date,'',null,null);raise exception 'Under-13 missing contact accepted';exception when raise_exception then if sqlerrm not like 'A CC contact%' then raise;end if;end;end$$;
select public.save_official_cc_contact(child,(current_date-interval '12 years')::date,'Parent','parent@example.com','+15155551212') from cc_fixture;
select pg_temp.check_cc((select name='Parent' from public.official_cc_contacts where official_id=(select child from cc_fixture)),'Manager cannot read saved contact');
do $$declare id uuid; begin select child into id from cc_fixture;
 begin perform public.save_official_cc_contact(id,null,'',null,null);raise exception 'Under-13 DOB cleared';exception when raise_exception then if sqlerrm not like 'A recorded under-13%' then raise;end if;end;
 begin delete from public.official_cc_contacts where official_id=id;raise exception 'Direct delete allowed';exception when insufficient_privilege then null;end;
 begin update public.official_cc_contacts set name='' where official_id=id;raise exception 'Direct update allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Registration automatically supplies the signed parent contact.
insert into public.official_registrations(official_id,first_name,last_name,email,date_of_birth,parent_name,parent_email,parent_consent_status)
select child,'CC Test','Child',child::text||'@example.com',(current_date-interval '12 years')::date,'Parent','parent@example.com','signed' from cc_fixture;
select pg_temp.check_cc((select name='Parent' and email='parent@example.com' from public.official_cc_contacts where official_id=(select child from cc_fixture)),'Registration failed to keep parent CC');
-- A newly linked under-13 registration creates its CC, without prior contact data.
insert into public.official_registrations(official_id,first_name,last_name,email,date_of_birth,parent_name,parent_email,parent_consent_status)
select adult,'CC Test','New Child',adult::text||'@example.com',(current_date-interval '11 years')::date,'New Parent','new-parent@example.com','signed' from cc_fixture;
select pg_temp.check_cc((select name='New Parent' and email='new-parent@example.com' from public.official_cc_contacts where official_id=(select adult from cc_fixture)),'New registration failed to populate parent CC');
-- The referee can read/save their own contact even without manager permissions.
insert into auth.users(id,email) select self_user,self_user::text||'@example.com' from cc_fixture;
update public.officials set auth_user_id=(select self_user from cc_fixture) where id=(select child from cc_fixture);
update public.organization_officials set active=false where official_id=(select child from cc_fixture);
select set_config('request.jwt.claim.sub',self_user::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',self_user,'role','authenticated')::text,true) from cc_fixture;
set local role authenticated;
select public.save_official_cc_contact(child,(current_date-interval '12 years')::date,'Updated Parent','updated-parent@example.com',null) from cc_fixture;
select pg_temp.check_cc((select name='Updated Parent' from public.official_cc_contacts where official_id=(select child from cc_fixture)),'Self-service save failed');
reset role;
-- Simulate an unrelated signed-in identity.
select set_config('request.jwt.claim.sub',outsider::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from cc_fixture;
set local role authenticated;
select pg_temp.check_cc(not exists(select 1 from public.official_cc_contacts),'Outsider saw contacts');
do $$begin begin perform public.save_official_cc_contact((select child from cc_fixture),null,'Bad','bad@example.com',null);raise exception 'Outsider saved contact';exception when raise_exception then if sqlerrm<>'Not authorized' then raise;end if;end;end$$;
reset role;
select pg_temp.check_cc(not has_table_privilege('anon','public.official_cc_contacts','SELECT'),'Anonymous contact access');
select pg_temp.check_cc(not has_function_privilege('anon','public.save_official_cc_contact(uuid,date,text,text,text)','EXECUTE'),'Anonymous save access');
select 'PASS: age boundary, mandatory child contact, CRUD restrictions, manager access, outsider denial, registration sync' as result;
