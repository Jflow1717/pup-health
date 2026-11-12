// =====================================================================
//  Contacts: vets, breeder, groomer ... (shared by both dogs)
// =====================================================================
//  #/contacts
//
//  Phone numbers are tap-to-call, emails tap-to-write, addresses open
//  in Maps, and each has a Copy button.
//  The regular vet, emergency vet, and breeder always have a spot,
//  even before they're filled in.
// =====================================================================

import { state } from '../store.js';
import { esc } from '../ui.js';

export const CONTACT_KINDS = {
  regular_vet: 'Regular vet',
  emergency_vet: 'Emergency vet',
  breeder: 'Breeder',
  groomer: 'Groomer',
  daycare: 'Daycare',
  boarding: 'Boarding',
  insurance: 'Insurance company',
  other: 'Other',
};
const ALWAYS_SHOWN = ['regular_vet', 'emergency_vet', 'breeder'];

export function contactsScreen() {
  const contacts = state.data.contacts;
  const sections = Object.entries(CONTACT_KINDS).map(([kind, label]) => {
    const list = contacts.filter((c) => c.kind === kind)
      .sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || a.name.localeCompare(b.name));
    if (list.length === 0 && !ALWAYS_SHOWN.includes(kind)) return '';
    if (list.length === 0) {
      return `
        <article class="card contact-card empty">
          <span class="contact-kind">${esc(label)}</span>
          <p class="muted">Not added yet.</p>
          <button class="btn small" data-action="add-contact" data-kind="${kind}">＋ Add ${esc(label.toLowerCase())}</button>
        </article>`;
    }
    return list.map((c) => contactCard(c, label)).join('');
  }).join('');

  return `
    <h1 class="page-title">Contacts</h1>
    ${sections}
    <p class="center"><button class="btn subtle" data-action="add-contact" data-kind="other">＋ Add a contact</button></p>`;
}

function contactCard(c, label) {
  const rows = [];
  if (c.phone) {
    rows.push(`
      <div class="contact-row">
        <a class="btn small primary" href="${telLink(c.phone)}">Call ${esc(c.phone)}</a>
        <button class="btn small" data-action="copy" data-text="${esc(c.phone)}" data-label="Phone number">Copy</button>
      </div>`);
  }
  if (c.email) {
    rows.push(`
      <div class="contact-row">
        <a class="contact-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>
        <button class="btn small" data-action="copy" data-text="${esc(c.email)}" data-label="Email">Copy</button>
      </div>`);
  }
  if (c.address) {
    rows.push(`
      <div class="contact-row">
        <span class="contact-address">${esc(c.address)}</span>
        <a class="btn small" href="${mapLink(c.address)}" target="_blank" rel="noopener">Map</a>
        <button class="btn small" data-action="copy" data-text="${esc(c.address)}" data-label="Address">Copy</button>
      </div>`);
  }
  const site = safeWebsite(c.website);
  if (site) {
    rows.push(`<div class="contact-row"><a class="contact-link" href="${esc(site)}" target="_blank" rel="noopener">${esc(new URL(site).host)}</a></div>`);
  }
  return `
    <article class="card contact-card">
      <span class="contact-kind">${esc(label)}</span>
      <h3>${esc(c.name)}</h3>
      ${c.person ? `<p class="muted">${esc(c.person)}</p>` : ''}
      ${rows.join('')}
      ${c.notes ? `<p class="note-text">${esc(c.notes)}</p>` : ''}
      <div class="button-row"><button class="btn small subtle" data-action="edit-contact" data-id="${c.id}">Edit</button></div>
    </article>`;
}

// "(315) 555-0123" -> "tel:3155550123"
export function telLink(phone) {
  return 'tel:' + String(phone).replace(/[^\d+]/g, '');
}

function mapLink(address) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
}

// Only ordinary web addresses become links. "petvet.com" gets https://
// in front. Anything else (or a typo) is not linked.
export function safeWebsite(text) {
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : 'https://' + text;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
