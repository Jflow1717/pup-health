// Database check-up. Loads supabase/schema.sql and private/seed.sql into
// a throwaway Postgres that runs on this computer (nothing goes online),
// pretends to be Supabase's login system, then checks the privacy rules,
// the safety nets, the dashboard numbers, and a backup -> restore round
// trip.
//
//   cd tests
//   npm install        (first time only)
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = process.argv[2];
const scratch = new URL('.', import.meta.url).pathname;
const schema = readFileSync(root + '/supabase/schema.sql', 'utf8');
const seed = readFileSync(root + '/private/seed.sql', 'utf8');
const TABLES = ['dogs', 'treatments', 'contacts', 'events', 'doses', 'weights', 'identifiers'];
const MEMBER = 'test-member@example.test';

const SUPABASE_STUBS = `
create schema auth;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), 'null')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated;
-- Supabase hands new tables to these roles by default; schema.sql must take that back.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(schema);
  await db.exec(`insert into public.household_members (email, display_name) values ('${MEMBER}', 'Tester');`);
  return db;
}

// Run fn as a given Supabase role, optionally "logged in" with an email.
async function as(db, role, email, fn) {
  const claims = email ? JSON.stringify({ email, role }) : '';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try { return await fn(); }
  finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
async function errorOf(fn) {
  try { await fn(); return null; } catch (e) { return e.message; }
}
const count = async (db, table) => (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n;

// Same shape as the app's JSON backup.
async function exportAll(db) {
  const tables = {};
  for (const t of TABLES) {
    const r = await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) as rows from public.${t} x`);
    tables[t] = r.rows[0].rows;
  }
  return { app: 'pup-health', format_version: 1, exported_at: new Date().toISOString(), tables };
}

// ---------------------------------------------------------------------
const db = await freshDb();
check('schema.sql runs cleanly on a fresh database', true);

await db.exec(seed);
const expected = { dogs: 2, treatments: 8, contacts: 1, events: 6, doses: 24, weights: 6, identifiers: 6 };
for (const [t, n] of Object.entries(expected)) check(`seed loaded ${t}`, (await count(db, t)) === n, `${await count(db, t)} rows`);

await db.exec(seed);
check('running seed.sql twice adds nothing', (await count(db, 'doses')) === 24);
check('seed inserts were recorded in the change history', (await count(db, 'change_log')) === 53);

// --- Privacy: not logged in ---
for (const t of [...TABLES, 'change_log', 'household_members', 'export_log']) {
  const err = await errorOf(() => as(db, 'anon', null, () => db.query(`select * from public.${t}`)));
  check(`not-logged-in visitor blocked from ${t}`, /permission denied/.test(err ?? '') || false, err ?? 'NO ERROR');
}
// (as() returns fn's result; wrap so errors are captured)
async function asErr(role, email, sql, params) {
  return errorOf(() => as(db, role, email, () => db.query(sql, params)));
}
check('not-logged-in visitor cannot call the membership check',
  /permission denied/.test(await asErr('anon', null, 'select public.is_household_member()') ?? ''));

// --- Privacy: logged in, but not in the household ---
const stranger = 'stranger@example.test';
for (const t of [...TABLES, 'change_log', 'household_members']) {
  const rows = await as(db, 'authenticated', stranger, () => db.query(`select * from public.${t}`));
  check(`stranger sees 0 rows in ${t}`, rows.rows.length === 0, `${rows.rows.length} rows`);
}
check('stranger cannot add a dog',
  /row-level security/.test(await asErr('authenticated', stranger, `insert into public.dogs (name) values ('Intruder')`) ?? ''));
check('stranger cannot add themselves to the household',
  /permission denied/.test(await asErr('authenticated', stranger, `insert into public.household_members (email) values ('${stranger}')`) ?? ''));
const strangerUpdate = await as(db, 'authenticated', stranger, () => db.query(`update public.dogs set notes = 'x' returning id`));
check('stranger update changes 0 rows', strangerUpdate.rows.length === 0);

// --- Household member ---
const memberMixedCase = 'Test-Member@Example.TEST';
const memberDogs = await as(db, 'authenticated', memberMixedCase, () => db.query(`select name from public.dogs order by sort_order`));
check('household member sees both dogs (email case ignored)', memberDogs.rows.map(r => r.name).join(',') === 'Sunny,Chomper Kelce');

const before = (await db.query(`select updated_at from public.weights where date = '2026-10-26' limit 1`)).rows[0].updated_at;
await as(db, 'authenticated', MEMBER, () =>
  db.query(`update public.weights set notes = 'home scale' where date = '2026-10-26' and dog_id = '00000000-0000-4000-8000-000000000001'`));
