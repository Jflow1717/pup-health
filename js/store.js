// =====================================================================
//  What the app currently knows, and how it saves changes
// =====================================================================
//  state.data holds every record (loaded by db.loadAll). Screens read
//  from it. After any save, refresh() reloads everything from the
//  database and redraws the page, so what you see is always what's
//  actually stored.
// =====================================================================

import * as db from './db.js';
import { todayISO } from './logic.js';
import { toast, closeSheet } from './ui.js';

export const state = {
  data: null,        // { dogs, treatments, events, doses, weights, identifiers, contacts }
  lastBackup: null,  // { exported_at, kind } of the newest backup, or null
  user: null,        // { email } of whoever is logged in
  today: todayISO(),
};

// app.js tells the store how to redraw the page.
let redraw = () => {};
export function onChange(fn) { redraw = fn; }

// Redraws the page without reloading the records (for a page that
// keeps its own state, like Import).
export function rerender() { redraw(); }

export async function refresh() {
  [state.data, state.lastBackup] = await Promise.all([db.loadAll(), db.lastBackup()]);
  state.today = todayISO();
  redraw();
}

// Wraps every save: runs it, closes the form, reloads, says "Saved".
// If the database refuses, the form stays open with a plain-English
// reason (ui.openSheet shows whatever this throws).
export async function save(work, message = 'Saved') {
  try {
    await work();
  } catch (err) {
    throw new Error(db.friendlyError(err));
  }
  closeSheet();
  await refresh();
  toast(message);
}

// Handy lookups.
export const dogById = (id) => state.data.dogs.find((d) => d.id === id);
export const treatmentById = (id) => state.data.treatments.find((t) => t.id === id);
export const shortName = (dog) => dog.short_name || dog.name;
