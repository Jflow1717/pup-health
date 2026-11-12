// =====================================================================
//  Home: the dashboard
// =====================================================================
//  Top:    "Coming up": everything overdue (red) or due within 14 days
//          (amber), with a "Mark as given" button for monthly meds.
//  Then:   "Size check", only when a dog is close to outgrowing its
//          Heartgard Plus or NexGard size, and a backup reminder when
//          there's been no backup for 30 days.
//  Below:  both dogs side by side: age, latest weight, and for each
//          vaccine and medication the last-given date and next due.
//  Bottom: tap-to-call for the regular and emergency vet.
// =====================================================================

import * as L from '../logic.js';
import { state, shortName } from '../store.js';
import { esc, statusChip, dogColor, dogTag } from '../ui.js';
import { SIZE_CHIPS } from './weight.js';
import { ID_KINDS } from './ids.js';
import { CONTACT_KINDS, telLink } from './contacts.js';
import { backupReminder } from './backup.js';

export function homeScreen() {
  const { data, today } = state;
  const dogs = L.sortedDogs(data.dogs);
  return `
    ${comingUpCard(data, today)}
    ${sizeCheckCard(data, today)}
    ${backupReminder()}
    <section class="card">
      <h2>Side by side</h2>
      <div class="sbs" style="--cols:${dogs.length}">
        <div class="sbs-row sbs-head">
          <div class="sbs-label"></div>
          ${dogs.map((d) => `
            <a class="sbs-cell dog-head" href="#/health/${d.id}" style="--dog:${dogColor(d)}">
              <strong>${esc(shortName(d))}</strong>
              <small>${esc(L.ageText(d.birth_date, today))}</small>
            </a>`).join('')}
        </div>
        ${weightRow(data, dogs, today)}
        ${ongoingRow(data, dogs)}
        ${treatmentRows(data, dogs, today, 'vaccine', 'Vaccines')}
        ${treatmentRows(data, dogs, today, 'medication', 'Medications')}
      </div>
      <p class="legend">
        ${statusChip('overdue', 'Overdue')} ${statusChip('soon', `Due within ${L.DUE_SOON_DAYS} days`)}
        ${statusChip('ok', 'OK')} ${statusChip('none', 'No due date')}
      </p>
    </section>
    ${vetsCard(data)}`;
}


// ---------------------------------------------------------------------
//  Coming up
// ---------------------------------------------------------------------
function comingUpCard(data, today) {
  const items = L.comingUp(data, today);
  const next = L.nextOkItem(data, today);
  const doseRows = items.map((g) => {
    const dogIds = g.dogs.map((d) => d.id).join(',');
    const button = g.treatment.repeat_days
      ? `<button class="btn small primary" data-action="mark-given" data-treatment="${g.treatment.id}" data-dogs="${dogIds}">Mark as given</button>`
      : `<button class="btn small" data-action="add-dose" data-treatment="${g.treatment.id}" data-dogs="${dogIds}">Log dose</button>`;
    return { days: g.status.days, html: `
      <li class="due-item ${g.status.level}">
        <div class="due-text">
          <strong>${esc(g.treatment.name)}</strong>
          <span class="due-dogs">${g.dogs.map(dogTag).join(' ')}</span>
          <span class="due-when">${statusChip(g.status.level, g.status.text)}
            <small>${g.status.days < 0 ? 'was due' : 'due'} ${esc(L.formatDate(g.next_due, { short: true, today }))}</small></span>
        </div>
        ${button}
      </li>` };
  });
  // Town license and insurance renewals go in the same list.
  const renewals = L.idRenewals(data, today);
  const renewalRows = renewals.map((r) => ({ days: r.status.days, html: `
      <li class="due-item ${r.status.level}">
        <div class="due-text">
          <strong>${esc(ID_KINDS[r.id.kind].label)}</strong>
          <span class="due-dogs">${dogTag(r.dog)}</span>
          <span class="due-when">${statusChip(r.status.level, r.status.text)}
            <small>renewal ${esc(L.formatDate(r.id.expires_on, { short: true, today }))}</small></span>
        </div>
        <button class="btn small" data-action="edit-id" data-id="${r.id.id}">Update</button>
      </li>` }));
  const rows = [...doseRows, ...renewalRows].sort((a, b) => a.days - b.days).map((r) => r.html).join('');

  const allClear = items.length === 0 && renewals.length === 0
    ? `<p class="all-clear">Nothing overdue or due in the next ${L.DUE_SOON_DAYS} days.</p>` : '';
  const nextLine = next
    ? `<p class="muted next-up">After that: ${esc(next.treatment.name)}, ${esc(L.formatDate(next.last.next_due, { short: true, today }))}
       (in ${next.status.days} days).</p>` : '';

  return `
    <section class="card">
      <h2>Coming up</h2>
      ${rows ? `<ul class="due-list">${rows}</ul>` : ''}
      ${allClear}
      ${nextLine}
    </section>`;
}


