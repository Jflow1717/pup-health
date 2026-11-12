// =====================================================================
//  Vet summary: a page per dog to print or save as a PDF
// =====================================================================
//  #/summary/<dog id>   or   #/summary/both  (each dog on its own page)
//
//  For boarding, daycare, groomers, or a new vet: the dog's details,
//  IDs, vaccines (newest first, with earlier doses underneath),
//  medications, allergies and reactions, and the vets' phone numbers.
//
//  Printing uses the phone's or computer's own print screen, which can
//  also save a PDF. Everything above the page itself (the dog picker,
//  the options, the buttons) is left off the printout.
// =====================================================================

import * as L from '../logic.js';
import { state, shortName, rerender } from '../store.js';
import { esc, dogColor, groupDigits } from '../ui.js';
import { ID_KINDS } from './ids.js';
import { CONTACT_KINDS } from './contacts.js';

// What to include. AKC and insurance numbers are left off unless
// ticked: boarding and groomers don't need them.
const include = { earlier: true, akc: false, insurance: false };
let lastChoice = null;   // remembers the dog (or "both") for next time

export function summaryScreen(choice) {
  const { data, today } = state;
  const dogs = L.sortedDogs(data.dogs);
  if (!dogs.length) return '<section class="card"><p>No dogs yet.</p></section>';
  const pick = choice === 'both' || dogs.some((d) => d.id === choice) ? choice
    : lastChoice || dogs[0].id;
  lastChoice = pick;
  const shown = pick === 'both' ? dogs : dogs.filter((d) => d.id === pick);

  const switcher = [...dogs.map((d) => `
      <a href="#/summary/${d.id}" class="${d.id === pick ? 'on' : ''}" style="--dog:${dogColor(d)}">${esc(shortName(d))}</a>`),
    `<a href="#/summary/both" class="${pick === 'both' ? 'on' : ''}" style="--dog:var(--accent)">Both</a>`].join('');
  const option = (key, words) => `
      <label class="field check"><input type="checkbox" data-action="summary-option" data-key="${key}"${include[key] ? ' checked' : ''}>
        <span>${words}</span></label>`;

  return `
    <div class="no-print">
      <h1 class="page-title">Vet summary</h1>
      <nav class="dog-switch" aria-label="Choose a dog">${switcher}</nav>
      <section class="card">
        <p>A page to print or save as a PDF for boarding, daycare, groomers, or a new vet.</p>
        <fieldset class="field summary-options"><legend>Also include</legend>
          ${option('earlier', 'Earlier vaccine doses (not just the latest)')}
          ${option('akc', 'AKC number')}
          ${option('insurance', 'Insurance policy')}
        </fieldset>
        <div class="button-row"><button class="btn primary" data-action="print-summary">Print or save as PDF</button></div>
        <p class="muted small">To keep a PDF: on a computer, pick “Save as PDF” in the print window. On an iPhone,
          tap Share at the top of the print screen, then Save to Files.</p>
      </section>
    </div>
    ${shown.map((dog) => dogSheet(dog, data, today)).join('')}`;
}

export const summaryActions = {
  'summary-option': (ds) => {
    include[ds.key] = !include[ds.key];
    rerender();
  },
  'print-summary': () => window.print(),
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso) => (iso ? L.formatDate(iso) : '');
const joined = (parts, sep = ' · ') => parts.filter(Boolean).join(sep);


// ---------------------------------------------------------------------
//  One dog's page
// ---------------------------------------------------------------------
function dogSheet(dog, data, today) {
  const weight = L.latestWeight(data.weights, dog.id);
  const facts = [
    ['Dog', joined([cap(dog.sex || ''), dog.breed], ' ')],
    ['Born', dog.birth_date ? `${day(dog.birth_date)} (${L.ageText(dog.birth_date, today)})` : ''],
    ['Collar', dog.collar_color ? cap(dog.collar_color) : ''],
    ['Weight', weight ? `${Number(weight.weight_lbs)} lb on ${day(weight.date)}` : ''],
    ['Notes', dog.notes || ''],
  ].filter(([, v]) => v);

  return `
    <article class="card summary-sheet">
      <header class="summary-head" style="--dog:${dogColor(dog)}">
        <h2>${esc(dog.name)}</h2>
        <p class="muted">Health summary · ${esc(day(today))}</p>
      </header>
      ${factsList(facts)}
      <h3>IDs</h3>
      ${idsList(dog, data)}
      <h3>Vaccines</h3>
      ${doseTable(dog, data, today, 'vaccine')}
      <h3>Medications</h3>
      ${doseTable(dog, data, today, 'medication')}
      <h3>Allergies, reactions, and ongoing conditions</h3>
      ${conditionsList(dog, data)}
      <h3>Vets</h3>
      ${vetsList(data)}
      <p class="summary-foot">From ${esc(dog.name)}'s health records, ${esc(day(today))}. The vet can confirm any of this.</p>
    </article>`;
}

