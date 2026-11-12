// =====================================================================
//  Startup, logging in, and switching pages
// =====================================================================
//  Pages are picked by the part of the address after "#":
//    #/                 Home (dashboard)
//    #/health/<dog id>  one dog's vaccines, medications, visits, notes
//    #/weight/<dog id>  weights, size check, growth chart (or #/weight/both)
//    #/ids/<dog id>     the dog's details, microchip, AKC, tags, license, insurance
//    #/contacts         vets, breeder, and others
//    #/import           paste a block from Claude, check it, save it
//    #/summary/<dog id> vet summary to print (or #/summary/both)
//    #/backup           download every record (JSON or spreadsheets)
//    #/more             contacts, import/export, account, sign out
//
//  Buttons say what they do with data-action="..." (for example
//  data-action="mark-given"). One listener at the bottom of this file
//  finds the matching function in the lists of actions below.
// =====================================================================

import * as db from './db.js';
import { state, refresh, onChange } from './store.js';
import { esc, toast } from './ui.js';
import { homeScreen } from './screens/home.js';
import { healthScreen } from './screens/health.js';
import { weightScreen } from './screens/weight.js';
import { idsScreen } from './screens/ids.js';
import { contactsScreen } from './screens/contacts.js';
import { importScreen, importActions } from './screens/import.js';
import { summaryScreen, summaryActions } from './screens/summary.js';
import { backupScreen, backupActions } from './screens/backup.js';
import { mountWeightCharts } from './chart.js';
import { moreScreen, moreActions } from './screens/more.js';
import { doseActions } from './forms/dose-form.js';
import { markGivenActions } from './forms/mark-given.js';
import { eventActions } from './forms/event-form.js';
import { treatmentActions } from './forms/treatment-form.js';
import { weightActions } from './forms/weight-form.js';
import { idActions } from './forms/id-form.js';
import { contactActions } from './forms/contact-form.js';

const main = document.getElementById('app');

const actions = {
  ...doseActions,
  ...markGivenActions,
  ...eventActions,
  ...treatmentActions,
  ...weightActions,
  ...idActions,
  ...contactActions,
  ...moreActions,
  ...importActions,
  ...summaryActions,
  ...backupActions,
  'sign-out': signOutNow,
};


// ---------------------------------------------------------------------
//  Startup
// ---------------------------------------------------------------------
async function boot() {
  try {
    await db.start();
  } catch (err) {
    return showMessage('Couldn\'t start', db.friendlyError(err));
  }
  if (db.mode === 'setup') {
    return showMessage('Almost ready',
      'This app isn\'t connected to its database yet. Follow SETUP.md, then put the Project URL and publishable key in js/config.js.');
  }
  if (db.mode === 'demo') {
    const badge = document.getElementById('mode-badge');
    badge.textContent = 'Demo · not saved';
    badge.title = 'Practice copy of the starter records. Changes vanish when the page reloads.';
    badge.hidden = false;
  }

  state.user = await db.currentUser();
  // Demo mode skips the login screen (it has no real logins).
  if (!state.user && db.mode === 'demo') state.user = await db.signIn('', '');
  if (!state.user) return showLogin();
  await enterApp();
}

async function enterApp() {
  try {
    if (!(await db.isHouseholdMember())) {
      document.body.classList.remove('signed-in');
      main.innerHTML = `
        <section class="card narrow">
          <h1>Not on the household list</h1>
          <p>You're logged in as <strong>${esc(state.user.email)}</strong>, but that email isn't on the
          household list, so no records are shown.</p>
          <p class="muted">To add it, see SETUP.md step 3.</p>
          <button class="btn" data-action="sign-out">Log out</button>
        </section>`;
      return;
    }
    document.body.classList.add('signed-in');
    onChange(render);
    await refresh();
  } catch (err) {
    showMessage('Couldn\'t load the records', db.friendlyError(err));
  }
}

function showMessage(title, text) {
  document.body.classList.remove('signed-in');
  main.innerHTML = `<section class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
}


// ---------------------------------------------------------------------
//  Logging in and out
// ---------------------------------------------------------------------
function showLogin(errorText = '') {
  document.body.classList.remove('signed-in');
  main.innerHTML = `
    <section class="card narrow">
      <h1>Log in</h1>
      <p class="muted">Sunny and Chomper's health records. Household members only.</p>
      <form id="login-form" class="stack">
        <label class="field"><span>Email</span>
          <input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert" ${errorText ? '' : 'hidden'}>${esc(errorText)}</p>
        <button class="btn primary" type="submit">Log in</button>
      </form>
    </section>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      state.user = await db.signIn(form.email.value, form.password.value);
      await enterApp();
    } catch (err) {
      showLogin(db.friendlyError(err));
    }
  });
}

async function signOutNow() {
  await db.signOut();
  state.user = null;
  state.data = null;
  location.hash = '#/';
  showLogin();
}


// ---------------------------------------------------------------------
//  Drawing the current page
// ---------------------------------------------------------------------
function render() {
  if (!state.data) return;
  const [, page, id] = (location.hash || '#/').split('/');
  let html;
  let tab = page || 'home';
  if (page === 'health') html = healthScreen(id);
  else if (page === 'weight') html = weightScreen(id);
  else if (page === 'ids') html = idsScreen(id);
  else if (page === 'contacts') { html = contactsScreen(); tab = 'more'; }
  else if (page === 'import') { html = importScreen(); tab = 'more'; }
  else if (page === 'summary') { html = summaryScreen(id); tab = 'more'; }
  else if (page === 'backup') { html = backupScreen(); tab = 'more'; }
  else if (page === 'more') html = moreScreen();
  else { html = homeScreen(); tab = 'home'; }

  main.innerHTML = html;
  mountWeightCharts();   // charts are drawn once the page knows its width
  document.querySelectorAll('.tabbar a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === tab));
}

// Redraw charts when the screen turns or the window is resized.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.data) mountWeightCharts(); }, 150);
});

// A new page starts at the top, unless the address names one item to
// jump to (#/health/<dog id>/<treatment id>, from a dashboard tap).
window.addEventListener('hashchange', () => {
  render();
  const focus = (location.hash || '').split('/')[3];
  const target = focus && document.getElementById('t-' + focus);
  if (target) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
});

// Every button with data-action="..." lands here.
document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const run = actions[el.dataset.action];
  if (!run) return;
  event.preventDefault();
  Promise.resolve(run(el.dataset, el)).catch((err) => toast(db.friendlyError(err)));
});

// When the app comes back on screen (switching back to it on a phone),
// reload, so changes made on the other phone show up.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && !document.getElementById('sheet').open) {
    refresh().catch(() => {});
  }
});

// Lets the app open quickly from the home screen, even on a weak
// signal, and keeps updates clean (see sw.js). Browsers without
// support simply skip it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}

boot();