const after = (await db.query(`select updated_at from public.weights where date = '2026-10-26' and dog_id = '00000000-0000-4000-8000-000000000001'`)).rows[0].updated_at;
check('editing a row updates its updated_at', after > before);
const log = await db.query(`select changed_by, action, old_row->>'notes' as old_notes, new_row->>'notes' as new_notes
                            from public.change_log where action = 'update'`);
check('edit recorded in change history with who did it',
  log.rows.length === 1 && log.rows[0].changed_by === MEMBER && log.rows[0].old_notes === null && log.rows[0].new_notes === 'home scale',
  JSON.stringify(log.rows[0]));

const memberSeesLog = await as(db, 'authenticated', MEMBER, () => db.query(`select count(*)::int as n from public.change_log`));
check('member can read the change history', memberSeesLog.rows[0].n > 0);
check('member cannot erase the change history',
  /permission denied/.test(await asErr('authenticated', MEMBER, `delete from public.change_log`) ?? ''));
check('member cannot edit the change history',
  /permission denied/.test(await asErr('authenticated', MEMBER, `update public.change_log set changed_by = 'x'`) ?? ''));
check('member cannot change the household list from the app',
  /permission denied/.test(await asErr('authenticated', MEMBER, `insert into public.household_members (email) values ('friend@example.test')`) ?? ''));

// --- Safety nets ---
check('deleting a dog that has records is blocked',
  /foreign key/.test(await asErr('authenticated', MEMBER, `delete from public.dogs where name = 'Sunny'`) ?? ''));
check('same dose logged twice on one day is blocked',
  /duplicate key/.test(await asErr('authenticated', MEMBER,
    `insert into public.doses (dog_id, treatment_id, date_given)
     select dog_id, treatment_id, date_given from public.doses where date_given = '2026-10-29' limit 1`) ?? ''));
check('next due before date given is blocked',
  /check constraint/.test(await asErr('authenticated', MEMBER,
    `insert into public.doses (dog_id, treatment_id, date_given, next_due)
     select dog_id, treatment_id, '2026-12-01', '2026-11-01' from public.doses limit 1`) ?? ''));
check('impossible weight is blocked',
  /check constraint/.test(await asErr('authenticated', MEMBER,
    `insert into public.weights (dog_id, date, weight_lbs) select id, '2026-12-01', 0 from public.dogs limit 1`) ?? ''));

// Delete + find it in history
const contactName = (await db.query(`select name from public.contacts limit 1`)).rows[0].name;
await as(db, 'authenticated', MEMBER, () => db.query(`delete from public.contacts`));
const deleted = await db.query(`select old_row->>'name' as name from public.change_log where action = 'delete' and table_name = 'contacts'`);
check('a deleted row can be found in the change history', deleted.rows[0]?.name === contactName);
// put it back for the rest of the test
await db.exec(`insert into public.contacts select * from jsonb_populate_record(null::public.contacts,
  (select old_row from public.change_log where action = 'delete' and table_name = 'contacts'))`);
check('...and put back from there', (await count(db, 'contacts')) === 1);

// --- Dashboard view as of today (2026-11-02) ---
const dash = await db.query(`
  with latest as (
    select distinct on (d.dog_id, d.treatment_id) d.dog_id, d.treatment_id, d.date_given, d.next_due
    from public.doses d order by d.dog_id, d.treatment_id, d.date_given desc
  )
  select g.short_name as dog, t.name as treatment, to_char(l.date_given, 'MM/DD/YYYY') as last_given,
         coalesce(to_char(l.next_due, 'MM/DD/YYYY'), '-') as next_due,
         case when l.next_due is null then 'no due date'
              when l.next_due < date '2026-11-02' then 'OVERDUE ' || (date '2026-11-02' - l.next_due) || ' days'
              when l.next_due = date '2026-11-02' then 'DUE TODAY'
              when l.next_due <= date '2026-11-02' + 14 then 'due in ' || (l.next_due - date '2026-11-02') || ' days'
              else 'ok' end as status,
         (select count(*) from public.doses h where h.dog_id = l.dog_id and h.treatment_id = l.treatment_id)::int as doses
  from latest l join public.dogs g on g.id = l.dog_id join public.treatments t on t.id = l.treatment_id
  order by g.sort_order, t.sort_order`);
console.log('\nDASHBOARD AS OF 11/02/2026');
console.table(dash.rows);

const w = await db.query(`select g.short_name as dog, to_char(w.date,'MM/DD') as date, w.weight_lbs
                          from public.weights w join public.dogs g on g.id = w.dog_id order by g.sort_order, w.date`);
console.log('WEIGHTS'); console.table(w.rows.map(r => ({ ...r, weight_lbs: Number(r.weight_lbs) })));

