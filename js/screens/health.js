// =====================================================================
//  Health: one dog's vaccines, medications, visits, and notes
// =====================================================================
//  For each vaccine and medication, the "last given" date and next due
//  come first, with the full history of doses underneath (newest
//  first). Tap a dose to see every detail or change it.
//  Then visits and notes (vet visits, reactions, allergies, illnesses).
// =====================================================================

import * as L from '../logic.js';
import { state, shortName, treatmentById } from '../store.js';
import { esc, statusChip, dogColor } from '../ui.js';

export const KIND_WORDS = {
  vet_visit: 'Vet visit', reaction: 'Reaction', allergy: 'Allergy',
  illness: 'Illness', injury: 'Injury', note: 'Note',
};

// Remembers which dog was showing, for the Health tab.
let lastDogId = null;

export function healthScreen(dogId) {
  const { data, today } = state;
  const dogs = L.sortedDogs(data.dogs);
  const dog = dogs.find((d) => d.id === dogId) || dogs.find((d) => d.id === lastDogId) || dogs[0];
  if (!dog) return '<section class="card"><p>No dogs yet.</p></section>';
  lastDogId = dog.id;

  const switcher = dogs.map((d) => `
    <a href="#/health/${d.id}" class="${d.id === dog.id ? 'on' : ''}" style="--dog:${dogColor(d)}">${esc(shortName(d))}</a>`).join('');

  const shown = L.treatmentsToShow(data, dog.id);
  const vaccines = shown.filter((t) => t.kind === 'vaccine');
  const meds = shown.filter((t) => t.kind === 'medication');

  return `
    <nav class="dog-switch" aria-label="Choose a dog">${switcher}</nav>
    <section class="dog-banner" style="--dog:${dogColor(dog)}">
      <h1>${esc(dog.name)}</h1>
      <p>${esc([dog.sex && cap(dog.sex), dog.breed].filter(Boolean).join(' '))}
        ${dog.birth_date ? `· born ${esc(L.formatDate(dog.birth_date))} (${esc(L.ageText(dog.birth_date, today))})` : ''}
        ${dog.collar_color ? `· ${esc(dog.collar_color)} collar` : ''}</p>
      <div class="button-row">
        <button class="btn primary" data-action="add-dose" data-dogs="${dog.id}">＋ Add dose</button>
        <button class="btn" data-action="add-event" data-dog="${dog.id}">＋ Add visit or note</button>
      </div>
    </section>

    <h2 class="section-title">Vaccines</h2>
    ${vaccines.map((t) => treatmentCard(data, dog, t, today)).join('') || '<p class="muted">None yet.</p>'}

    <h2 class="section-title">Medications</h2>
    ${meds.map((t) => treatmentCard(data, dog, t, today)).join('') || '<p class="muted">None yet.</p>'}

    <h2 class="section-title">Visits &amp; notes</h2>
    ${eventsList(data, dog, today)}

    <p class="center"><button class="btn subtle" data-action="add-treatment">＋ New kind of vaccine or medication</button></p>`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);


// ---------------------------------------------------------------------
//  One vaccine or medication: last given, then the history
// ---------------------------------------------------------------------
function treatmentCard(data, dog, t, today) {
  const s = L.treatmentSummary(data, dog.id, t, today);
  const last = s.last;
  const markButton = t.repeat_days
    ? `<button class="btn small primary" data-action="mark-given" data-treatment="${t.id}" data-dogs="${dog.id}">Mark as given</button>` : '';

  const summary = last ? `
      <dl class="last-given">
        <div><dt>Last given</dt><dd><strong>${esc(L.formatDate(last.date_given))}</strong></dd></div>
        <div><dt>Next due</dt><dd>${last.next_due
          ? `<strong>${esc(L.formatDate(last.next_due))}</strong> <small>${esc(s.status.text)}</small>`
          : '<span class="muted">No due date</span>'}</dd></div>
      </dl>` : '<p class="muted">Not given yet.</p>';

  return `
    <article class="card t-card ${s.status.level}" id="t-${t.id}">
      <header class="t-head">
        <h3>${esc(t.name)}${t.active ? '' : ' <small class="muted">(not in use)</small>'}</h3>
        ${statusChip(s.status.level, last ? L.STATUS_WORDS[s.status.level] : 'Not given')}
      </header>
      ${summary}
      <div class="button-row">
        ${markButton}
        <button class="btn small" data-action="add-dose" data-treatment="${t.id}" data-dogs="${dog.id}">＋ Add dose</button>
        <button class="btn small subtle" data-action="edit-treatment" data-id="${t.id}">Edit</button>
      </div>
      ${s.history.length ? `
      <details class="history" open>
        <summary>History (${s.history.length} dose${s.history.length === 1 ? '' : 's'})</summary>
        <ol>${s.history.map((d) => doseLine(d, today)).join('')}</ol>
      </details>` : ''}
    </article>`;
}