function factsList(pairs) {
  if (!pairs.length) return '';
  return `<dl class="summary-facts">${pairs.map(([k, v]) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

// The newest of each kind of ID (microchip, rabies tag, license ...).
function idsList(dog, data) {
  const kinds = ['microchip', 'rabies_tag', 'town_license', 'other'];
  if (include.akc) kinds.splice(1, 0, 'akc');
  if (include.insurance) kinds.push('insurance');
  const rows = [];
  for (const kind of kinds) {
    const list = data.identifiers.filter((i) => i.dog_id === dog.id && i.kind === kind).sort(L.idNewerFirst);
    const shown = kind === 'other' ? list : list.slice(0, 1);
    for (const id of shown) {
      const k = ID_KINDS[kind];
      // "Registry: AKC Reunite", or for tags "issued Oct 29, 2026 by City Vet".
      const byWhom = k.issuer === 'Issued by';
      const extra = joined([
        id.issuer && !byWhom ? `${k.issuer}: ${id.issuer}` : (kind === 'microchip' && !id.issuer ? 'Registry not recorded' : ''),
        id.issued_on ? `issued ${day(id.issued_on)}${byWhom && id.issuer ? ` by ${id.issuer}` : ''}` : (byWhom && id.issuer ? `issued by ${id.issuer}` : ''),
        id.expires_on ? `${k.renews ? 'renews' : 'expires'} ${day(id.expires_on)}` : '',
        kind === 'insurance' ? id.details : '',
      ]);
      rows.push([k.label, `${groupDigits(id.value)}${extra ? ` (${extra})` : ''}`]);
    }
  }
  return rows.length ? factsList(rows) : '<p class="muted">No IDs recorded.</p>';
}

// Vaccines: every dose, newest first under each vaccine (or just the
// newest, if "earlier doses" is off). Medications: just the newest.
function doseTable(dog, data, today, kind) {
  const treatments = L.treatmentsToShow(data, dog.id).filter((t) => t.kind === kind);
  const rows = [];
  const missing = [];
  for (const t of treatments) {
    const doses = L.dosesFor(data.doses, dog.id, t.id);
    if (!doses.length) { if (t.active) missing.push(t.name); continue; }
    const keep = kind === 'vaccine' && include.earlier ? doses : doses.slice(0, 1);
    keep.forEach((d, i) => {
      const due = i === 0 ? L.summaryDueText(d.next_due, today) : '';
      const overdue = due.startsWith('OVERDUE');
      rows.push(`
        <tr class="${i ? 'earlier' : ''}">
          <td data-label="${kind === 'vaccine' ? 'Vaccine' : 'Medication'}">${i ? '' : `<strong>${esc(t.name)}</strong>`}</td>
          <td data-label="Given" class="date">${esc(day(d.date_given))}</td>
          <td data-label="Next due" class="date${overdue ? ' overdue-text' : ''}">${esc(due)}</td>
          <td data-label="Details">${esc(joined([d.product_name, d.size, d.lot_number && `lot ${d.lot_number}`,
            d.lot_expires && `lot expires ${day(d.lot_expires)}`]))}</td>
          <td data-label="Given by">${esc(joined([d.vet, d.clinic], ', '))}</td>
        </tr>`);
    });
  }
  const none = missing.length ? `<p class="muted small">Not recorded: ${esc(missing.join(', '))}.</p>` : '';
  if (!rows.length) return `<p class="muted">None recorded.</p>${none}`;
  return `
    <table class="summary-table">
      <thead><tr><th>${kind === 'vaccine' ? 'Vaccine' : 'Medication'}</th><th>Given</th><th>Next due</th><th>Details</th><th>Given by</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>${none}`;
}

// Allergies and reactions (ever), plus anything marked "still applies".
function conditionsList(dog, data) {
  const list = data.events
    .filter((e) => e.dog_id === dog.id && (e.ongoing || e.kind === 'allergy' || e.kind === 'reaction'))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) return '<p>None recorded.</p>';
  return `<ul class="summary-list">${list.map((e) => `
    <li><strong>${esc(e.title)}</strong>${e.ongoing ? ' (still applies)' : ''} · ${esc(day(e.date))}
      ${e.details ? `<br><span class="muted">${esc(e.details)}</span>` : ''}</li>`).join('')}</ul>`;
}

function vetsList(data) {
  const rows = ['regular_vet', 'emergency_vet'].map((kind) => {
    const c = data.contacts.find((x) => x.kind === kind);
    return c ? [CONTACT_KINDS[kind], joined([c.name, c.person, c.phone, c.address && c.address.replace(/\s*\n\s*/g, ', ')])] : null;
  }).filter(Boolean);
  return rows.length ? factsList(rows) : '<p class="muted">No vet recorded.</p>';
}
