// =====================================================================
//  IDs: one dog's details, microchip, AKC, rabies tag, town license,
//  insurance. Every number has a Copy button.
// =====================================================================
//  #/ids/<dog id>
//
//  A dog can have more than one of a kind (a new rabies tag or town
//  license each year). The newest shows first; older ones are listed
//  under "Earlier" so nothing is lost.
// =====================================================================

import * as L from '../logic.js';
import { state, shortName } from '../store.js';
import { esc, statusChip, dogColor, groupDigits } from '../ui.js';

// How each kind of ID is labeled. "issuer" is what the issuer box is
// called for that kind; "renews" means it has a renewal date.
export const ID_KINDS = {
  microchip:    { label: 'Microchip', valueLabel: 'Microchip number', issuer: 'Registry',
                  issuerHint: 'Where the chip is registered, e.g. AKC Reunite, PetLink, HomeAgain' },
  akc:          { label: 'AKC registration', valueLabel: 'AKC number', issuer: 'Registered with' },
  rabies_tag:   { label: 'Rabies tag', valueLabel: 'Tag number', issuer: 'Issued by' },
  town_license: { label: 'Town dog license', valueLabel: 'License number', issuer: 'Town', renews: true },
  insurance:    { label: 'Insurance', valueLabel: 'Policy number', issuer: 'Company', renews: true,
                  detailsHint: 'Plan, claims phone number, deductible, reimbursement, anything else' },
  other:        { label: 'Other ID', valueLabel: 'Number', issuer: 'Issued by' },
};

let lastDogId = null;   // remembers which dog was showing, for the IDs tab

export function idsScreen(dogId) {
  const { data, today } = state;
  const dogs = L.sortedDogs(data.dogs);
  const dog = dogs.find((d) => d.id === dogId) || dogs.find((d) => d.id === lastDogId) || dogs[0];
  if (!dog) return '<section class="card"><p>No dogs yet.</p></section>';
  lastDogId = dog.id;

  const switcher = dogs.map((d) => `
    <a href="#/ids/${d.id}" class="${d.id === dog.id ? 'on' : ''}" style="--dog:${dogColor(d)}">${esc(shortName(d))}</a>`).join('');
  const ids = data.identifiers.filter((i) => i.dog_id === dog.id);

  // Every kind gets a card, except "other", which only shows when used.
  const cards = Object.keys(ID_KINDS)
    .filter((kind) => kind !== 'other' || ids.some((i) => i.kind === 'other'))
    .map((kind) => idCard(dog, kind, ids.filter((i) => i.kind === kind).sort(L.idNewerFirst), today))
    .join('');

  return `
    <nav class="dog-switch" aria-label="Choose a dog">${switcher}</nav>
    <section class="dog-banner" style="--dog:${dogColor(dog)}">
      <h1>${esc(dog.name)}</h1>
      <p>${esc([dog.sex && cap(dog.sex), dog.breed].filter(Boolean).join(' '))}
        ${dog.birth_date ? `· born ${esc(L.formatDate(dog.birth_date))}` : ''}
        ${dog.collar_color ? `· ${esc(dog.collar_color)} collar` : ''}</p>
      ${dog.notes ? `<p class="note-text">${esc(dog.notes)}</p>` : ''}
      <div class="button-row">
        <button class="btn small" data-action="edit-dog" data-id="${dog.id}">Edit ${esc(shortName(dog))}'s details</button>
      </div>
    </section>
    ${cards}
    <p class="center"><button class="btn subtle" data-action="add-id" data-dog="${dog.id}" data-kind="other">＋ Add another kind of ID</button></p>`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function idCard(dog, kind, list, today) {
  const k = ID_KINDS[kind];
  const [current, ...earlier] = list;
  if (!current) {
    return `
      <article class="card id-card empty">
        <header class="id-head"><h3>${esc(k.label)}</h3></header>
        <p class="muted">Not added yet.</p>
        <button class="btn small" data-action="add-id" data-dog="${dog.id}" data-kind="${kind}">＋ Add ${esc(k.label.toLowerCase())}</button>
      </article>`;
  }
  const renewal = k.renews && current.expires_on ? L.renewalStatus(current.expires_on, today) : null;
  return `
    <article class="card id-card">
      <header class="id-head">
        <h3>${esc(k.label)}</h3>
        ${renewal ? statusChip(renewal.level, renewal.text) : ''}
      </header>
      ${valueRow(current, k)}
      ${idDetails(current, k, kind)}
      <div class="button-row">
        <button class="btn small subtle" data-action="edit-id" data-id="${current.id}">Edit</button>
        <button class="btn small subtle" data-action="add-id" data-dog="${dog.id}" data-kind="${kind}">＋ Add a newer one</button>
      </div>
      ${earlier.length ? `
        <details class="history">
          <summary>Earlier (${earlier.length})</summary>
          <ol>${earlier.map((i) => `<li class="earlier-id">${valueRow(i, k, true)}${idDetails(i, k, kind)}
            <button class="btn small subtle" data-action="edit-id" data-id="${i.id}">Edit</button></li>`).join('')}</ol>
        </details>` : ''}
    </article>`;
}

// The number itself, big and easy to read, with its Copy button.
function valueRow(id, k, small = false) {
  return `
    <div class="id-value${small ? ' small' : ''}">
      <span class="mono">${esc(groupDigits(id.value))}</span>
      <button class="btn small copy-btn" data-action="copy" data-text="${esc(id.value)}" data-label="${esc(k.valueLabel)}">Copy</button>
    </div>`;
}

function idDetails(id, k, kind) {
  const lines = [];
  if (id.issuer) lines.push(`<span><small>${esc(k.issuer)}:</small> ${esc(id.issuer)}</span>`);
  else if (kind === 'microchip') lines.push('<span class="missing">Registry not added yet. Tap Edit to add it.</span>');
  if (id.issued_on) lines.push(`<span><small>Issued:</small> ${esc(L.formatDate(id.issued_on))}</span>`);
  if (id.expires_on) lines.push(`<span><small>${k.renews ? 'Renewal' : 'Expires'}:</small> ${esc(L.formatDate(id.expires_on))}</span>`);
  if (id.details) lines.push(`<span class="note-text">${esc(id.details)}</span>`);
  return lines.length ? `<div class="id-details">${lines.join('')}</div>` : '';
}
