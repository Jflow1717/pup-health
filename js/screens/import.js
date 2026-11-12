// =====================================================================
//  Import from Claude: paste, check, save
// =====================================================================
//  #/import
//
//  1. Paste the block Claude wrote from the vet paperwork.
//  2. Check it. Every item is shown with all its boxes, matched to the
//     app's dogs and vaccine/medication names. Anything already saved,
//     or anything that looks wrong, is flagged.
//  3. Save, only after tapping Save and confirming.
//
//  The app never sees the paperwork and never contacts Claude. Reading
//  the paperwork happens in your own Claude chat; this page only takes
//  the text you paste.
//
//  The reading and checking is in importer.js. This file draws the
//  page and keeps track of your edits.
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import * as I from '../importer.js';
import { state, refresh, rerender, shortName } from '../store.js';
import { esc, statusChip, dogColor, fieldHtml, askConfirm, toast, copyText, groupDigits } from '../ui.js';
import { KIND_WORDS } from './health.js';
import { ID_KINDS } from './ids.js';

// What's on the page, kept here rather than in the page itself, so a
// redraw (like when the phone comes back to the app) loses nothing.
const session = {
  stage: 'paste',     // 'paste', 'review', or 'done'
  text: '',           // what was pasted
  drafts: null,       // the blocks being checked (importer.makeDrafts)
  results: null,      // the latest checks (importer.checkDrafts)
  message: '',        // a problem to show at the top
  edited: false,      // changed anything on the review page?
  saving: false,
  saved: null,        // after saving: [{ dogId, name, words }]
};

export function importScreen() {
  if (session.stage === 'review' && session.drafts) {
    session.results = I.checkDrafts(session.drafts, state.data, state.today);
    return reviewPage();
  }
  if (session.stage === 'done') return donePage();
  return pastePage();
}


// ---------------------------------------------------------------------
//  Step 1: paste
// ---------------------------------------------------------------------
function pastePage() {
  return `
    <div id="import-page">
      <h1 class="page-title">Import from Claude</h1>
      <section class="card">
        <p>Paste the block Claude wrote from the vet paperwork. You'll see and can change everything before anything is saved.</p>
        <label class="field" for="import-text"><span>Pasted block</span>
          <textarea id="import-text" class="paste-box" data-imp="paste" rows="10" spellcheck="false"
            autocapitalize="off" autocomplete="off" autocorrect="off"
            placeholder="${esc('{ "dog": "Sunny", "visit": { ... }, "doses": [ ... ] }')}">${esc(session.text)}</textarea>
        </label>
        ${session.message ? `<p class="form-error inline" role="alert">${esc(session.message)}</p>` : ''}
        <div class="button-row">
          <button class="btn primary" data-action="import-check">Check it</button>
          <button class="btn" data-action="import-clear">Clear</button>
        </div>
      </section>
      <details class="card how-to"${session.text ? '' : ' open'}>
        <summary><strong>How to get the block from Claude</strong></summary>
        <ol class="steps">
          <li>In the Claude app, start a new chat and add a photo or PDF of the vet paperwork.</li>
          <li>Tap <strong>Copy the request</strong> below, paste it into that chat, and send it.</li>
          <li>Claude writes back a block that starts with <code>{</code>. Copy it (Claude's copy button gets all of it)
            and paste it above.</li>
        </ol>
        <p class="muted small">The request gives Claude the app's names for the dogs and their vaccines and
          medications, so what comes back matches. This app never sees the paperwork itself.</p>
        <div class="button-row"><button class="btn" data-action="import-copy-request">Copy the request</button></div>
        <details class="history">
          <summary>Show the request</summary>
          <pre class="request-text">${esc(I.claudeRequest(state.data))}</pre>
        </details>
      </details>
    </div>`;
}

function checkPaste() {
  const box = document.getElementById('import-text');
  if (box) session.text = box.value;
  const { blocks, error } = I.readPaste(session.text);
  if (error) {
    session.message = error;
    rerender();
    return;
  }
  session.drafts = I.makeDrafts(blocks, state.data, state.today);
  session.stage = 'review';
  session.message = '';
  session.edited = false;
  rerender();
  window.scrollTo(0, 0);
}


