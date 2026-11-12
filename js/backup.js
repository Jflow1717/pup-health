// =====================================================================
//  Backups: every record as one JSON file, or as spreadsheets
// =====================================================================
//  Nothing in here touches the screen or the database, so it can be
//  checked on its own (tests/backup.test.mjs). The Back up page
//  (screens/backup.js) hands it the records and saves what comes out.
//
//  JSON  The complete backup: every table, every column, exactly as
//        stored. Same layout as private/seed.json, so
//        tools/json-to-sql.mjs can load it back into Supabase.
//  CSV   For reading: one spreadsheet per kind of record, with the
//        dog's and vaccine's names spelled out, zipped into one file.
// =====================================================================

export const BACKUP_TABLES = ['dogs', 'treatments', 'events', 'doses', 'weights', 'identifiers', 'contacts'];

export function buildBackup(data, now = new Date()) {
  const tables = {};
  for (const t of BACKUP_TABLES) tables[t] = data[t] || [];
  return { app: 'pup-health', format_version: 1, exported_at: now.toISOString(), tables };
}

// "pup-health-backup-2026-11-12.json" (the same names .gitignore keeps
// out of GitHub).
export function backupFileName(kind, today) {
  return `pup-health-backup-${today}.${kind === 'json' ? 'json' : 'zip'}`;
}


// ---------------------------------------------------------------------
//  Spreadsheets (CSV)
// ---------------------------------------------------------------------
// Every column of every table, so even an empty table gets a header.
const COLUMNS = {
  dogs: ['name', 'short_name', 'sex', 'breed', 'birth_date', 'collar_color', 'notes', 'sort_order'],
  treatments: ['name', 'kind', 'repeat_days', 'weight_bands', 'aliases', 'active', 'sort_order', 'notes'],
  events: ['date', 'kind', 'title', 'clinic', 'vet', 'vitals', 'details', 'ongoing'],
  doses: ['date_given', 'product_name', 'size', 'lot_number', 'lot_expires', 'vet', 'clinic', 'next_due', 'duration', 'notes'],
  weights: ['date', 'weight_lbs', 'notes'],
  identifiers: ['kind', 'value', 'issuer', 'issued_on', 'expires_on', 'details'],
  contacts: ['kind', 'name', 'person', 'phone', 'email', 'address', 'website', 'notes', 'sort_order'],
};
// Record numbers go at the end of each row, where they're out of the way.
const ID_COLUMNS = {
  dogs: ['id'], treatments: ['id'], contacts: ['id'],
  events: ['id', 'dog_id'], identifiers: ['id', 'dog_id'],
  doses: ['id', 'dog_id', 'treatment_id', 'event_id'], weights: ['id', 'dog_id', 'event_id'],
};
const STAMPS = ['created_at', 'updated_at'];

const FILE_NOTES = {
  doses: 'every vaccine and medication given',
  weights: 'the weight log',
  events: 'vet visits, reactions, allergies, illnesses, and notes',
  identifiers: 'microchip, AKC, rabies tag, license, and insurance numbers',
  dogs: 'the dogs themselves',
  treatments: 'the list of vaccines and medications (with sizes)',
  contacts: 'vets, breeder, and others',
};

