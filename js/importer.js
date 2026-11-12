// =====================================================================
//  Import from Claude: reading and checking a pasted block
// =====================================================================
//  Nothing in here touches the screen or the database, so it can be
//  checked on its own (tests/import.test.mjs). The import screen
//  (screens/import.js) uses it in four steps:
//
//    1. readPaste()    finds the JSON in whatever was pasted
//    2. makeDrafts()   turns each block into items you can edit (a
//                      visit, a weight, doses, IDs), matched to the
//                      app's dogs and vaccine/medication names
//    3. checkDrafts()  finds mistakes, and anything already saved
//    4. planSave()     the exact rows to add or change
//
//  Nothing here saves. The screen does that, only after you tap Save
//  and confirm.
// =====================================================================

import * as L from './logic.js';

// The boxes each part of a block may have. Anything else is listed on
// the review screen as "not imported", so nothing disappears quietly.
const BLOCK_KEYS = ['dog', 'visit', 'doses', 'ids', 'notes'];
const VISIT_KEYS = ['date', 'clinic', 'vet', 'weight_lbs', 'vitals', 'title', 'reason', 'notes', 'details'];
const DOSE_KEYS = ['type', 'name', 'date_given', 'next_due', 'lot', 'lot_number', 'lot_expires',
  'product', 'product_name', 'size', 'duration', 'notes', 'vet', 'clinic'];
const ID_KEYS = ['kind', 'value', 'issuer', 'issued_on', 'expires_on', 'details', 'notes'];

export const EVENT_KINDS = ['vet_visit', 'reaction', 'allergy', 'illness', 'injury', 'note'];
export const ID_KIND_NAMES = ['microchip', 'akc', 'rabies_tag', 'town_license', 'insurance', 'other'];
const ID_WORDS = {
  microchip: 'microchip', akc: 'AKC number', rabies_tag: 'rabies tag',
  town_license: 'town license', insurance: 'insurance policy', other: 'other ID',
};

// How each box is named in messages ("Lot number: 886750 -> 886751").
const FIELD_WORDS = {
  date: 'Date', title: 'Title', clinic: 'Clinic', vet: 'Vet', details: 'Details',
  weight_lbs: 'Weight', date_given: 'Date given', next_due: 'Next due', product_name: 'Product',
  size: 'Size', lot_number: 'Lot number', lot_expires: 'Lot expires', duration: 'Duration',
  notes: 'Notes', value: 'Number', issuer: 'Issued by', issued_on: 'Issued on',
  expires_on: 'Expires or renews', kind: 'Kind',
};
export const VITAL_WORDS = {
  temp: 'Temperature (°F)', body_condition_score: 'Body condition (1-9)',
  heart_rate: 'Heart rate (per min)', resp_rate: 'Breathing (per min)',
  safe_to_vaccinate: 'Safe to vaccinate (yes/no)',
};
export const vitalWord = (key) => VITAL_WORDS[key] || cap(key.replace(/_/g, ' '));

const DOSE_COMPARE = ['next_due', 'product_name', 'size', 'lot_number', 'lot_expires', 'vet', 'clinic', 'duration', 'notes'];
const ID_COMPARE = ['issuer', 'issued_on', 'expires_on', 'details'];

// A dose this close to one already saved (same dog, same item) might be
// the same dose typed in twice, so it gets a "check this".
const NEAR_DAYS = 7;


// ---------------------------------------------------------------------
//  1. Finding the JSON in what was pasted
// ---------------------------------------------------------------------
// Claude's reply may have words around the block, ```code fences```,
// one block per dog one after another, or a [list] of blocks. All of
// those work. Returns { blocks: [...] } or { blocks: [], error }.
export function readPaste(pasted) {
  const text = String(pasted ?? '');
  if (!text.trim()) return { blocks: [], error: 'Paste the block from Claude first.' };

  const pieces = [];
  let from = 0;
  for (;;) {
    const start = nextBlockStart(text, from);
    if (start < 0) break;
    const end = closingBracket(text, start);
    if (end < 0) {
      return { blocks: [], error: 'The block looks cut off: it ends before its last } or ]. ' +
        'Copy it again from Claude, all the way to the end, and paste it again.' };
    }
    pieces.push({ start, text: text.slice(start, end + 1) });
    from = end + 1;
  }
  if (pieces.length === 0) {
    return { blocks: [], error: 'There\'s no { ... } block in what was pasted. Copy Claude\'s block and paste it again.' };
  }

  const blocks = [];
  for (const piece of pieces) {
    const parsed = parseLeniently(piece.text);
    if (parsed.error) {
      const line = parsed.at == null ? null : lineNumber(text, piece.start + parsed.at, parsed.line);
      return { blocks: [], error: 'This isn\'t quite valid JSON, so nothing was read' +
        (line ? ` (the problem is near line ${line})` : '') +
        '. That\'s usually a missing comma or quote mark. Copying the block again with Claude\'s copy button usually fixes it.' };
    }
    blocks.push(...(Array.isArray(parsed.value) ? parsed.value : [parsed.value]));
  }

  const out = [];
  for (const [i, block] of blocks.entries()) {
    const unwrapped = unwrap(block);
    if (!isObject(unwrapped) && !Array.isArray(unwrapped)) {
      return { blocks: [], error: `Item ${i + 1} in the paste isn't a { ... } block.` };
    }
    out.push(...(Array.isArray(unwrapped) ? unwrapped : [unwrapped]));
  }
  for (const [i, block] of out.entries()) {
    if (!isObject(block) || !['visit', 'doses', 'ids', 'notes'].some((k) => k in block)) {
      return { blocks: [], error: `Block ${i + 1} doesn't look like the import format. ` +
        'It needs "dog" and at least one of "visit", "doses", "ids", or "notes".' };
    }
  }
  return { blocks: out };
}

