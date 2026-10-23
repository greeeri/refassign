const fs = require('node:fs');
const path = require('node:path');
const { fixture, I, id, asUser, functionSQL } = require('./league-security-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const repairName = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_global_game_resource_conflicts.sql'));
const repair = read(repairName);
async function resourceFixture(connection, fixed = true) {
  const db = await fixture(connection);
  try {
    await db.exec(`
      alter table public.games add column game_number text, add column time_tbd boolean default false, add column field_tbd boolean default false;
      alter table public.teams add column source_system text, add column source_team_id text;
      alter table public.assignments add column status_before_cancellation text, add column cancellation_notified_at timestamptz,
        add column cancellation_email_id text, add column cancellation_email_error text,
        add column responded_at timestamptz, add column game_fee numeric default 75, add column response_token uuid, add column decline_reason text;
      create table public.assignment_self_assign_slots(game_id uuid,status text);
      update public.games set starts_at='2028-01-01 00:00Z';
      update public.games set starts_at='2027-04-01 18:00Z',location_id='${I.locationA}',game_number='SECRET-LEAGUE-B' where id='${I.gameB}';
      update public.games set starts_at='2027-04-01 20:00Z',game_number='VISIBLE-A' where id='${I.gameA}';
    `);
    await db.exec(read('20261014161527_venue_conflict_hold_activation_guard.sql'));
    await db.exec(functionSQL(read('20261022195617_scope_administrators_to_selected_leagues.sql'), 'public.set_game_status'));
    if (fixed) await db.exec(repair);
    return db;
  } catch (error) { await db.close(); throw error; }
}
module.exports = { resourceFixture, I, id, asUser, read, repair };
