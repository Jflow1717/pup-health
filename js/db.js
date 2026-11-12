// =====================================================================
//  Reading and saving records
// =====================================================================
//  The rest of the app only talks to the database through the handful
//  of functions in this file. There are two ways it can run:
//
//    live  The real records in Supabase, shared by both logins.
//    demo  Only on this computer, before Supabase is set up (or with
//          ?demo at the end of the address). It loads the starter
//          records from private/seed.json and keeps changes in memory,
//          so a reload puts everything back. Nothing is saved.
// =====================================================================

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

// The Supabase helper library, from a free public library host. The
// exact version is pinned so it can't change underneath the app.
const SUPABASE_LIBRARY = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

export const TABLES = ['dogs', 'treatments', 'events', 'doses', 'weights', 'identifiers', 'contacts'];

let supabase = null;   // the live connection (live mode only)
let demo = null;       // the in-memory records (demo mode only)

// 'live', 'demo', or 'setup' (live, but config.js isn't filled in yet).
export let mode = 'setup';


// ---------------------------------------------------------------------
//  Starting up
// ---------------------------------------------------------------------
export async function start() {
  const onThisComputer = ['localhost', '127.0.0.1'].includes(location.hostname);
  const configured = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY;
  const askedForDemo = new URLSearchParams(location.search).has('demo');

  if (onThisComputer && (askedForDemo || !configured)) {
    mode = 'demo';
    const response = await fetch('private/seed.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Demo mode needs private/seed.json (run: node private/seed-data.mjs).');
    demo = { tables: (await response.json()).tables, user: null };
    return mode;
  }
  if (!configured) {
    mode = 'setup';
    return mode;
  }
  mode = 'live';
  const { createClient } = await import(SUPABASE_LIBRARY);
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },   // stay logged in on this device
  });
  return mode;
}


// ---------------------------------------------------------------------
//  Logging in and out
// ---------------------------------------------------------------------
// Who is logged in on this device, or null.
export async function currentUser() {
  if (mode === 'demo') return demo.user;
  const { data } = await supabase.auth.getSession();
  return data.session ? { email: data.session.user.email } : null;
}

export async function signIn(email, password) {
  if (mode === 'demo') {
    demo.user = { email: email || 'demo@example.test' };
    return demo.user;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return { email: data.user.email };
}

export async function signOut() {
  if (mode === 'demo') { demo.user = null; return; }
  await supabase.auth.signOut();
}

// Is the logged-in email on the household list? (Anyone else sees
// empty tables, so the app checks and explains instead.)
export async function isHouseholdMember() {
  if (mode === 'demo') return true;
  const { data, error } = await supabase.rpc('is_household_member');
  if (error) throw error;
  return data === true;
}


// ---------------------------------------------------------------------
//  Reading: everything at once
// ---------------------------------------------------------------------
// Two dogs make for small tables, so the app simply loads every record
// at startup and after each change. That keeps both phones in step.
export async function loadAll() {
  if (mode === 'demo') return structuredClone(demo.tables);
  const results = await Promise.all(TABLES.map((t) => supabase.from(t).select('*')));
  const data = {};
  TABLES.forEach((t, i) => {
    if (results[i].error) throw results[i].error;
    data[t] = results[i].data;
  });
  return data;
}


// ---------------------------------------------------------------------
//  Saving
// ---------------------------------------------------------------------
// Add one or more new rows. All or nothing: if one can't be saved,
// none are.
export async function insertRows(table, rows) {
  if (mode === 'demo') return demoInsert(table, rows);
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) throw error;
  return data;
}