// Where the next block starts: a "{", or a "[" that opens a list of blocks.
function nextBlockStart(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') return i;
    if (text[i] === '[' && /^\[\s*\{/.test(text.slice(i, i + 200))) return i;
  }
  return -1;
}

// The position of the bracket that closes the one at "start", or -1.
// Brackets inside "quoted text" don't count.
function closingBracket(text, start) {
  let depth = 0, inQuotes = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"' || c === '”') inQuotes = false;
      continue;
    }
    if (c === '"' || c === '“') inQuotes = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// JSON.parse, plus a second try that fixes two common copy-and-paste
// problems: curly quote marks, and a stray comma before } or ].
function parseLeniently(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    try {
      const fixed = text.replace(/[“”]/g, '"').replace(/,(\s*[}\]])/g, '$1');
      return { value: JSON.parse(fixed) };
    } catch {
      // Browsers word their errors differently; some say where.
      const message = String(err.message);
      const line = message.match(/line (\d+)/);
      const position = message.match(/position (\d+)/);
      if (line) return { error: true, at: 0, line: Number(line[1]) };
      return { error: true, at: position ? Number(position[1]) : null };
    }
  }
}

function lineNumber(text, position, lineInPiece) {
  const before = text.slice(0, position).split('\n').length;
  return lineInPiece ? before + lineInPiece - 1 : before;
}

// { "blocks": [ ... ] } -> [ ... ], in case Claude wraps the list.
function unwrap(value) {
  if (!isObject(value) || BLOCK_KEYS.some((k) => k in value)) return value;
  const lists = Object.values(value).filter((v) => Array.isArray(v) && v.every(isObject));
  return lists.length === 1 ? lists[0] : value;
}


// ---------------------------------------------------------------------
//  Small helpers for reading pasted values
// ---------------------------------------------------------------------
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');

// Any pasted value as trimmed text ("" for nothing).
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

// "Rabies (Nobivac)" -> "rabies nobivac": lower case, letters and
// numbers only. Used to compare names.
export const simplify = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Dates the paperwork (or Claude) might use, as "2026-10-29":
// 2026-10-29, 10/29/2026, 10/29/26, Oct 29, 2026. Anything else comes
// back as it was, and the check says it can't be read.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function toISODate(value) {
  const t = text(value);
  if (!t) return '';
  const tidy = (y, m, d) => {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    return L.isDate(iso) ? iso : t;
  };
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})T/))) return tidy(m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return tidy(m[1], m[2], m[3]);
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/))) {
    return tidy(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2]);
  }
  if ((m = t.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) return tidy(m[3], month + 1, m[2]);
  }
  return t;
}

// "38 lb" -> "38". Other text is kept, and the check flags it.
function poundsText(value) {
  return text(value).replace(/\s*(lbs?|pounds?)\.?$/i, '');
}

// "vaccine" or "medication" from whatever "type" says ("" if unclear).
function typeWord(value) {
  const t = simplify(value);
  if (!t) return '';
  if (t.includes('vacc')) return 'vaccine';
  if (/medic|^meds?$|drug|prevent|deworm|parasite|flea|tick|heartworm/.test(t)) return 'medication';
  return '';
}

// The kind of ID from whatever "kind" says.
export function idKind(value) {
  const t = simplify(value);
  if (ID_KIND_NAMES.includes(t.replace(/ /g, '_'))) return t.replace(/ /g, '_');
  if (t.includes('chip')) return 'microchip';
  if (/\bakc\b/.test(t)) return 'akc';
  if (t.includes('rabies')) return 'rabies_tag';
  if (t.includes('licen')) return 'town_license';
  if (t.includes('insur') || t.includes('policy')) return 'insurance';
  return 'other';
}

// "1 year" when the dates are exactly whole years apart, else "28 days".
export function durationText(from, to) {
  if (!L.isDate(from) || !L.isDate(to)) return '';
  const days = L.daysBetween(from, to);
  if (days <= 0) return '';
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (years > 0 && to.slice(5) === from.slice(5)) return `${years} year${years === 1 ? '' : 's'}`;
  return `${days} days`;
}

// Vitals as text for the boxes: {temp: 99, safe_to_vaccinate: true}
// -> {temp: "99", safe_to_vaccinate: "yes"}
function vitalsToText(vitals, ignored) {
  const out = {};
  if (!isObject(vitals)) return out;
  for (const [key, v] of Object.entries(vitals)) {
    if (typeof v === 'boolean') out[key] = v ? 'yes' : 'no';
    else if (typeof v === 'number' || typeof v === 'string') out[key] = String(v).trim();
    else if (v != null) ignored.push(`vitals ${key}: ${short(v)}`);
  }
  return out;
}

// ...and back, for saving: numbers become numbers, yes/no become true/false.
export function parseVitals(vitals) {
  const out = {};
  for (const [key, v] of Object.entries(vitals || {})) {
    const t = String(v ?? '').trim();
    if (!t) continue;
    if (/^-?\d+(\.\d+)?$/.test(t)) out[key] = Number(t);
    else if (/^(yes|true)$/i.test(t)) out[key] = true;
    else if (/^(no|false)$/i.test(t)) out[key] = false;
    else out[key] = t;
  }
  return out;
}

const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
};

// Boxes in the pasted block that the app has no place for.
function unknownKeys(obj, allowed, where, ignored) {
  for (const [key, v] of Object.entries(obj)) {
    if (allowed.includes(key) || v == null || v === '') continue;
    ignored.push(`${where}${key}: ${short(v)}`);
  }
}


// ---------------------------------------------------------------------
//  Matching names to the app's dogs and vaccines/medications
// ---------------------------------------------------------------------
// "Chomper" finds "Chomper Kelce". Returns the dog, or null.
export function matchDog(name, dogs) {
  const want = simplify(name);
  if (!want) return null;
  const exact = dogs.find((d) => simplify(d.name) === want || simplify(d.short_name) === want);
  if (exact) return exact;
  const first = want.split(' ')[0];
  const byFirst = dogs.filter((d) => [d.name, d.short_name].some((n) => simplify(n).split(' ')[0] === first));
  return byFirst.length === 1 ? byFirst[0] : null;
}