// One CSV file per table: [{ name: 'doses.csv', text }], plus a short
// README.txt saying what each file is.
export function csvFiles(data, today) {
  const dogName = new Map((data.dogs || []).map((d) => [d.id, d.short_name || d.name]));
  const dogRank = new Map([...(data.dogs || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((d, i) => [d.id, i]));
  const treatmentName = new Map((data.treatments || []).map((t) => [t.id, t.name]));
  const files = [];
  for (const table of ['doses', 'weights', 'events', 'identifiers', 'dogs', 'treatments', 'contacts']) {
    const rows = [...(data[table] || [])];
    // Names first, so the spreadsheet makes sense without looking anything up.
    const named = [];
    if (ID_COLUMNS[table].includes('dog_id')) named.push('dog');
    if (table === 'doses') named.push('treatment');
    const withNames = rows.map((r) => ({
      ...r,
      dog: dogName.get(r.dog_id) ?? '',
      treatment: treatmentName.get(r.treatment_id) ?? '',
      dogRank: dogRank.get(r.dog_id) ?? 0,   // for sorting only
    }));
    withNames.sort(rowOrder(table));
    // Any column added to the database later still comes along.
    const known = [...named, ...COLUMNS[table], ...ID_COLUMNS[table], ...STAMPS];
    const extra = [...new Set(rows.flatMap(Object.keys))].filter((k) => !known.includes(k));
    const columns = [...named, ...COLUMNS[table], ...extra, ...ID_COLUMNS[table], ...STAMPS];
    files.push({ name: `${table}.csv`, text: csvText(withNames, columns) });
  }
  files.unshift({ name: 'README.txt', text: readme(today) });
  return files;
}

// Dog by dog (in the app's order), oldest first, the way a spreadsheet
// usually reads.
function rowOrder(table) {
  const dateOf = { doses: 'date_given', weights: 'date', events: 'date' }[table];
  return (a, b) => {
    const keys = table === 'doses' ? ['dogRank', 'treatment', 'date_given']
      : dateOf ? ['dogRank', dateOf]
      : table === 'identifiers' ? ['dogRank', 'kind', 'issued_on']
      : ['sort_order', 'name'];
    for (const k of keys) {
      const x = a[k] ?? '', y = b[k] ?? '';
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
}

function readme(today) {
  return [
    `Pup Health records, backed up ${today}`,
    '',
    'One spreadsheet per kind of record. Open them in Excel, Numbers, or Google Sheets.',
    '',
    ...Object.entries(FILE_NOTES).map(([t, words]) => `  ${(t + '.csv').padEnd(17)}${words}`),
    '',
    'These are for reading. To load records back into the app if anything is',
    'ever lost, use the JSON backup (see "Restoring from a backup" in SETUP.md).',
    '',
  ].join('\r\n');
}

// Rows -> CSV text that Excel, Numbers, and Google Sheets all open
// correctly (including accents and the ° sign).
export function csvText(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A spreadsheet would treat text starting with = + - or @ as a
  // formula, so it gets a ' in front (numbers like -5 are left alone).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}


// ---------------------------------------------------------------------
//  Zip: several files in one download
// ---------------------------------------------------------------------
// The simplest kind of zip ("stored", not squeezed smaller). Every
// computer and phone can open it. files: [{ name, text }]
export function makeZip(files, when = new Date()) {
  const encode = (s) => new TextEncoder().encode(s);
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const chunks = [];
  const directory = [];
  let offset = 0;

  for (const f of files) {
    const name = encode(f.name);
    const data = encode(f.text);
    const crc = crc32(data);
    // Each file: a short header, its name, then its contents.
    const head = header(30, [
      [4, 0x04034b50], [2, 20], [2, 0x0800], [2, 0], [2, time], [2, date],
      [4, crc], [4, data.length], [4, data.length], [2, name.length], [2, 0],
    ]);
    chunks.push(head, name, data);
    // ...and a line about it in the table of contents at the end.
    directory.push(header(46, [
      [4, 0x02014b50], [2, 20], [2, 20], [2, 0x0800], [2, 0], [2, time], [2, date],
      [4, crc], [4, data.length], [4, data.length], [2, name.length], [2, 0], [2, 0],
      [2, 0], [2, 0], [4, 0], [4, offset],
    ]), name);
    offset += head.length + name.length + data.length;
  }
  const directorySize = directory.reduce((n, c) => n + c.length, 0);
  const end = header(22, [
    [4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length],
    [4, directorySize], [4, offset], [2, 0],
  ]);
  return joinBytes([...chunks, ...directory, end]);
}

// Little-endian numbers, as the zip format wants them.
function header(size, fields) {
  const view = new DataView(new ArrayBuffer(size));
  let at = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 4) view.setUint32(at, value, true);
    else view.setUint16(at, value, true);
    at += bytes;
  }
  return new Uint8Array(view.buffer);
}

function joinBytes(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// The checksum zip files use to spot damage.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
