// Executes the real authorization predicates and restrictive policies in an
// isolated PostgreSQL-compatible database. No production connection is used.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261022195617_scope_administrators_to_selected_leagues.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const I = Object.fromEntries([
  'org', 'otherOrg', 'a', 'b', 'c', 'admin', 'mixed', 'empty', 'owner',
  'superadmin', 'stranger', 'viewer', 'locationA', 'locationB', 'locationC',
  'teamA', 'teamB', 'levelA', 'levelB', 'officialA', 'officialB', 'ownOfficial',
  'gameA', 'gameB', 'gameOwnB', 'gameOther', 'assignmentA', 'assignmentB', 'assignmentOwnB',
].map((name, i) => [name, id(i + 1)]));

function functionSQL(source, name, required = true) {
  const escaped = name.replaceAll('.', '\\.');
  // The migration may refine a compatibility helper again later in the file.
  const start = [...source.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\(`, 'ig'))].at(-1);
  if (!start) {
    if (required) throw new Error(`Missing authorization function ${name}`);
    return null;
  }
  const text = source.slice(start.index);
  const body = /\bas\s+(\$[a-z_]*\$)/i.exec(text);
  assert.ok(body, `Cannot locate body for ${name}`);
  const end = text.indexOf(body[1], body.index + body[0].length);
  assert.ok(end >= 0, `Unterminated body for ${name}`);
  return text.slice(0, end + body[1].length) + ';';
}

async function fixture(db = new PGlite()) {
  try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.organizations(id uuid primary key, operational boolean default true);
    create table public.protected_accounts(user_id uuid primary key);
    create table public.profiles(id uuid primary key,role text,active boolean default true);
    create table public.user_roles(user_id uuid,role text);
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text,primary key(organization_id,user_id,role));
    create table public.organization_member_league_access(organization_id uuid,user_id uuid,league_id uuid,
      all_locations boolean not null default true,location_ids uuid[] not null default '{}',primary key(organization_id,user_id,league_id));
    create table public.organization_user_access_profiles(organization_id uuid,user_id uuid,roles text[],league_ids uuid[],primary key(organization_id,user_id));
    create table public.organization_league_coverage(organization_id uuid,league_id uuid,active boolean default true,primary key(organization_id,league_id));
    create table public.leagues(id uuid primary key,name text,active boolean default true);
    create table public.teams(id uuid primary key,name text,sport_id uuid,level_id uuid,active boolean default true);
    create table public.levels(id uuid primary key,name text,active boolean default true);
    create table public.locations(id uuid primary key,name text,active boolean default true);
    create table public.officials(id uuid primary key,auth_user_id uuid,active boolean default true);
    create table public.organization_officials(organization_id uuid,official_id uuid,active boolean default true);
    create table public.organization_teams(organization_id uuid,team_id uuid,active boolean default true);
    create table public.organization_levels(organization_id uuid,level_id uuid,active boolean default true);
    create table public.organization_locations(organization_id uuid,location_id uuid,active boolean default true,field_complex text,primary key(organization_id,location_id));
    create table public.official_league_eligibility(official_id uuid,league_id uuid);
    create table public.official_level_eligibility(official_id uuid,level_id uuid);
    create table public.team_power_rankings(team_id uuid);
    create table public.official_availability_blocks(official_id uuid);
    create table public.block_removal_requests(official_id uuid);
    create table public.auto_assign_rules(organization_id uuid);
    create table public.import_error_log(organization_id uuid);
    create table public.audit_history(organization_id uuid,game_id uuid);
    create table public.league_staff_access(user_id uuid,league_id uuid);
    create table private.organization_league_team_settings(organization_id uuid,league_id uuid,team_ids uuid[],primary key(organization_id,league_id));
    create table private.organization_league_level_settings(organization_id uuid,league_id uuid,level_ids uuid[],primary key(organization_id,league_id));
    create table public.games(id uuid primary key,organization_id uuid,league_id uuid,location_id uuid,home_team_id uuid,away_team_id uuid,level_id uuid,notes text);
    create table public.assignments(id uuid primary key,game_id uuid,official_id uuid);
    create table public.game_crew_messages(id uuid primary key,game_id uuid,official_id uuid,message text,created_at timestamptz);
    create table public.game_link_groups(id uuid primary key,organization_id uuid,created_by uuid);
    create table public.game_link_members(group_id uuid,game_id uuid);
    create table public.payroll_batches(id uuid primary key,organization_id uuid,league_id uuid);
    create table public.payroll_batch_items(id uuid primary key,payroll_batch_id uuid,game_id uuid,official_id uuid);
    create table public.payroll_transfers(id uuid primary key,payroll_batch_id uuid,official_id uuid);
    create table public.payment_transactions(id uuid primary key,organization_id uuid,related_record_id uuid);
    create table public.payment_audit_events(id uuid primary key,organization_id uuid,payroll_batch_id uuid);
    create table public.league_payment_settings(id uuid primary key,organization_id uuid,league_id uuid);
    create table public.transaction_fee_rules(id uuid primary key,organization_id uuid,league_id uuid);
    create table public.league_assignment_templates(id uuid primary key,coverage_id uuid);
    create table public.league_assignment_template_positions(id uuid primary key,template_id uuid);
    create table public.official_rankings(id uuid primary key,official_id uuid,rank numeric);
    create table public.bill_to_accounts(id uuid primary key,organization_id uuid);
    create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.protected_accounts where user_id=auth.uid()) $$;
    create function private.organization_has_operational_access(uuid) returns boolean language sql stable security definer set search_path='' as $$
      select coalesce((select operational from public.organizations where id=$1),false) $$;
    create function private.can_access_organization(uuid) returns boolean language sql stable security definer set search_path='' as $$
      select auth.uid() is not null and (public.is_super_admin() or (private.organization_has_operational_access($1)
      and exists(select 1 from public.organization_memberships where organization_id=$1 and user_id=auth.uid()))) $$;
    insert into public.organizations values('${I.org}',true),('${I.otherOrg}',true);
    insert into public.protected_accounts values('${I.superadmin}');
    insert into public.profiles values('${I.admin}','admin',true),('${I.mixed}','admin',true),('${I.owner}','admin',true);
    insert into public.user_roles values('${I.admin}','admin'),('${I.mixed}','admin'),('${I.mixed}','assignor'),('${I.owner}','admin');
    insert into public.organization_memberships values
      ('${I.org}','${I.admin}','admin'),('${I.org}','${I.empty}','admin'),
      ('${I.org}','${I.mixed}','admin'),('${I.org}','${I.mixed}','assignor'),('${I.org}','${I.mixed}','billing'),('${I.org}','${I.mixed}','mentor'),
      ('${I.org}','${I.owner}','admin'),('${I.org}','${I.owner}','assignor'),('${I.org}','${I.owner}','owner'),('${I.org}','${I.viewer}','viewer');
    insert into public.organization_league_coverage values('${I.org}','${I.a}',true),('${I.org}','${I.b}',true),('${I.otherOrg}','${I.c}',true);
    insert into public.organization_member_league_access(organization_id,user_id,league_id) values
      ('${I.org}','${I.admin}','${I.a}'),('${I.org}','${I.mixed}','${I.a}'),('${I.org}','${I.viewer}','${I.a}');
    -- Stale profiles deliberately advertise authority that memberships do not.
    insert into public.organization_user_access_profiles values
      ('${I.org}','${I.admin}',array['admin'],array['${I.a}'::uuid,'${I.b}'::uuid]),
      ('${I.org}','${I.empty}',array['admin'],array['${I.a}'::uuid,'${I.b}'::uuid]),
      ('${I.org}','${I.stranger}',array['admin'],array['${I.a}'::uuid,'${I.b}'::uuid]);
    insert into public.leagues values('${I.a}','A',true),('${I.b}','B',true),('${I.c}','C',true);
    insert into public.teams(id,name) values('${I.teamA}','A'),('${I.teamB}','B');
    insert into public.levels(id,name) values('${I.levelA}','A'),('${I.levelB}','B');
    insert into public.locations(id,name) values('${I.locationA}','A'),('${I.locationB}','B'),('${I.locationC}','C');
    insert into public.officials values('${I.officialA}',null,true),('${I.officialB}',null,true),('${I.ownOfficial}','${I.mixed}',true);
    insert into public.organization_officials values('${I.org}','${I.officialA}',true),('${I.org}','${I.officialB}',true),('${I.org}','${I.ownOfficial}',true);
    insert into public.organization_teams values('${I.org}','${I.teamA}',true),('${I.org}','${I.teamB}',true);
    insert into public.organization_levels values('${I.org}','${I.levelA}',true),('${I.org}','${I.levelB}',true);
    insert into public.organization_locations values('${I.org}','${I.locationA}',true,'same complex'),('${I.org}','${I.locationB}',true,'same complex'),('${I.org}','${I.locationC}',true,null);
    insert into public.official_league_eligibility values('${I.officialA}','${I.a}'),('${I.officialB}','${I.b}');
    insert into private.organization_league_team_settings values('${I.org}','${I.a}',array['${I.teamA}'::uuid]),('${I.org}','${I.b}',array['${I.teamB}'::uuid]);
    insert into private.organization_league_level_settings values('${I.org}','${I.a}',array['${I.levelA}'::uuid]),('${I.org}','${I.b}',array['${I.levelB}'::uuid]);
    insert into public.games values
      ('${I.gameA}','${I.org}','${I.a}','${I.locationA}','${I.teamA}',null,'${I.levelA}',null),
      ('${I.gameB}','${I.org}','${I.b}','${I.locationB}','${I.teamB}',null,'${I.levelB}',null),
      ('${I.gameOwnB}','${I.org}','${I.b}','${I.locationB}','${I.teamB}',null,'${I.levelB}',null),
      ('${I.gameOther}','${I.otherOrg}','${I.c}','${I.locationC}',null,null,null,null);
    insert into public.assignments values('${I.assignmentA}','${I.gameA}','${I.officialA}'),('${I.assignmentB}','${I.gameB}','${I.officialB}'),('${I.assignmentOwnB}','${I.gameOwnB}','${I.ownOfficial}');
    alter table public.assignments add column status text default 'accepted',add column published_at timestamptz,add column accept_by timestamptz,
      add column overdue_reviewed_at timestamptz,add column overdue_reviewed_by uuid,add column overdue_review_action text;
    alter table public.games add column starts_at timestamptz default now()+interval '2 days',add column duration_minutes integer default 90,add column status text default 'active',add column bill_to_id uuid;
    alter table public.officials add column first_name text,add column last_name text,add column full_name text,add column profile_picture_url text;
    alter table public.organization_league_coverage add column id uuid;
    update public.organization_league_coverage set id=league_id;
    grant usage on schema public,private,auth to authenticated,anon,service_role;
    grant select,insert,update,delete on all tables in schema public to authenticated;
  `);

  const names = [
    'private.is_organization_owner_or_admin', 'private.can_manage_organization',
    'private.can_access_organization_league', 'private.can_manage_organization_league',
    'private.can_manage_organization_league_settings', 'private.organization_accessible_league_ids',
    'private.can_manage_any_organization_league',
  ];
  for (const name of names) await db.exec(functionSQL(migration, name));
  for (const name of ['private.can_access_organization_league_location','private.can_manage_organization_league_location']) {
    const sql = functionSQL(migration,name,false);
    if (sql) await db.exec(sql);
  }
  for (const name of ['private.can_read_organization_team','private.can_read_organization_level','private.can_read_organization_location','private.can_read_organization_official','private.can_read_scoped_resource','private.can_manage_shared_resource','private.can_rank_official','private.can_rank_team']) {
    await db.exec(functionSQL(migration,name));
  }
  const baseline = fs.readFileSync(path.join(root,'supabase/migrations/20260908013252_isolate_operational_workspace_by_league.sql'),'utf8');
  await db.exec(functionSQL(migration,'private.can_read_organization_game',false) || functionSQL(baseline,'private.can_read_organization_game'));
  const operations = fs.readFileSync(path.join(root,'supabase/migrations/20260909123000_enforce_organization_write_boundaries.sql'),'utf8');
  await db.exec(functionSQL(migration,'private.can_manage_game',false) || functionSQL(operations,'private.can_manage_game'));
  await db.exec(`
    do $$ declare t record; begin
      for t in select tablename from pg_tables where schemaname='public' and tablename not in('organizations','protected_accounts','games','assignments') loop
        execute format('alter table public.%I enable row level security',t.tablename);
        -- Simulate a surviving legacy profiles.role policy: permissive TRUE must
        -- never defeat the new restrictive fences.
        execute format('create policy legacy_permissive on public.%I for all to authenticated using(true) with check(true)',t.tablename);
      end loop;
    end $$;
  `);
  // Install the actual pre-existing policies, including personal official reads.
  await db.exec(baseline.slice(baseline.indexOf('alter table public.games enable row level security;'),baseline.indexOf('revoke all on function private.is_organization_owner_or_admin')));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260921162000_allow_officials_to_read_own_assignment_games.sql'),'utf8'));
  const policies = /do \$policies\$[\s\S]*?end \$policies\$;/.exec(migration);
  assert.ok(policies,'The migration must include restrictive policy fences');
  await db.exec(policies[0]);
  for(const policy of migration.match(/create policy "Location scope [\s\S]*?;/g) || []) await db.exec(policy);
  await db.exec(functionSQL(migration,'private.get_game_directory_impl'));
  await db.exec(`
    create table auth.users(id uuid primary key,email text);
    insert into auth.users values('${I.admin}','admin@example.invalid'),('${I.owner}','owner@example.invalid');
    alter table public.organization_memberships add column viewer_permissions text[] default '{}';
    alter table public.organization_user_access_profiles add column viewer_permissions text[] default '{}',add column updated_by uuid,add column updated_at timestamptz;
    alter table public.organization_member_league_access alter column all_locations set default false;
    alter table public.league_staff_access add column role text;
  `);
  const grantsBaseline = fs.readFileSync(path.join(root,'supabase/migrations/20260908022159_connect_organization_to_operational_workspace.sql'),'utf8');
  const permissionsBaseline = fs.readFileSync(path.join(root,'supabase/migrations/20260906154005_manage_organization_team_access.sql'),'utf8');
  await db.exec(functionSQL(grantsBaseline,'private.valid_organization_league_ids'));
  await db.exec(functionSQL(permissionsBaseline,'private.valid_viewer_permissions'));
  for(const name of ['private.normalize_league_location_access','private.apply_user_league_location_access','private.sync_organization_user_roles','public.set_organization_user_roles']) await db.exec(functionSQL(migration,name));
  for(const name of [
    'public.get_game_crew_chat','public.can_access_game_report','public.resolve_overdue_assignments',
    'private.upsert_my_official_roster_row','private.upsert_my_referee_profile_row',
    'private.can_access_link_group','private.require_linked_game_scope','public.assign_official_to_linked_games',
    'private.can_read_scoped_payroll_batch','private.can_access_coverage_template','private.can_access_coverage_template_position',
    'private.validate_scoped_game_references','public.can_manage_rank',
    'private.save_organization_league_teams_impl','private.save_organization_league_levels_impl','private.validate_scoped_assignment_reference',
  ]) await db.exec(functionSQL(migration,name));
  for(const policy of migration.match(/create policy "(?:Payroll|Payment) scope [\s\S]*?;/g) || []) await db.exec(policy);
  const coveragePolicies=/do \$coverage_template_fences\$[\s\S]*?end \$coverage_template_fences\$;/.exec(migration);
  assert.ok(coveragePolicies,'Coverage templates need canonical-scope fences');
  await db.exec(coveragePolicies[0]);
  await db.exec('create trigger validate_scoped_game_references before insert or update on public.games for each row execute function private.validate_scoped_game_references()');
  await db.exec('create trigger validate_scoped_assignment_reference before insert or update of game_id,official_id on public.assignments for each row execute function private.validate_scoped_assignment_reference()');
  for(const policy of migration.match(/create policy "(?:Legacy rating scope|Scoped users read legacy ratings|Owners manage legacy ratings)[\s\S]*?;/g) || []) await db.exec(policy);
  await db.exec(/create policy "League scope read fence" on public\.bill_to_accounts[\s\S]*?;/.exec(migration)[0]);
  return db;
  } catch(error) { await db.close(); throw error; }
}

async function asUser(db,user,fn,setup='') {
  await db.exec('begin');
  try {
    if(setup) await db.exec(setup);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user || '']);
    await db.exec('set local role authenticated');
    return await fn();
  } finally { await db.exec('rollback'); }
}
const value = async (db,sql,args=[]) => (await db.query(sql,args)).rows[0].value;
const ids = async (db,table) => (await db.query(`select id from public.${table} order by id`)).rows.map(r=>r.id);
async function denied(db,sql,args=[],pattern=/row-level security|permission denied|not authorized|only organization owner|outside your access/i) {
  await db.exec('savepoint denied_action');
  try { await assert.rejects(db.query(sql,args),pattern); }
  finally { await db.exec('rollback to savepoint denied_action; release savepoint denied_action'); }
}


module.exports = { fixture, I, id, asUser, value, ids, denied, functionSQL };