// Which of the app's vaccines and medications a pasted name means,
// using each one's name and its other names (aliases).
//   "Rabies (Nobivac)"   -> Rabies (the part before the brackets)
//   "Nobivac 1-Rabies"   -> Rabies ("rabies" is one of its words)
// Returns { treatment, others } (others: further possible matches), or
// null when nothing fits.
export function matchTreatment(name, treatments, type = '') {
  const want = simplify(name);
  if (!want) return null;
  const namesOf = (t) => [t.name, ...(t.aliases || [])].map(simplify).filter(Boolean);
  const kindFirst = (list) => [...list].sort((a, b) => (b.t.kind === type) - (a.t.kind === type) || b.len - a.len);

  // 1. The whole name, or the name without its (brackets), is one it knows.
  const outside = simplify(String(name).replace(/\([^)]*\)/g, ' '));
  for (const wanted of [want, outside]) {
    const hits = treatments.filter((t) => namesOf(t).includes(wanted)).map((t) => ({ t, len: wanted.length }));
    if (hits.length) {
      const [best, ...rest] = kindFirst(hits);
      return { treatment: best.t, others: rest.map((h) => h.t) };
    }
  }
  // 2. One of its names appears inside, as whole words. Longest wins.
  const padded = ` ${want} `;
  const hits = [];
  for (const t of treatments) {
    const len = Math.max(0, ...namesOf(t).filter((n) => padded.includes(` ${n} `)).map((n) => n.length));
    if (len) hits.push({ t, len });
  }
  if (!hits.length) return null;
  const [best, ...rest] = kindFirst(hits);
  return { treatment: best.t, others: rest.map((h) => h.t) };
}

// What goes in "Product": the brand in brackets ("Rabies (Nobivac)" ->
// "Nobivac"), or the whole pasted name when it says more than the app's
// own name. Nothing when it's just the app's name for it.
export function productFromName(name, treatment) {
  const raw = text(name);
  const known = [treatment.name, ...(treatment.aliases || [])].map(simplify);
  if (!raw || known.includes(simplify(raw))) return '';
  // "Heartgard Plus Green (26-50.9 lb)" is just the name plus a size
  // (the size gets its own box).
  const sizeWords = (treatment.weight_bands || []).map((b) => simplify(b.label));
  const withoutSize = simplify(raw.replace(/\([^)]*\d\s*(lbs?|pounds?)\b[^)]*\)/gi, ' '))
    .split(' ').filter((w) => !sizeWords.includes(w)).join(' ');
  if (known.includes(withoutSize)) return '';
  const m = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && known.includes(simplify(m[1]))) {
    return !m[2].trim() || known.includes(simplify(m[2])) ? '' : m[2].trim();
  }
  return raw;
}

// For sized meds: "NexGard Purple (24.1-60 lb)" -> "Purple (24.1-60 lb)".
export function sizeFromName(name, treatment) {
  const padded = ` ${simplify(name)} `;
  const band = (treatment.weight_bands || []).find((b) => padded.includes(` ${simplify(b.label)} `));
  return band ? L.bandLabel(band) : '';
}


// ---------------------------------------------------------------------
//  2. Turning blocks into items to review
// ---------------------------------------------------------------------
// Each block becomes:
//   { index, rawDog, dogId, ignored: [...], items: [...] }
// and each item (a visit, a weight, a dose, an ID):
//   { key, type, block, include, action, fields, auto, name? }
// "fields" holds every box as text, exactly as the review screen shows
// it. "auto" lists boxes the app filled in itself (like a monthly
// med's next due date); they keep updating until you type over them.
export function makeDrafts(blocks, data, today = L.todayISO()) {
  const drafts = blocks.map((raw, i) => makeBlock(raw, i, data, today));
  untickRepeats(drafts);
  return drafts;
}