// Change some fields of one row.
export async function updateRow(table, id, changes) {
  if (mode === 'demo') return demoUpdate(table, id, changes);
  const { data, error } = await supabase.from(table).update(changes).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Delete one row. (The database keeps a copy in change_log.)
export async function deleteRow(table, id) {
  if (mode === 'demo') return demoDelete(table, id);
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
//  Backup log: when someone last downloaded a backup
// ---------------------------------------------------------------------
// Kept in the database (not on one phone), so every device knows.
// Returns { exported_at, exported_by, kind } or null.
export async function lastBackup() {
  if (mode === 'demo') return demo.lastBackup || null;
  const { data, error } = await supabase.from('export_log').select('*')
    .order('exported_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}

// kind: 'json' or 'csv'. Who and when are filled in by the database.
export async function logBackup(kind) {
  if (mode === 'demo') {
    demo.lastBackup = { exported_at: new Date().toISOString(), exported_by: demo.user && demo.user.email, kind };
    return;
  }
  const { error } = await supabase.from('export_log').insert({ kind });
  if (error) throw error;
}

// Turns a database error into a sentence a person can act on.
export function friendlyError(err) {
  const code = err && err.code;
  const text = String((err && err.message) || err || '');
  if (code === '23505') return 'That is already recorded (same dog, same item, same day). Edit the existing one instead.';
  if (code === '23514') return 'One of the values isn\'t allowed. For example, a next due date can\'t be before the date given.';
  if (code === '23503') return 'That record is still linked to others, so it can\'t be removed.';
  if (code === '42501') return 'This login isn\'t on the household list, so it can\'t see or change records.';
  if (/invalid login credentials/i.test(text)) return 'That email and password don\'t match. Check for typos and try again.';
  if (/failed to fetch|network|load failed|importing a module/i.test(text)) return 'Couldn\'t reach the database. Check the internet connection and try again.';
  return text || 'Something went wrong.';
}


// ---------------------------------------------------------------------
//  Demo mode: a tiny stand-in for the database, in memory
// ---------------------------------------------------------------------
// The same "no doubles" rules as supabase/schema.sql, so demo mode
// complains in the same places the real database would.
const DEMO_UNIQUE = {
  dogs: [['name']],
  treatments: [['name']],
  doses: [['dog_id', 'treatment_id', 'date_given']],
  weights: [['dog_id', 'date']],
  identifiers: [['dog_id', 'kind', 'value']],
};

function demoError(code, message) {
  return Object.assign(new Error(message), { code });
}

function demoCheck(table, row, ignoreId) {
  for (const cols of DEMO_UNIQUE[table] || []) {
    const clash = demo.tables[table].some((r) => r.id !== ignoreId && cols.every((c) => r[c] === row[c]));
    if (clash) throw demoError('23505', 'duplicate key');
  }
  if (table === 'doses' && row.next_due && row.next_due < row.date_given) throw demoError('23514', 'check violation');
}

function demoInsert(table, rows) {
  const now = new Date().toISOString();
  const added = rows.map((r) => ({ ...r, id: crypto.randomUUID(), created_at: now, updated_at: now }));
  const pending = [];
  for (const r of added) {
    demoCheck(table, r, null);
    // Also stop doubles within this same batch.
    for (const cols of DEMO_UNIQUE[table] || []) {
      if (pending.some((p) => cols.every((c) => p[c] === r[c]))) throw demoError('23505', 'duplicate key');
    }
    pending.push(r);
  }
  demo.tables[table].push(...added);
  return structuredClone(added);
}

function demoUpdate(table, id, changes) {
  const row = demo.tables[table].find((r) => r.id === id);
  if (!row) throw new Error('That record no longer exists.');
  const updated = { ...row, ...changes, updated_at: new Date().toISOString() };
  demoCheck(table, updated, id);
  Object.assign(row, updated);
  return structuredClone(row);
}

function demoDelete(table, id) {
  demo.tables[table] = demo.tables[table].filter((r) => r.id !== id);
  // Same as the database: doses and weights from a deleted visit stay,
  // they just stop pointing at it.
  if (table === 'events') {
    for (const t of ['doses', 'weights']) {
      for (const r of demo.tables[t]) if (r.event_id === id) r.event_id = null;
    }
  }
}