// ---------------------------------------------------------------------
//  Step 2: check
// ---------------------------------------------------------------------
function reviewPage() {
  return `
    <div id="import-page" class="import-review">
      <div class="import-title">
        <h1 class="page-title">Check before saving</h1>
        <button class="btn small subtle" data-action="import-restart">Start over</button>
      </div>
      <p class="muted">This is everything Claude read. Tap <strong>Edit</strong> on anything to change it.
        Nothing is saved until you tap Save.</p>
      ${session.message ? `<p class="form-error inline" role="alert">${esc(session.message)}</p>` : ''}
      ${session.drafts.map(blockHtml).join('')}
      <div class="import-bar" data-totals>${totalsHtml()}</div>
    </div>`;
}

// One pasted block: which dog, then its visit, weight, doses, and IDs.
function blockHtml(block) {
  const dog = state.data.dogs.find((d) => d.id === block.dogId);
  const options = [{ value: '', label: 'Pick the dog…' },
    ...L.sortedDogs(state.data.dogs).map((d) => ({ value: d.id, label: d.name }))];
  const event = block.items.find((it) => it.type === 'event');
  const groups = [
    ['event', event && event.fields.kind !== 'vet_visit' ? 'Note' : 'Visit'],
    ['weight', 'Weight'], ['dose', 'Vaccines and medications'], ['id', 'IDs'],
  ];
  const sections = groups.map(([type, heading]) => {
    const items = block.items.filter((it) => it.type === type);
    if (!items.length) return '';
    return `<h3 class="import-group">${heading}${items.length > 1 ? ` (${items.length})` : ''}</h3>
      ${items.map(itemHtml).join('')}`;
  }).join('');

  return `
    <section class="card import-block" data-block-card="${block.index}" style="--dog:${dog ? dogColor(dog) : 'var(--line)'}">
      ${session.drafts.length > 1 ? `<p class="import-count">Block ${block.index + 1} of ${session.drafts.length}</p>` : ''}
      ${fieldHtml({ name: 'dog', label: 'Dog', type: 'select', options,
        id: `imp-b${block.index}-dog`, attrs: `data-block="${block.index}"` }, block.dogId)}
      <div data-blockstatus="${block.index}">${blockStatusHtml(block)}</div>
      ${sections || '<p class="muted">Nothing to import in this block.</p>'}
    </section>`;
}

function blockStatusHtml(block) {
  return messagesHtml(session.results.get('block-' + block.index).messages);
}

// One item: a heading and status (redrawn after every edit), and its
// boxes (drawn once, so typing is never interrupted).
function itemHtml(it) {
  const r = session.results.get(it.key);
  return `
    <article class="import-item" id="imp-${it.key}">
      <div data-head="${it.key}">${headHtml(it, r)}</div>
      <div data-status="${it.key}">${statusHtml(it, r)}</div>
      <details class="import-edit"${r.level === 'error' && r.effect !== 'skip' ? ' open' : ''}>
        <summary>Edit</summary>
        <div class="import-fields">${fieldsHtml(it)}</div>
      </details>
    </article>`;
}

function headHtml(it, r) {
  const [level, words] = chipFor(it, r);
  return `
    <div class="import-item-head"><strong>${esc(itemTitle(it))}</strong>${statusChip(level, words)}</div>
    <p class="import-line">${esc(itemLine(it))}</p>`;
}

function chipFor(it, r) {
  if (!session.drafts[it.block].dogId) return ['none', 'Pick the dog'];
  if (r.effect !== 'skip' && r.level === 'error') return ['overdue', 'Needs fixing'];
  if (r.effect === 'skip') return ['none', r.clash ? 'Already saved' : 'Won\'t be saved'];
  if (r.effect === 'update') return ['soon', it.type === 'event' ? 'Adds to saved visit' : 'Will update'];
  if (r.effect === 'link') return ['none', 'Already saved'];
  if (r.level === 'warn') return ['soon', 'New · check it'];
  return ['ok', 'New'];
}

function treatmentOf(it) {
  return state.data.treatments.find((t) => t.id === it.fields.treatment_id) || null;
}

function itemTitle(it) {
  const f = it.fields;
  if (it.type === 'event') return `${KIND_WORDS[f.kind] || 'Visit'}: ${f.title || '(no title)'}`;
  if (it.type === 'weight') return 'Weight';
  if (it.type === 'id') return (ID_KINDS[f.kind] || ID_KINDS.other).label;
  if (f.treatment_id === '__new') return `New: ${f.new_name || '(no name yet)'}`;
  const t = treatmentOf(it);
  return t ? t.name : `“${it.name || 'No name'}”`;
}