function makeBlock(raw, bi, data, today) {
  const ignored = [];
  unknownKeys(raw, BLOCK_KEYS, '', ignored);
  const visit = isObject(raw.visit) ? raw.visit : null;
  if (raw.visit != null && raw.visit !== '' && !visit) ignored.push(`visit: ${short(raw.visit)}`);
  if (visit) unknownKeys(visit, VISIT_KEYS, 'visit ', ignored);

  const doseList = toList(raw.doses, 'doses', ignored);
  const idList = toList(raw.ids, 'ids', ignored);
  const firstDoseDate = doseList.map((d) => toISODate(d.date_given)).find(L.isDate) || '';
  const notes = text(raw.notes);
  const items = [];

  // The visit (or, with no visit, a note holding the "notes").
  let visitDate = '';
  if (visit || notes) {
    visitDate = visit ? (toISODate(visit.date) || firstDoseDate) : '';
    items.push(newItem(bi, 'event', 0, {
      kind: visit ? 'vet_visit' : 'note',
      date: visit ? visitDate : (firstDoseDate || today),
      title: text(visit?.title) || text(visit?.reason),   // filled in below if blank
      clinic: text(visit?.clinic),
      vet: text(visit?.vet),
      vitals: vitalsToText(visit?.vitals, ignored),
      details: [text(visit?.details), text(visit?.notes), notes].filter(Boolean).join('\n\n'),
    }));
  }
  const atVisit = (date) => visit && date && date === visitDate;

  if (visit && text(visit.weight_lbs)) {
    items.push(newItem(bi, 'weight', 0, { date: visitDate, weight_lbs: poundsText(visit.weight_lbs) }));
  }

  for (const [i, d] of doseList.entries()) {
    unknownKeys(d, DOSE_KEYS, `dose ${i + 1} `, ignored);
    const name = text(d.name);
    const type = typeWord(d.type);
    const match = matchTreatment(name, data.treatments, type);
    const t = match && match.treatment;
    const date = toISODate(d.date_given) || visitDate;
    const it = newItem(bi, 'dose', i, {
      treatment_id: t ? t.id : '',
      new_name: name,
      new_kind: type || (t ? t.kind : 'vaccine'),
      date_given: date,
      next_due: toISODate(d.next_due),
      product_name: text(d.product) || text(d.product_name) || (t ? productFromName(name, t) : name),
      size: text(d.size) || (t ? sizeFromName(name, t) : ''),
      lot_number: text(d.lot) || text(d.lot_number),
      lot_expires: toISODate(d.lot_expires),
      vet: text(d.vet) || (atVisit(date) ? text(visit.vet) : ''),
      clinic: text(d.clinic) || (atVisit(date) ? text(visit.clinic) : ''),
      duration: text(d.duration),
      notes: text(d.notes),
    });
    it.name = name;
    it.matchedId = t ? t.id : '';
    it.others = match ? match.others.map((o) => o.id) : [];
    if (!it.fields.next_due) it.auto.push('next_due');
    if (!it.fields.duration) it.auto.push('duration');
    items.push(it);
  }

  for (const [i, x] of idList.entries()) {
    unknownKeys(x, ID_KEYS, `id ${i + 1} `, ignored);
    const kind = idKind(x.kind);
    const rawKind = text(x.kind);
    const details = [text(x.details), text(x.notes)].filter(Boolean).join('\n');
    const it = newItem(bi, 'id', i, {
      kind,
      value: text(x.value),
      issuer: text(x.issuer),
      issued_on: toISODate(x.issued_on),
      expires_on: toISODate(x.expires_on),
      // An unusual kind ("city tag") is kept in the notes, so it isn't lost.
      details: kind === 'other' && rawKind && simplify(rawKind) !== 'other'
        ? [rawKind, details].filter(Boolean).join(': ') : details,
    });
    if (!it.fields.issued_on) it.auto.push('issued_on');
    items.push(it);
  }

  const block = { index: bi, rawDog: text(raw.dog), dogId: '', ignored, items };
  const dog = matchDog(raw.dog, data.dogs);
  block.dogId = dog ? dog.id : '';
  for (const it of items) fillAutoFields(it, block, data);
  const event = items.find((it) => it.type === 'event');
  if (event && !event.fields.title) event.fields.title = visit ? visitTitle(block, data) : 'Notes from vet paperwork';
  return block;
}

function toList(value, name, ignored) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  const keep = list.filter(isObject);
  if (keep.length < list.length) ignored.push(`${name}: ${list.length - keep.length} item(s) that weren't { ... } blocks`);
  return keep;
}

function newItem(block, type, i, fields) {
  return { key: `b${block}-${type}-${i}`, type, block, include: true, action: null, fields, auto: [] };
}

// "Rabies, 5-in-1, Lyme +2 more", from the doses given at the visit.
function visitTitle(block, data) {
  const day = visitDateOf(block);
  const names = block.items.filter((it) => it.type === 'dose' && (!day || it.fields.date_given === day)).map((it) => {
    const t = data.treatments.find((x) => x.id === it.fields.treatment_id);
    return (t ? t.name : it.name).replace(/\s*\([^)]*\)/g, '');
  }).filter(Boolean);
  if (!names.length) return 'Vet visit';
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
}

// The visit's date, if the block has a vet visit.
export function visitDateOf(block) {
  const event = block.items.find((it) => it.type === 'event' && it.fields.kind === 'vet_visit');
  return event && L.isDate(event.fields.date) ? event.fields.date : '';
}

// Fills the boxes the app looks after (see "auto" above):
//   next due   monthly meds: 30 days after the date given
//   duration   worked out from the date given and next due
//   issued on  a rabies tag: the visit's date
// Returns the names of the boxes it changed, so the screen can update them.
export function fillAutoFields(it, block, data) {
  const f = it.fields;
  const before = { ...f };
  if (it.type === 'dose') {
    const t = data.treatments.find((x) => x.id === f.treatment_id);
    if (it.auto.includes('next_due')) {
      f.next_due = t && t.repeat_days && L.isDate(f.date_given) ? L.addDays(f.date_given, t.repeat_days) : '';
    }
    if (it.auto.includes('duration')) f.duration = durationText(f.date_given, f.next_due);
  }
  if (it.type === 'id' && it.auto.includes('issued_on')) {
    f.issued_on = f.kind === 'rabies_tag' ? visitDateOf(block) : '';
  }
  return Object.keys(f).filter((k) => f[k] !== before[k]);
}

// The visit's date was changed from "from" to "to": dates in the block
// that matched it (doses given at the visit, the weigh-in) follow along.
// Returns [{ key, field }] for every box it changed.
export function moveVisitDate(block, from, to) {
  const changed = [];
  if (!L.isDate(from) || !L.isDate(to) || from === to) return changed;
  for (const it of block.items) {
    for (const field of ['date_given', 'date']) {
      if (it.type !== 'event' && it.fields[field] === from) {
        it.fields[field] = to;
        changed.push({ key: it.key, field });
      }
    }
  }
  return changed;
}

// "Add as a new vaccine" was picked for one dose: other doses in the
// paste with the same unknown name (usually the other dog's) follow,
// so both end up under one new entry. Returns the items it changed.
export function followNewTreatment(drafts, picked) {
  const want = simplify(String(picked.name || '').replace(/\([^)]*\)/g, ' '));
  const changed = [];
  if (!want) return changed;
  for (const block of drafts) {
    for (const it of block.items) {
      if (it === picked || it.type !== 'dose' || it.fields.treatment_id !== '') continue;
      if (simplify(String(it.name || '').replace(/\([^)]*\)/g, ' ')) !== want) continue;
      it.fields.treatment_id = '__new';
      it.fields.new_name = picked.fields.new_name;
      it.fields.new_kind = picked.fields.new_kind;
      changed.push(it);
    }
  }
  return changed;
}

// The same thing twice in one paste (say, a dose in two blocks for the
// same dog): the later copy starts unticked.
function untickRepeats(drafts) {
  const seen = new Set();
  for (const block of drafts) {
    for (const it of block.items) {
      const id = identity(it, block.dogId);
      if (!id) continue;
      if (seen.has(id)) it.include = false;
      seen.add(id);
    }
  }
}