// ---------------------------------------------------------------------
//  Size check (only shown when something needs a look)
// ---------------------------------------------------------------------
function sizeCheckCard(data, today) {
  const warnings = L.sizeWarnings(data, today);
  if (warnings.length === 0) return '';
  const dogIds = L.sortedDogs(data.dogs).map((d) => d.id).join(',');
  return `
    <section class="card">
      <h2>Size check</h2>
      <ul class="size-list">${warnings.map((c) => `
        <li class="size-row ${SIZE_CHIPS[c.level].cls}">
          <div class="size-head">${dogTag(c.dog)} ${statusChip(SIZE_CHIPS[c.level].cls, SIZE_CHIPS[c.level].text)}</div>
          <p>${esc(c.message)}</p>
        </li>`).join('')}
      </ul>
      <div class="button-row">
        <button class="btn small" data-action="add-weight" data-dogs="${dogIds}">＋ Add weight</button>
        <a class="btn small subtle" href="#/weight/both">Growth chart</a>
      </div>
    </section>`;
}


// ---------------------------------------------------------------------
//  Side-by-side rows
// ---------------------------------------------------------------------
function weightRow(data, dogs, today) {
  const cells = dogs.map((d) => {
    const w = L.latestWeight(data.weights, d.id);
    return `<a class="sbs-cell" href="#/weight/${d.id}">${w
      ? `<strong class="big">${Number(w.weight_lbs)} lb</strong><small>${esc(L.formatDate(w.date, { short: true, today }))}</small>`
      : '<small class="muted">No weight yet</small>'}</a>`;
  }).join('');
  return `<div class="sbs-row"><div class="sbs-label">Latest weight</div>${cells}</div>`;
}

// Allergies and ongoing conditions (notes marked "still applies").
function ongoingRow(data, dogs) {
  const lists = dogs.map((d) => data.events.filter((e) => e.dog_id === d.id && e.ongoing));
  if (lists.every((l) => l.length === 0)) return '';
  const cells = lists.map((l) => `<div class="sbs-cell">${l.length
    ? l.map((e) => `<span class="ongoing">${esc(e.title)}</span>`).join('')
    : '<small class="muted">None</small>'}</div>`).join('');
  return `<div class="sbs-row"><div class="sbs-label">Allergies &amp; ongoing</div>${cells}</div>`;
}

function treatmentRows(data, dogs, today, kind, heading) {
  const list = L.sortedTreatments(data.treatments).filter((t) => t.kind === kind && t.active);
  if (list.length === 0) return '';
  const rows = list.map((t) => {
    const cells = dogs.map((d) => {
      const s = L.treatmentSummary(data, d.id, t, today);
      if (!s.last) {
        return `<a class="sbs-cell none" href="#/health/${d.id}"><small class="muted">Not given yet</small></a>`;
      }
      const due = s.last.next_due
        ? `${s.status.level === 'ok' ? 'Next ' + esc(L.formatDate(s.last.next_due, { short: true, today })) : esc(s.status.text)}`
        : 'No due date';
      return `
        <a class="sbs-cell ${s.status.level}" href="#/health/${d.id}/${t.id}">
          <span><small>Given</small> ${esc(L.formatDate(s.last.date_given, { short: true, today }))}</span>
          <span class="cell-due">${due}</span>
        </a>`;
    }).join('');
    return `<div class="sbs-row"><div class="sbs-label">${esc(t.name)}</div>${cells}</div>`;
  }).join('');
  return `<h3 class="sbs-group">${heading}</h3>${rows}`;
}


// ---------------------------------------------------------------------
//  Vets, one tap away
// ---------------------------------------------------------------------
function vetsCard(data) {
  const rows = ['regular_vet', 'emergency_vet'].map((kind) => {
    const c = data.contacts.find((x) => x.kind === kind);
    const label = CONTACT_KINDS[kind];
    if (!c) {
      return `<div class="vet-row"><span><small class="muted">${esc(label)}</small><span class="muted">Not added yet</span></span>
        <button class="btn small" data-action="add-contact" data-kind="${kind}">＋ Add</button></div>`;
    }
    return `<div class="vet-row"><span><small class="muted">${esc(label)}</small><strong>${esc(c.name)}</strong></span>
      ${c.phone ? `<a class="btn small primary" href="${telLink(c.phone)}">Call</a>`
        : `<button class="btn small" data-action="edit-contact" data-id="${c.id}">＋ Phone</button>`}</div>`;
  }).join('');
  return `
    <section class="card">
      <h2>Vets</h2>
      ${rows}
      <p class="next-up"><a href="#/contacts">All contacts ›</a></p>
    </section>`;
}