// The one-line summary under the heading.
function itemLine(it) {
  const f = it.fields;
  const day = (iso) => (L.isDate(iso) ? L.formatDate(iso, { short: true, today: state.today }) : iso || '?');
  if (it.type === 'event') {
    return [day(f.date), f.clinic, f.vet, ...L.vitalsList(I.parseVitals(f.vitals))].filter(Boolean).join(' · ');
  }
  if (it.type === 'weight') return `${f.weight_lbs || '?'} lb on ${day(f.date)}`;
  if (it.type === 'id') return [groupDigits(f.value) || '(no number)', f.issuer].filter(Boolean).join(' · ');
  const t = treatmentOf(it);
  const parts = [];
  // Show the paperwork's own wording when it differs, to make the match easy to check.
  if (it.name && f.treatment_id !== '__new' && (!t || I.simplify(it.name) !== I.simplify(t.name))) {
    parts.push(`Paperwork says “${it.name}”`);
  }
  parts.push(`given ${day(f.date_given)}`);
  if (f.next_due) parts.push(`next due ${day(f.next_due)}`);
  if (f.lot_number) parts.push(`lot ${f.lot_number}`);
  const line = parts.join(' · ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// Save this? (or, if it's already saved, what to do), plus messages.
function statusHtml(it, r) {
  let control = '';
  if (!session.drafts[it.block].dogId) control = '';
  else if (r.options) {
    const question = it.type === 'event'
      ? 'There\'s already a visit saved that day. What should Save do?'
      : 'This is already saved. What should Save do?';
    control = `
      <label class="field import-choice" for="imp-${it.key}-action"><span>${esc(question)}</span>
        <select id="imp-${it.key}-action" data-item="${it.key}" data-field="action">
          ${r.options.map(([value, words]) => `<option value="${value}"${value === r.choice ? ' selected' : ''}>${esc(words)}</option>`).join('')}
        </select></label>`;
  } else if (r.clash) {
    control = '<p class="import-same">Already saved exactly like this, so Save skips it.</p>';
  } else {
    control = `
      <label class="field check" for="imp-${it.key}-include">
        <input type="checkbox" id="imp-${it.key}-include" data-item="${it.key}" data-field="include"${it.include ? ' checked' : ''}>
        <span>Save this</span></label>`;
  }
  let changes = '';
  if (r.changes.length) {
    const visit = it.type === 'event';
    changes = `
      <div class="import-changes">
        <span>${visit ? 'Would add to the saved visit:' : 'Different from what\'s saved:'}</span>
        <ul>${r.changes.map((c) => `<li><strong>${esc(c.label)}:</strong> ${visit ? esc(c.to) : `${esc(c.from)} → ${esc(c.to)}`}</li>`).join('')}</ul>
      </div>`;
  }
  return control + messagesHtml(r.messages) + changes;
}

function messagesHtml(messages) {
  if (!messages.length) return '';
  return `<ul class="import-msgs">${messages.map((m) => `<li class="${m.level}">${esc(m.text)}</li>`).join('')}</ul>`;
}

// Every box for one item. Each knows which item and field it belongs
// to (data-item, data-field), so edits land in the right place.
function fieldsHtml(it) {
  const f = it.fields;
  const box = (def) => {
    const value = def.name.startsWith('vital:') ? f.vitals[def.name.slice(6)] : f[def.name];
    return fieldHtml({ ...def, id: `imp-${it.key}-${def.name}`, attrs: `data-item="${it.key}" data-field="${def.name}"` }, value);
  };

  if (it.type === 'event') {
    const vitalKeys = [...new Set(['temp', 'body_condition_score', ...Object.keys(f.vitals)])];
    return [
      { name: 'kind', label: 'Type', type: 'select', half: true,
        options: Object.entries(KIND_WORDS).map(([value, label]) => ({ value, label })) },
      { name: 'date', label: 'Date', type: 'date', half: true,
        hint: f.kind === 'vet_visit' ? 'Doses and the weigh-in on the same day move with it.' : '' },
      { name: 'title', label: 'Title' },
      { name: 'clinic', label: 'Clinic', half: true },
      { name: 'vet', label: 'Vet', half: true },
      ...vitalKeys.map((k) => ({ name: 'vital:' + k, label: I.vitalWord(k), half: true,
        inputmode: ['temp', 'body_condition_score'].includes(k) ? 'decimal' : '' })),
      { name: 'details', label: 'Details', type: 'textarea' },
    ].map(box).join('');
  }

  if (it.type === 'weight') {
    return [
      { name: 'date', label: 'Date', type: 'date', half: true },
      { name: 'weight_lbs', label: 'Weight (lb)', inputmode: 'decimal', half: true },
    ].map(box).join('');
  }

  if (it.type === 'dose') {
    const options = [{ value: '', label: 'Choose…' },
      ...L.sortedTreatments(state.data.treatments).map((t) => ({ value: t.id, label: t.active ? t.name : `${t.name} (not in use)` })),
      { value: '__new', label: '＋ Add as a new vaccine or medication' }];
    const newOne = [
      { name: 'new_name', label: 'Name of the new one', half: true },
      { name: 'new_kind', label: 'Kind', type: 'select', half: true,
        options: [{ value: 'vaccine', label: 'Vaccine' }, { value: 'medication', label: 'Medication' }] },
    ].map(box).join('');
    return box({ name: 'treatment_id', label: 'Vaccine or medication', type: 'select', options }) +
      `<div class="import-new" data-new="${it.key}"${f.treatment_id === '__new' ? '' : ' hidden'}>${newOne}</div>` +
      [
        { name: 'date_given', label: 'Date given', type: 'date', half: true },
        { name: 'next_due', label: 'Next due', type: 'date', half: true },
        { name: 'product_name', label: 'Product', half: true },
        { name: 'size', label: 'Size', half: true },
        { name: 'lot_number', label: 'Lot number', half: true },
        { name: 'lot_expires', label: 'Lot expires', type: 'date', half: true },
        { name: 'vet', label: 'Vet', half: true },
        { name: 'clinic', label: 'Clinic', half: true },
        { name: 'duration', label: 'Duration', placeholder: 'e.g. 1 year, 28 days' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ].map(box).join('');
  }

  const k = ID_KINDS[f.kind] || ID_KINDS.other;
  return [
    { name: 'kind', label: 'Kind', type: 'select',
      options: Object.entries(ID_KINDS).map(([value, v]) => ({ value, label: v.label })) },
    { name: 'value', label: 'Number' },
    { name: 'issuer', label: k.issuer },
    { name: 'issued_on', label: 'Issued on', type: 'date', half: true },
    { name: 'expires_on', label: k.renews ? 'Renewal date' : 'Expires on', type: 'date', half: true },
    { name: 'details', label: 'Notes', type: 'textarea' },
  ].map(box).join('');
}

// The bar at the bottom: what Save will do, and the Save button.
function totalsHtml() {
  const problems = I.blockingProblems(session.drafts, session.results);
  const plan = I.planSave(session.drafts, session.results, state.data);
  const all = addUp(plan.perDog.map((p) => p.counts));
  let words;
  if (problems.length) words = `${problems.length} thing${problems.length === 1 ? '' : 's'} to fix before saving.`;
  else if (!plan.total) words = 'Nothing new to save. It\'s all saved already.';
  else words = `Ready to save ${I.countWords(all)}.`;
  if (all.skipped && plan.total && !problems.length) words += ` ${all.skipped} skipped.`;
  return `
    <p class="${problems.length ? 'bar-problem' : ''}" role="status">${esc(words)}</p>
    <button class="btn primary" data-action="import-save"${session.saving ? ' disabled' : ''}>${session.saving ? 'Saving…' : 'Save'}</button>`;
}

function addUp(list) {
  const total = {};
  for (const counts of list) for (const [k, n] of Object.entries(counts)) total[k] = (total[k] || 0) + n;
  return total;
}


// ---------------------------------------------------------------------
//  Keeping track of edits
// ---------------------------------------------------------------------
// Every box on this page reports here as you type or pick. The edit
// goes into the draft, then the checks run again and the headings,
// messages, and totals are redrawn (the boxes themselves are left
// alone, so typing isn't interrupted).
function onEdit(event) {
  const el = event.target;
  if (!(el instanceof Element) || !el.closest('#import-page')) return;
  if (el.dataset.imp === 'paste') { session.text = el.value; return; }
  if (!session.drafts) return;

  if (el.dataset.block !== undefined) {
    const block = session.drafts[Number(el.dataset.block)];
    if (block.dogId === el.value) return;
    block.dogId = el.value;
    session.edited = true;
    return recheck();
  }

  const it = findItem(el.dataset.item);
  const field = el.dataset.field;
  if (!it || !field) return;
  const value = el.type === 'checkbox' ? el.checked : el.value;

  if (field === 'include' || field === 'action') {
    if (it[field] === value) return;   // "input" and "change" both arrive
    it[field] = value;
  } else if (field.startsWith('vital:')) {
    const key = field.slice(6);
    if ((it.fields.vitals[key] ?? '') === value) return;
    it.fields.vitals[key] = value;
  } else {
    const before = it.fields[field];
    if (before === value) return;
    it.fields[field] = value;
    it.auto = it.auto.filter((k) => k !== field);   // typed over: the app stops filling it in
    const block = session.drafts[it.block];
    if (it.type === 'event' && field === 'date' && it.fields.kind === 'vet_visit') {
      for (const c of I.moveVisitDate(block, before, value)) setBox(c.key, c.field);
    }
    for (const other of block.items) {
      for (const name of I.fillAutoFields(other, block, state.data)) setBox(other.key, name);
    }
    if (field === 'treatment_id') {
      const followers = value === '__new' ? I.followNewTreatment(session.drafts, it) : [];
      for (const x of [it, ...followers]) {
        for (const name of ['treatment_id', 'new_name', 'new_kind']) setBox(x.key, name);
        const wrap = document.querySelector(`[data-new="${x.key}"]`);
        if (wrap) wrap.hidden = x.fields.treatment_id !== '__new';
      }
    }
  }
  session.edited = true;
  recheck();
}
document.addEventListener('input', onEdit);
document.addEventListener('change', onEdit);

function findItem(key) {
  for (const block of session.drafts) {
    const it = block.items.find((x) => x.key === key);
    if (it) return it;
  }
  return null;
}

// Puts a value the app changed (like a date that followed the visit)
// into its box on screen.
function setBox(key, field) {
  const el = document.getElementById(`imp-${key}-${field}`);
  const it = findItem(key);
  if (el && it) el.value = it.fields[field] ?? '';
}

// Runs the checks again and redraws only the parts that changed.
const drawn = new Map();
function recheck() {
  session.results = I.checkDrafts(session.drafts, state.data, state.today);
  for (const block of session.drafts) {
    const card = document.querySelector(`[data-block-card="${block.index}"]`);
    const dog = state.data.dogs.find((d) => d.id === block.dogId);
    if (card) card.style.setProperty('--dog', dog ? dogColor(dog) : 'var(--line)');
    put(`[data-blockstatus="${block.index}"]`, blockStatusHtml(block));
    for (const it of block.items) {
      const r = session.results.get(it.key);
      put(`[data-head="${it.key}"]`, headHtml(it, r));
      put(`[data-status="${it.key}"]`, statusHtml(it, r));
    }
  }
  put('[data-totals]', totalsHtml());
}
function put(selector, html) {
  const el = document.querySelector(selector);
  if (!el || (drawn.get(selector) === html && el.innerHTML)) return;
  el.innerHTML = html;
  drawn.set(selector, html);
}

// Opens and scrolls to the first thing that needs fixing.
function showProblem(key) {
  const el = key.startsWith('block-')
    ? document.querySelector(`[data-block-card="${key.slice(6)}"]`)
    : document.getElementById('imp-' + key);
  if (!el) return;
  const details = el.querySelector('details.import-edit');
  if (details) details.open = true;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}


// ---------------------------------------------------------------------
//  Step 3: save
// ---------------------------------------------------------------------
async function saveImport() {
  if (session.saving || !session.drafts) return;
  session.results = I.checkDrafts(session.drafts, state.data, state.today);
  const problems = I.blockingProblems(session.drafts, session.results);
  if (problems.length) {
    recheck();
    showProblem(problems[0].key);
    toast(problems.length === 1 ? 'One thing needs fixing first' : `${problems.length} things need fixing first`);
    return;
  }
  const plan = I.planSave(session.drafts, session.results, state.data);
  if (!plan.total) { toast('Nothing new to save'); return; }

  const lines = perDogLines(plan);
  const ok = await askConfirm(`Save these?\n${lines.map((l) => `${l.name}: ${l.words}`).join('\n')}`, 'Save', 'primary');
  if (!ok) return;

  // New vaccines and visits go first (one at a time, so the doses can
  // point at them), then everything else, then changes to saved records.
  session.saving = true;
  recheck();
  const savedIds = {};
  let steps = 0;
  try {
    for (const t of plan.treatments) {
      const [row] = await db.insertRows('treatments', [t.row]);
      savedIds[t.ref] = row.id;
      steps++;
    }
    for (const e of plan.events) {
      const [row] = await db.insertRows('events', [I.fillRefs(e.row, savedIds)]);
      savedIds[e.ref] = row.id;
      steps++;
    }
    for (const table of ['doses', 'weights', 'identifiers']) {
      if (!plan[table].length) continue;
      await db.insertRows(table, plan[table].map((row) => I.fillRefs(row, savedIds)));
      steps++;
    }
    for (const u of plan.updates) {
      await db.updateRow(u.table, u.id, u.changes);
      steps++;
    }
  } catch (err) {
    // Reload, so whatever did get saved now shows as "Already saved",
    // and tapping Save again picks up where this stopped.
    session.saving = false;
    session.message = steps
      ? `Part of it was saved, then the database stopped with: “${db.friendlyError(err)}” ` +
        'What was saved now shows as “Already saved”. Check the rest and tap Save again.'
      : `Nothing was saved. ${db.friendlyError(err)}`;
    await refresh();
    window.scrollTo(0, 0);
    return;
  }
  session.saving = false;
  session.saved = lines;
  session.stage = 'done';
  session.drafts = null;
  session.results = null;
  session.text = '';
  session.message = '';
  await refresh();
  window.scrollTo(0, 0);
  toast('Saved');
}

// "Sunny: 1 visit, 5 doses and 1 weight", one per dog.
function perDogLines(plan) {
  const byDog = new Map();
  for (const p of plan.perDog) {
    if (!byDog.has(p.dogId)) byDog.set(p.dogId, []);
    byDog.get(p.dogId).push(p.counts);
  }
  const lines = [];
  for (const [dogId, list] of byDog) {
    const counts = addUp(list);
    const words = I.countWords(counts) + (counts.treatment
      ? ` (and ${counts.treatment} new kind${counts.treatment === 1 ? '' : 's'} of vaccine or medication)` : '');
    if (I.countWords(counts) === 'nothing new') continue;
    const dog = state.data.dogs.find((d) => d.id === dogId);
    lines.push({ dogId, name: dog ? shortName(dog) : 'Unknown dog', words });
  }
  return lines;
}

function donePage() {
  const lines = session.saved || [];
  return `
    <div id="import-page">
      <h1 class="page-title">Import saved</h1>
      <section class="card">
        <ul class="plain">${lines.map((l) => `<li><strong>${esc(l.name)}:</strong> ${esc(l.words)}</li>`).join('')}</ul>
        <div class="button-row">
          ${lines.map((l) => `<a class="btn" href="#/health/${l.dogId}">See ${esc(l.name)}'s records</a>`).join('')}
          <button class="btn primary" data-action="import-again">Import another</button>
        </div>
      </section>
    </div>`;
}


// ---------------------------------------------------------------------
//  Buttons
// ---------------------------------------------------------------------
export const importActions = {
  'import-check': checkPaste,
  'import-clear': () => {
    session.text = '';
    session.message = '';
    rerender();
    document.getElementById('import-text')?.focus();
  },
  'import-restart': async () => {
    if (session.edited && !(await askConfirm(
      'Go back to the pasted text? Changes made on this page will be dropped. Nothing has been saved.', 'Go back'))) return;
    session.stage = 'paste';
    session.drafts = null;
    session.results = null;
    session.message = '';
    rerender();
    window.scrollTo(0, 0);
  },
  'import-again': () => {
    session.stage = 'paste';
    session.saved = null;
    rerender();
  },
  'import-copy-request': () => copyText(I.claudeRequest(state.data), 'Request'),
  'import-save': saveImport,
};