// What makes two items "the same thing": the same rules the database
// uses to refuse doubles.
function identity(it, dogId) {
  if (!dogId) return null;
  const f = it.fields;
  if (it.type === 'dose') {
    // Not matched yet: go by the paperwork's wording.
    const what = f.treatment_id === '__new' ? 'new:' + simplify(f.new_name)
      : f.treatment_id || (it.name ? 'name:' + simplify(it.name) : '');
    return what ? `dose|${dogId}|${what}|${f.date_given}` : null;
  }
  if (it.type === 'weight') return `weight|${dogId}|${f.date}`;
  if (it.type === 'id') return `id|${dogId}|${f.kind}|${f.value.trim().toLowerCase()}`;
  return null;   // two visits on one day is unusual, but allowed
}


// ---------------------------------------------------------------------
//  3. Checking
// ---------------------------------------------------------------------
// Returns a Map: item key (or "block-0") -> result:
//   messages  [{ level: 'error' | 'warn' | 'info', text }]
//   level     the most serious message level ('ok' if none)
//   clash     the saved record this would duplicate, or null
//   same      true when that saved record already says all of this
//   changes   [{ label, from, to }]  what an update would change
//   update    the changes as database columns
//   options   choices when it clashes: [[value, words], ...]
//   choice    which of those is picked
//   effect    what Save will do: 'add', 'update', 'link' (use the
//             saved visit as is), or 'skip'
export function checkDrafts(drafts, data, today = L.todayISO()) {
  const results = new Map();
  const firstSeen = new Map();   // identity -> { it, effect }
  for (const block of drafts) {
    const dog = data.dogs.find((d) => d.id === block.dogId) || null;
    const br = newResult();
    if (!dog) {
      say(br, 'error', block.rawDog
        ? `“${block.rawDog}” isn't one of the dogs in the app. Pick which dog this is for.`
        : 'The block doesn\'t say which dog. Pick the dog.');
    }
    if (block.ignored.length) {
      say(br, 'info', `Not imported, because the app has no box for it: ${block.ignored.join('; ')}.`);
    }
    results.set('block-' + block.index, finish(br));

    for (const it of block.items) {
      const r = newResult();
      if (it.type === 'event') checkEvent(it, r, dog, data, today);
      if (it.type === 'weight') checkWeight(it, r, dog, data, today);
      if (it.type === 'dose') checkDose(it, r, dog, data, today);
      if (it.type === 'id') checkId(it, r, dog, data, today);
      decideEffect(it, r, dog);

      // The same thing twice in this paste.
      const id = identity(it, block.dogId);
      if (id) {
        const first = firstSeen.get(id);
        if (!first) firstSeen.set(id, { it, r });
        else {
          const where = first.it.block === it.block ? 'this block' : `block ${first.it.block + 1}`;
          if (r.effect !== 'skip' && first.r.effect !== 'skip') {
            say(r, 'error', `This is also in ${where} of the paste. Untick one of them.`);
          } else if (r.effect === 'skip' && !r.clash) {
            say(r, 'info', `Also in ${where} of the paste, so this copy is unticked.`);
          }
        }
      }
      results.set(it.key, finish(r));
    }
  }
  return results;
}

const newResult = () => ({ messages: [], clash: null, same: false, changes: [], update: {}, options: null, choice: null, effect: 'add' });
const say = (r, level, words) => r.messages.push({ level, text: words });
const RANK = { error: 3, warn: 2, info: 1 };
function finish(r) {
  const worst = Math.max(0, ...r.messages.map((m) => RANK[m.level]));
  r.level = Object.keys(RANK).find((k) => RANK[k] === worst) || 'ok';
  return r;
}
const nameOf = (dog) => dog.short_name || dog.name;
const when = (iso, today) => L.formatDate(iso, { short: true, today });

// A date box: missing, unreadable, or in the future.
function dateOk(r, value, label, today, { required = false, notFuture = false } = {}) {
  if (!value) {
    if (required) say(r, 'error', `${label} is missing.`);
    return false;
  }
  if (!L.isDate(value)) {
    say(r, 'error', `${label} “${value}” isn't a date the app can read. Pick the date in the box.`);
    return false;
  }
  if (notFuture && value > today) {
    say(r, 'error', `${label} can't be in the future.`);
    return false;
  }
  return true;
}

// What would change if the saved record took these values (only boxes
// that have something in them; a blank never erases what's saved).
// Boxes the app filled in itself ("auto") don't count: they're a
// guess, and the saved record already has its own answer.
function differences(saved, fields, names, today, auto = []) {
  const changes = [], update = {};
  for (const name of names) {
    if (auto.includes(name)) continue;
    const mine = String(fields[name] ?? '').trim();
    const theirs = saved[name] == null ? '' : String(saved[name]);
    if (!mine || mine === theirs) continue;
    // A shorter version of what's saved ("Nobivac" when "Nobivac
    // (Merck)" is saved) adds nothing.
    if (!L.isDate(mine) && simplify(theirs).includes(simplify(mine))) continue;
    changes.push({ label: FIELD_WORDS[name], from: shown(theirs, today), to: shown(mine, today) });
    update[name] = mine;
  }
  return { changes, update };
}
const shown = (v, today) => (!v ? '(blank)' : L.isDate(v) ? L.formatDate(v, { today }) : v);

function filledNote(it, r) {
  const filled = it.auto.filter((k) => it.fields[k]);
  if (!filled.length) return;
  const words = { next_due: 'next due (from the usual repeat)', duration: 'duration (from the dates)', issued_on: 'issued on (the visit date)' };
  say(r, 'info', `Filled in by the app: ${filled.map((k) => words[k]).join(', ')}.`);
}

