// =====================================================================
//  Turn a JSON backup into SQL you can paste into Supabase
// =====================================================================
//  Works for the starter records (private/seed.json) and for any full
//  JSON backup the app exports. Use it to load the starter records, or
//  to rebuild everything in a fresh Supabase project if you ever need
//  to.
//
//    node tools/json-to-sql.mjs private/seed.json > private/seed.sql
//
//  Then paste the .sql file into Supabase -> SQL Editor -> Run.
//
//  Safe to run more than once: rows that are already there are skipped,
//  so nothing gets doubled up. It never changes or deletes existing rows.
// =====================================================================

import { readFileSync } from 'node:fs';

// Parents before children, so every link points at a row that exists.
const TABLE_ORDER = ['dogs', 'treatments', 'contacts', 'events', 'doses', 'weights', 'identifiers'];

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/json-to-sql.mjs <backup.json>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(file, 'utf8'));
if (!backup.tables || typeof backup.tables !== 'object') {
  console.error('That file does not look like a backup from this app (no "tables" section).');
  process.exit(1);
}

const lines = [
  '-- Made by tools/json-to-sql.mjs from ' + file.split('/').pop(),
  '-- Paste into Supabase -> SQL Editor -> Run. Existing rows are skipped.',
  'begin;',
  '',
];

for (const table of TABLE_ORDER) {
  const rows = backup.tables[table] || [];
  if (rows.length === 0) continue;
  // The JSON goes in between $json$ markers, so quotes and apostrophes
  // inside notes don't need any special handling.
  const json = JSON.stringify(rows, null, 1);
  if (json.includes('$json$')) throw new Error('Backup text contains "$json$", which this tool cannot handle.');
  lines.push(`-- ${table}: ${rows.length} rows`);
  lines.push(`insert into public.${table}`);
  lines.push(`select * from jsonb_populate_recordset(null::public.${table}, $json$${json}$json$)`);
  lines.push('on conflict do nothing;');
  lines.push('');
}

lines.push('commit;');
console.log(lines.join('\n'));