// --- Backup -> restore round trip ---
const backup = await as(db, 'authenticated', MEMBER, () => exportAll(db));
writeFileSync(scratch + 'roundtrip.json', JSON.stringify(backup));
const restoreSql = execFileSync('node', [root + '/tools/json-to-sql.mjs', scratch + 'roundtrip.json'], { encoding: 'utf8' });
const db2 = await freshDb();
await db2.exec(restoreSql);
const backup2 = await exportAll(db2);
const same = TABLES.every(t => JSON.stringify(backup.tables[t]) === JSON.stringify(backup2.tables[t]));
check('JSON backup restores into a fresh database exactly', same);

// --- Backup log ---
await as(db, 'authenticated', MEMBER, () => db.query(`insert into public.export_log (kind) values ('json')`));
const logged = (await db.query(`select exported_by, kind from public.export_log`)).rows;
check('a backup is logged with who did it', logged.length === 1 && logged[0].exported_by === MEMBER && logged[0].kind === 'json',
  JSON.stringify(logged));
check('member cannot erase the backup log',
  /permission denied/.test(await asErr('authenticated', MEMBER, `delete from public.export_log`) ?? ''));
check('only "json" or "csv" can be logged',
  /check constraint/.test(await asErr('authenticated', MEMBER, `insert into public.export_log (kind) values ('pdf')`) ?? ''));
const strangerLog = await as(db, 'authenticated', stranger, () => db.query(`select * from public.export_log`));
check('stranger sees 0 rows in export_log', strangerLog.rows.length === 0);
check('stranger cannot add to the backup log',
  /row-level security/.test(await asErr('authenticated', stranger, `insert into public.export_log (kind) values ('json')`) ?? ''));

// --- Keep-awake check (called daily by the free GitHub job, no login) ---
const awake = await as(db, 'anon', null, () => db.query(`select public.keep_awake() as ok`));
check('not-logged-in visitor can ask keep_awake, and only gets "true"', awake.rows[0].ok === true);
check('...but still can\'t read any records',
  /permission denied/.test(await asErr('anon', null, `select * from public.dogs`) ?? ''));

// --- Import: what the Import screen would save fits the real tables ---
// (Demo mode accepts any column name; the real database doesn't. This
// saves an import plan exactly the way the app does, as a household
// member, so a misnamed column would show up here.)
const I = await import('../js/importer.js');
const seedData = JSON.parse(readFileSync(root + '/private/seed.json', 'utf8')).tables;
const pasted = JSON.stringify(['Sunny', 'Chomper'].map((dog) => ({
  dog,
  visit: { date: '2026-11-06', clinic: 'Test Clinic', vet: 'Dr. Test', weight_lbs: 41.2, vitals: { temp: 101.4, heart_rate: 110 } },
  doses: [
    { type: 'medication', name: 'Heartgard Plus Green (26-50.9 lb)', date_given: '2026-11-06' },
    { type: 'vaccine', name: 'Canine Influenza', date_given: '2026-11-06', next_due: '2026-11-27', lot: 'CI1' },
  ],
  ids: [{ kind: 'town license', value: `TEST-${dog}`, expires_on: '2027-01-31' }],
  notes: 'Test note.',
})));
const drafts = I.makeDrafts(I.readPaste(pasted).blocks, seedData, '2026-11-08');
const flu = drafts[0].items.find((it) => it.name === 'Canine Influenza');
flu.fields.treatment_id = '__new';
I.followNewTreatment(drafts, flu);
const importPlan = I.planSave(drafts, I.checkDrafts(drafts, seedData, '2026-11-08'), seedData);

// Insert rows the way supabase-js does: JSON in, the new rows' ids back.
async function insertJson(table, rows) {
  const cols = Object.keys(rows[0]).join(', ');
  const r = await db.query(`insert into public.${table} (${cols})
    select ${cols} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) returning id`, [JSON.stringify(rows)]);
  return r.rows;
}
const importErr = await errorOf(() => as(db, 'authenticated', MEMBER, async () => {
  const savedIds = {};
  for (const t of importPlan.treatments) savedIds[t.ref] = (await insertJson('treatments', [t.row]))[0].id;
  for (const e of importPlan.events) savedIds[e.ref] = (await insertJson('events', [I.fillRefs(e.row, savedIds)]))[0].id;
  for (const table of ['doses', 'weights', 'identifiers']) await insertJson(table, importPlan[table].map((row) => I.fillRefs(row, savedIds)));
}));
check('an import plan saves into the real tables', importErr === null, importErr ?? '');
const imported = await db.query(`select count(*)::int as n from public.doses d join public.treatments t on t.id = d.treatment_id
  join public.events e on e.id = d.event_id where t.name = 'Canine Influenza' and e.date = '2026-11-06'`);
check('...one new vaccine, both dogs\' doses linked to their visits', imported.rows[0].n === 2, `${imported.rows[0].n} rows`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