function checkEvent(it, r, dog, data, today) {
  const f = it.fields;
  if (!EVENT_KINDS.includes(f.kind)) say(r, 'error', 'Pick what kind of record this is.');
  const dated = dateOk(r, f.date, 'Date', today, { required: true, notFuture: true });
  if (!f.title.trim()) say(r, 'error', 'Title is missing.');

  const temp = (f.vitals.temp ?? '').trim();
  if (temp && !Number.isFinite(Number(temp))) say(r, 'error', `Temperature “${temp}” needs to be a number.`);
  else if (temp && (Number(temp) < 99.5 || Number(temp) > 103)) {
    say(r, 'warn', `Temperature ${temp}°F is unusual (dogs usually run about 101-102.5°F). Check the paperwork for a typo.`);
  }
  const bcs = (f.vitals.body_condition_score ?? '').trim();
  if (bcs && !(Number(bcs) >= 1 && Number(bcs) <= 9)) say(r, 'warn', `Body condition is usually 1 to 9; this says “${bcs}”.`);

  if (!dog || !dated) return;
  const saved = data.events.find((e) => e.dog_id === dog.id && e.date === f.date && e.kind === f.kind &&
    (f.kind === 'vet_visit' || simplify(e.title) === simplify(f.title)));
  if (!saved) return;
  r.clash = saved;
  say(r, 'info', `${nameOf(dog)} already has a ${f.kind === 'vet_visit' ? 'vet visit' : f.kind} saved on ${when(f.date, today)}: “${saved.title}”.`);

  // Using the saved visit only adds what it's missing; it never
  // changes what's already there.
  for (const name of ['clinic', 'vet']) {
    if (f[name].trim() && !saved[name]) {
      r.changes.push({ label: FIELD_WORDS[name], from: '(blank)', to: f[name].trim() });
      r.update[name] = f[name].trim();
    }
  }
  const details = f.details.trim();
  if (details && !(saved.details || '').includes(details)) {
    r.update.details = saved.details ? `${saved.details}\n\n${details}` : details;
    r.changes.push({ label: 'Details', from: saved.details ? '(kept)' : '(blank)', to: `adds “${short(details)}”` });
  }
  const vitals = parseVitals(f.vitals);
  const savedVitals = saved.vitals || {};
  const missing = Object.keys(vitals).filter((k) => savedVitals[k] == null || savedVitals[k] === '');
  if (missing.length) {
    r.update.vitals = { ...savedVitals };
    for (const k of missing) {
      r.update.vitals[k] = vitals[k];
      r.changes.push({ label: vitalWord(k), from: '(blank)', to: f.vitals[k] });
    }
  }
}

function checkWeight(it, r, dog, data, today) {
  const f = it.fields;
  const dated = dateOk(r, f.date, 'Date', today, { required: true, notFuture: true });
  const t = f.weight_lbs.trim();
  const lbs = Number(t);
  if (!t) say(r, 'error', 'Weight is empty.');
  else if (!Number.isFinite(lbs)) say(r, 'error', `Weight “${t}” isn't a number of pounds.`);
  else if (lbs <= 0 || lbs > 300) say(r, 'error', 'Weight needs to be between 0 and 300 lb.');
  if (!dog || !dated || !Number.isFinite(lbs) || !t) return;

  const saved = data.weights.find((w) => w.dog_id === dog.id && w.date === f.date);
  if (saved) {
    r.clash = saved;
    if (Number(saved.weight_lbs) === lbs) r.same = true;
    else {
      r.changes.push({ label: 'Weight', from: `${Number(saved.weight_lbs)} lb`, to: `${lbs} lb` });
      r.update.weight_lbs = lbs;
    }
    say(r, 'info', `${nameOf(dog)} already has a weight saved for ${when(f.date, today)}: ${Number(saved.weight_lbs)} lb.`);
    return;
  }
  // A typo like 83 for 38? Puppies grow fast, so allow 5 lb plus 4 lb a week.
  const list = L.weightsFor(data.weights, dog.id);
  const near = [...list].reverse().find((w) => w.date < f.date) || list.find((w) => w.date > f.date);
  if (near) {
    const weeks = Math.abs(L.daysBetween(near.date, f.date)) / 7;
    if (Math.abs(lbs - Number(near.weight_lbs)) > 5 + 4 * weeks) {
      say(r, 'warn', `That's a big change from ${Number(near.weight_lbs)} lb on ${when(near.date, today)}. Check for a typo.`);
    }
  }
}

function checkDose(it, r, dog, data, today) {
  const f = it.fields;
  let t = null;
  if (f.treatment_id === '__new') {
    const name = f.new_name.trim();
    if (!name) say(r, 'error', 'Type a name for the new vaccine or medication.');
    const taken = data.treatments.find((x) => simplify(x.name) === simplify(name));
    if (name && taken) say(r, 'error', `There's already “${taken.name}”. Pick it from the list instead.`);
    if (!['vaccine', 'medication'].includes(f.new_kind)) say(r, 'error', 'Say whether the new one is a vaccine or a medication.');
  } else {
    t = data.treatments.find((x) => x.id === f.treatment_id) || null;
    if (!t) {
      say(r, 'error', it.name
        ? `“${it.name}” isn't a name the app knows. Pick which vaccine or medication it is, or add it as a new one.`
        : 'Pick which vaccine or medication this is.');
    } else if (it.others.length && f.treatment_id === it.matchedId) {
      const also = it.others.map((id) => data.treatments.find((x) => x.id === id)?.name).filter(Boolean);
      say(r, 'warn', `“${it.name}” could also mean ${also.join(' or ')}. Check the right one is picked.`);
    }
  }
  const given = dateOk(r, f.date_given, 'Date given', today, { required: true, notFuture: true });
  const due = dateOk(r, f.next_due, 'Next due', today);
  if (given && due && f.next_due < f.date_given) say(r, 'error', 'Next due can\'t be before the date given.');
  const lot = dateOk(r, f.lot_expires, 'Lot expires', today);
  if (given && lot && f.lot_expires < f.date_given) {
    say(r, 'warn', 'The lot had already expired on the day it was given. Check the paperwork.');
  }
  const saved = dog && t && given
    ? data.doses.find((d) => d.dog_id === dog.id && d.treatment_id === t.id && d.date_given === f.date_given)
    : null;
  if (!saved) filledNote(it, r);
  if (!dog || !t || !given) return;
  if (saved) {
    r.clash = saved;
    Object.assign(r, differences(saved, f, DOSE_COMPARE, today, it.auto));
    r.same = r.changes.length === 0;
    say(r, 'info', `${nameOf(dog)} already has ${t.name} saved on ${when(f.date_given, today)}.`);
    return;
  }
  const close = L.dosesFor(data.doses, dog.id, t.id)
    .find((d) => Math.abs(L.daysBetween(d.date_given, f.date_given)) <= NEAR_DAYS);
  if (close) {
    say(r, 'warn', `${nameOf(dog)} already has ${t.name} on ${when(close.date_given, today)}. Make sure this isn't the same dose.`);
  }
}