// One dose in the history. Only filled-in details are shown; tap to
// see or change everything.
function doseLine(d, today) {
  const bits = [
    d.product_name && esc(d.product_name),
    d.size && esc(d.size),
    d.lot_number && `Lot ${esc(d.lot_number)}${d.lot_expires ? ` (expires ${esc(L.formatDate(d.lot_expires))})` : ''}`,
  ].filter(Boolean);
  const where = [d.vet, d.clinic].filter(Boolean).map(esc).join(' · ');
  const due = [
    d.next_due && `Next due ${esc(L.formatDate(d.next_due))}`,
    d.duration && esc(d.duration),
  ].filter(Boolean).join(' · ');
  return `
    <li>
      <button class="dose-line" data-action="edit-dose" data-id="${d.id}">
        <span class="dose-date">${esc(L.formatDate(d.date_given))}</span>
        ${bits.length ? `<span>${bits.join(' · ')}</span>` : ''}
        ${where ? `<span class="muted">${where}</span>` : ''}
        ${due ? `<span class="muted">${due}</span>` : ''}
        ${d.notes ? `<span class="note-text">${esc(d.notes)}</span>` : ''}
      </button>
    </li>`;
}


// ---------------------------------------------------------------------
//  Visits and notes
// ---------------------------------------------------------------------
function eventsList(data, dog, today) {
  const list = data.events
    .filter((e) => e.dog_id === dog.id)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : ((a.created_at || '') < (b.created_at || '') ? 1 : -1)));
  if (list.length === 0) return '<p class="muted">No visits or notes yet.</p>';

  return `<ol class="events">${list.map((e) => {
    // Doses that were recorded as part of this visit.
    const given = data.doses
      .filter((d) => d.event_id === e.id)
      .map((d) => treatmentById(d.treatment_id))
      .filter(Boolean)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((t) => esc(t.name));
    const weight = data.weights.find((w) => w.event_id === e.id);
    const vitals = L.vitalsList(e.vitals);
    if (weight) vitals.unshift(`Weight ${Number(weight.weight_lbs)} lb`);
    const where = [e.clinic, e.vet].filter(Boolean).map(esc).join(' · ');
    return `
      <li>
        <button class="card event ${e.kind}" data-action="edit-event" data-id="${e.id}">
          <span class="event-top">
            <span class="kind-tag ${e.kind}">${esc(KIND_WORDS[e.kind] || e.kind)}</span>
            <span class="muted">${esc(L.formatDate(e.date))}</span>
            ${e.ongoing ? '<span class="kind-tag ongoing">Still applies</span>' : ''}
          </span>
          <strong>${esc(e.title)}</strong>
          ${where ? `<span class="muted">${where}</span>` : ''}
          ${vitals.length ? `<span>${vitals.map(esc).join(' · ')}</span>` : ''}
          ${given.length ? `<span><small>Given:</small> ${given.join(', ')}</span>` : ''}
          ${e.details ? `<span class="note-text">${esc(e.details)}</span>` : ''}
        </button>
      </li>`;
  }).join('')}</ol>`;
}
