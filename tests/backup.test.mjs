// Checks backups (js/backup.js) against the starter records in
// private/seed.json: the JSON backup can be loaded back in, the
// spreadsheets open correctly, and the zip is a real zip (checked with
// this computer's own unzip). Also the vet summary's due-date words and
// the dashboard's backup reminder. Nothing goes online.
//
//   cd tests
//   npm run test:backup
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as B from '../js/backup.js';
import * as L from '../js/logic.js';

const root = process.argv[2] || '..';
const seed = JSON.parse(readFileSync(root + '/private/seed.json', 'utf8')).tables;
const TODAY = '2026-11-12';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};
const same = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(name, ok, ok ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const scratch = mkdtempSync(join(tmpdir(), 'pup-health-backup-test-'));

// --- JSON backup ---
const backup = B.buildBackup(seed, new Date('2026-11-12T15:00:00Z'));
same('JSON backup: same layout as the starter file', [backup.app, backup.format_version, Object.keys(backup.tables)],
  ['pup-health', 1, ['dogs', 'treatments', 'events', 'doses', 'weights', 'identifiers', 'contacts']]);
same('JSON backup: every record is in it', B.BACKUP_TABLES.map((t) => backup.tables[t].length),
  B.BACKUP_TABLES.map((t) => seed[t].length));
writeFileSync(join(scratch, 'backup.json'), JSON.stringify(backup));
const sql = execFileSync('node', [root + '/tools/json-to-sql.mjs', join(scratch, 'backup.json')], { encoding: 'utf8' });
check('JSON backup: the restore tool reads it (all 7 tables)', (sql.match(/^insert into public\./gm) || []).length === 7);
same('file names', [B.backupFileName('json', TODAY), B.backupFileName('csv', TODAY)],
  ['pup-health-backup-2026-11-12.json', 'pup-health-backup-2026-11-12.zip']);

// --- Spreadsheet cells ---
same('plain text', B.csvCell('Sunny'), 'Sunny');
same('commas and quotes are wrapped', B.csvCell('City Vet, "East"'), '"City Vet, ""East"""');
same('line breaks are wrapped', B.csvCell('a\nb'), '"a\nb"');
same('blank', B.csvCell(null), '');
same('numbers and yes/no', [B.csvCell(38.5), B.csvCell(true)], ['38.5', 'true']);
same('JSON details stay readable', B.csvCell({ temp: 99 }), '"{""temp"":99}"');
same('text that looks like a formula is made safe', B.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
same('a negative number is left alone', B.csvCell('-5'), '-5');
const tiny = B.csvText([{ a: 1, b: 'x' }], ['a', 'b']);
check('starts with the mark that tells Excel it\'s UTF-8', tiny.startsWith('﻿'));
same('rows end with CR LF', tiny, '﻿a,b\r\n1,x\r\n');

// --- Spreadsheet files ---
const files = B.csvFiles(seed, TODAY);
same('one file per table, plus a README', files.map((f) => f.name),
  ['README.txt', 'doses.csv', 'weights.csv', 'events.csv', 'identifiers.csv', 'dogs.csv', 'treatments.csv', 'contacts.csv']);
const rowsOf = (name) => files.find((f) => f.name === name).text.replace('﻿', '').trim().split('\r\n');
const doseHeader = rowsOf('doses.csv')[0].split(',');
same('doses: names first, record numbers last', [doseHeader.slice(0, 3), doseHeader.slice(-6)],
  [['dog', 'treatment', 'date_given'], ['id', 'dog_id', 'treatment_id', 'event_id', 'created_at', 'updated_at']]);
same('doses: one line per dose', rowsOf('doses.csv').length - 1, seed.doses.length);
check('doses: Sunny first, then Chomper', rowsOf('doses.csv')[1].startsWith('Sunny,') && rowsOf('doses.csv').at(-1).startsWith('Chomper,'));
check('contacts: no dog column', !rowsOf('contacts.csv')[0].split(',').includes('dog'));
check('no sorting helper leaks into the files', files.every((f) => !f.text.includes('dogRank')));
const empty = B.csvFiles({ ...seed, contacts: [] }, TODAY).find((f) => f.name === 'contacts.csv');
check('an empty table still gets its header row', empty.text.includes('kind,name,person,phone'));

// --- Zip ---
same('zip checksum matches the standard test value', B.crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
const zipPath = join(scratch, 'backup.zip');
writeFileSync(zipPath, B.makeZip(files, new Date(2026, 10, 12, 9, 30)));
let unzipOk = true, listing = '';
try { listing = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }); } catch (e) { unzipOk = false; listing = e.message; }
check('zip: this computer\'s unzip tool says it\'s fine', unzipOk && /No errors detected/.test(listing), listing.split('\n').at(-2));
const unzipped = execFileSync('unzip', ['-p', zipPath, 'doses.csv'], { encoding: 'utf8' });
check('zip: a file comes back out exactly', unzipped === files.find((f) => f.name === 'doses.csv').text);
check('zip: the file date is right', /11-12-2026 09:30/.test(execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' })));

// --- Vet summary due dates ---
same('summary: a future due date', L.summaryDueText('2027-10-29', TODAY), 'Oct 29, 2027');
same('summary: overdue says so in words', L.summaryDueText('2026-10-31', TODAY), 'OVERDUE (was due Oct 31, 2026)');
same('summary: no due date', L.summaryDueText(null, TODAY), '');

// --- Backup reminder ---
same('reminder: never backed up', L.backupAge(null, TODAY), { day: null, days: null, due: true });
same('reminder: backed up today', L.backupAge(new Date(2026, 10, 12, 8).toISOString(), TODAY).due, false);
same('reminder: 29 days ago is fine', L.backupAge(new Date(2026, 9, 14, 12).toISOString(), TODAY), { day: '2026-10-14', days: 29, due: false });
same('reminder: 30 days ago is time again', L.backupAge(new Date(2026, 9, 13, 12).toISOString(), TODAY).due, true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