function checkId(it, r, dog, data, today) {
  const f = it.fields;
  if (!ID_KIND_NAMES.includes(f.kind)) say(r, 'error', 'Pick what kind of ID this is.');
  if (!f.value.trim()) say(r, 'error', 'The number is empty.');
  const issued = dateOk(r, f.issued_on, 'Issued on', today);
  const expires = dateOk(r, f.expires_on, 'Expires or renews', today);
  if (issued && expires && f.expires_on < f.issued_on) say(r, 'error', 'It can\'t expire before it was issued.');
  const value = f.value.trim().toLowerCase();
  const sameKind = dog ? data.identifiers.filter((x) => x.dog_id === dog.id && x.kind === f.kind) : [];
  const saved = value ? sameKind.find((x) => x.value.toLowerCase() === value) : null;
  if (!saved) filledNote(it, r);
  if (!dog || !value) return;
  if (saved) {
    r.clash = saved;
    Object.assign(r, differences(saved, f, ID_COMPARE, today, it.auto));
    r.same = r.changes.length === 0;
    say(r, 'info', `${nameOf(dog)}'s ${ID_WORDS[f.kind]} ${saved.value} is already saved.`);
    return;
  }
  const current = [...sameKind].sort(L.idNewerFirst)[0];
  if (!current) return;
  if (f.kind === 'microchip' || f.kind === 'akc') {
    say(r, 'warn', `${nameOf(dog)} already has ${ID_WORDS[f.kind]} ${current.value}, and a dog usually has just one. Check this number.`);
  } else {
    say(r, 'info', `${nameOf(dog)}'s current ${ID_WORDS[f.kind]} is ${current.value}. This one is added too, and the newest shows first.`);
  }
}

// What Save will do with the item.
function decideEffect(it, r, dog) {
  if (!dog) { r.effect = 'skip'; return; }
  if (r.clash && it.type === 'event') {
    const adds = Object.keys(r.update).length > 0;
    r.options = [
      ['link', adds ? 'Same visit: add what\'s missing to the saved one' : 'Same visit: use the saved one'],
      ['new', 'A different visit: save it separately'],
      ['skip', 'Don\'t save this visit'],
    ];
    r.choice = it.action || 'link';
    r.effect = r.choice === 'link' ? (adds ? 'update' : 'link') : r.choice === 'new' ? 'add' : 'skip';
    return;
  }
  if (r.clash) {
    if (r.same) { r.effect = 'skip'; return; }
    r.options = [
      ['skip', 'Keep the saved one as it is'],
      ['update', 'Update the saved one with the changes below'],
    ];
    r.choice = it.action || 'skip';
    r.effect = r.choice;
    return;
  }
  r.effect = it.include ? 'add' : 'skip';
}

// Anything that has to be fixed before saving: [{ key, text }].
// Unticked and skipped items don't count.
export function blockingProblems(drafts, results) {
  const out = [];
  for (const block of drafts) {
    const br = results.get('block-' + block.index);
    for (const m of br.messages) if (m.level === 'error') out.push({ key: 'block-' + block.index, text: m.text });
    for (const it of block.items) {
      const r = results.get(it.key);
      if (r.effect === 'skip') continue;
      for (const m of r.messages) if (m.level === 'error') out.push({ key: it.key, text: m.text });
    }
  }
  return out;
}


