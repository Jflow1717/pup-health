// =====================================================================
//  More: contacts, import, vet summary, backups, home-screen install,
//  who's logged in, log out
// =====================================================================

import * as db from '../db.js';
import { state, refresh } from '../store.js';
import { esc, toast } from '../ui.js';
import { lastBackupWords } from './backup.js';

export function moreScreen() {
  const counts = ['doses', 'weights', 'events'].map((t) => `${state.data[t].length} ${t === 'events' ? 'visits & notes' : t}`);
  const contacts = state.data.contacts.length;
  return `
    <nav class="card menu" aria-label="More">
      <a href="#/contacts"><strong>Contacts</strong><small class="muted">Vets, breeder, and others (${contacts})</small><span aria-hidden="true">›</span></a>
      <a href="#/import"><strong>Import from Claude</strong><small class="muted">Paste what Claude read from vet paperwork</small><span aria-hidden="true">›</span></a>
      <a href="#/summary"><strong>Vet summary</strong><small class="muted">A page per dog to print, for boarding, daycare, or groomers</small><span aria-hidden="true">›</span></a>
      <a href="#/backup"><strong>Back up</strong><small class="muted">${esc(lastBackupWords())}</small><span aria-hidden="true">›</span></a>
    </nav>
    ${installCard()}
    <section class="card">
      <h2>Account</h2>
      ${db.mode === 'demo'
        ? `<p><strong>Demo mode.</strong> This is a practice copy of the starter records, on this computer only.
           Changes disappear when the page reloads.</p>`
        : `<p>Logged in as <strong>${esc(state.user.email)}</strong>.</p>`}
      <p class="muted">${esc(counts.join(' · '))}</p>
      <div class="button-row">
        <button class="btn" data-action="reload">Reload records</button>
        <button class="btn" data-action="sign-out">Log out</button>
      </div>
    </section>`;
}

// How to put the app on the phone's home screen (hidden once it's
// opened from there).
function installCard() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return '';
  return `
    <details class="card install-card">
      <summary><strong>Put it on your phone's home screen</strong></summary>
      <p>It then opens like an app, full screen, with its own icon.</p>
      <ul class="plain">
        <li><strong>iPhone:</strong> open this page in Safari, tap the Share button, then <strong>Add to Home Screen</strong>.</li>
        <li><strong>Android:</strong> in Chrome, tap the ⋮ menu, then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</li>
      </ul>
      <p class="muted small">You stay logged in, so it opens straight to the dashboard.</p>
    </details>`;
}

export const moreActions = {
  reload: async () => {
    await refresh();
    toast('Records reloaded');
  },
};