// ---------------------------------------------------------------------
//  4. The plan: exactly what Save will add and change
// ---------------------------------------------------------------------
// New rows that point at other new rows (a dose at a new visit, or at
// a new vaccine) say { $ref: '...' }; the screen swaps in the real ID
// once that row is saved.
//   treatments, events   [{ ref, row }]   saved one at a time, first
//   doses, weights, identifiers  [row]
//   updates   [{ table, id, changes }]
//   perDog    [{ dogId, counts }]   for "Save 1 visit, 5 doses ...?"
//   total     how many rows will be added or changed
export function planSave(drafts, results, data) {
  const plan = { treatments: [], events: [], doses: [], weights: [], identifiers: [], updates: [], perDog: [], total: 0 };
  const newTreatments = new Map();   // simplified name -> ref
  let nextOrder = Math.max(0, ...data.treatments.map((t) => t.sort_order ?? 0)) + 1;
  const blank = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

  for (const block of drafts) {
    const counts = { visit: 0, note: 0, dose: 0, weight: 0, id: 0, treatment: 0, updated: 0, skipped: 0 };
    const dog_id = block.dogId;
    let eventRef = null;
    let eventDate = null;

    for (const it of block.items) {
      const r = results.get(it.key);
      const f = it.fields;
      if (r.effect === 'skip' || r.effect === 'link') {
        if (r.effect === 'skip') counts.skipped++;
        if (it.type === 'event' && r.effect === 'link') { eventRef = r.clash.id; eventDate = f.date; }
        continue;
      }
      if (r.effect === 'update') {
        plan.updates.push({ table: tableOf(it.type), id: r.clash.id, changes: r.update });
        counts.updated++;
        if (it.type === 'event') { eventRef = r.clash.id; eventDate = f.date; }
        continue;
      }
      // effect === 'add'
      const atVisit = (date) => (eventRef && date === eventDate ? eventRef : null);
      if (it.type === 'event') {
        plan.events.push({ ref: it.key, row: {
          dog_id, date: f.date, kind: f.kind, title: f.title.trim(), clinic: blank(f.clinic), vet: blank(f.vet),
          vitals: parseVitals(f.vitals), details: blank(f.details), ongoing: false,
        } });
        eventRef = { $ref: it.key };
        eventDate = f.date;
        counts[f.kind === 'vet_visit' ? 'visit' : 'note']++;
      }
      if (it.type === 'weight') {
        plan.weights.push({ dog_id, date: f.date, weight_lbs: Number(f.weight_lbs), event_id: atVisit(f.date), notes: null });
        counts.weight++;
      }
      if (it.type === 'dose') {
        let treatment_id = f.treatment_id;
        let product = blank(f.product_name);
        if (treatment_id === '__new') {
          const key = simplify(f.new_name);
          if (!newTreatments.has(key)) {
            const ref = 'treatment:' + key;
            newTreatments.set(key, ref);
            const alias = it.name && simplify(it.name) !== key ? [it.name.toLowerCase()] : [];
            plan.treatments.push({ ref, row: {
              name: f.new_name.trim(), kind: f.new_kind, repeat_days: null, weight_bands: [],
              aliases: alias, active: true, sort_order: nextOrder++, notes: null,
            } });
            counts.treatment++;
          }
          treatment_id = { $ref: newTreatments.get(key) };
          if (product && simplify(product) === key) product = null;
        }
        plan.doses.push({
          dog_id, treatment_id, event_id: atVisit(f.date_given), date_given: f.date_given,
          next_due: blank(f.next_due), product_name: product, size: blank(f.size), lot_number: blank(f.lot_number),
          lot_expires: blank(f.lot_expires), vet: blank(f.vet), clinic: blank(f.clinic),
          duration: blank(f.duration), notes: blank(f.notes),
        });
        counts.dose++;
      }
      if (it.type === 'id') {
        plan.identifiers.push({
          dog_id, kind: f.kind, value: f.value.trim(), issuer: blank(f.issuer),
          issued_on: blank(f.issued_on), expires_on: blank(f.expires_on), details: blank(f.details),
        });
        counts.id++;
      }
    }
    plan.perDog.push({ dogId: dog_id, counts });
  }
  plan.total = plan.treatments.length + plan.events.length + plan.doses.length + plan.weights.length +
    plan.identifiers.length + plan.updates.length;
  return plan;
}

const tableOf = (type) => ({ event: 'events', weight: 'weights', dose: 'doses', id: 'identifiers' })[type];

// Swaps { $ref } placeholders for the real IDs once they're saved.
export function fillRefs(row, saved) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v && typeof v === 'object' && '$ref' in v ? saved[v.$ref] : v;
  }
  return out;
}

// { visit: 1, dose: 5, weight: 1, id: 1 } -> "1 visit, 5 doses, 1 weight and 1 ID"
export function countWords(counts) {
  const words = [
    [counts.visit, 'visit', 'visits'], [counts.note, 'note', 'notes'], [counts.dose, 'dose', 'doses'],
    [counts.weight, 'weight', 'weights'], [counts.id, 'ID', 'IDs'],
    [counts.updated, 'update to a saved record', 'updates to saved records'],
  ].filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (words.length <= 1) return words[0] || 'nothing new';
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}


// ---------------------------------------------------------------------
//  The request to paste into Claude chat
// ---------------------------------------------------------------------
// Uses the app's own dog and vaccine/medication names, so what comes
// back matches. The example values are made up.
export function claudeRequest(data) {
  const dogs = L.sortedDogs(data.dogs).map((d) => d.name);
  const names = L.sortedTreatments(data.treatments).filter((t) => t.active).map((t) => t.name);
  const dog = (L.sortedDogs(data.dogs)[0] || { name: 'Dog name' }).name;
  const example = `{
  "dog": ${JSON.stringify(dog)},
  "visit": {
    "date": "2026-10-29",
    "clinic": "Clinic name",
    "vet": "Dr. Name",
    "weight_lbs": 38.0,
    "vitals": { "temp": 101.5, "body_condition_score": 5 }
  },
  "doses": [
    {
      "type": "vaccine",
      "name": "Rabies (Nobivac)",
      "date_given": "2026-10-29",
      "next_due": "2027-10-29",
      "lot": "123456",
      "lot_expires": "2027-07-31"
    }
  ],
  "ids": [ { "kind": "rabies_tag", "value": "T1234567" } ],
  "notes": ""
}`;
  return [
    'Please read the attached vet paperwork and write it out as JSON for my dogs\' health app, in exactly this format (the values here are only an example):',
    '',
    example,
    '',
    'Rules:',
    `- "dog" is one of: ${dogs.join(', ')}. Write one block per dog. If the paperwork covers more than one dog, put the blocks in a list: [ {...}, {...} ].`,
    '- Dates are YYYY-MM-DD.',
    '- "type" is "vaccine" or "medication".',
    `- For "name", use one of these when it fits: ${names.join('; ')}. Otherwise use the name on the paperwork. A brand can go in brackets, like "Rabies (Nobivac)".`,
    '- "kind" for ids is one of: microchip, akc, rabies_tag, town_license, insurance, other.',
    '- If the paperwork shows them, a dose can also have "product", "size", "duration", "vet", "clinic", and "notes", and an id can have "issuer", "issued_on", "expires_on", and "details". "vitals" can hold any other findings, like "heart_rate".',
    '- Leave out anything the paperwork doesn\'t show. Don\'t guess, and don\'t work out next due dates yourself.',
    '- Put anything else worth keeping (findings, instructions, reactions) in "notes".',
    '- Reply with only the JSON, in one code block.',
  ].join('\n');
}
