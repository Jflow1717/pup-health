// =====================================================================
//  Back up: download every record
// =====================================================================
//  #/backup
//
//  Two kinds of file (built by backup.js):
//    Full backup (JSON)    complete; can be loaded back in if anything
//                          is ever lost (SETUP.md, "Restoring")
//    Spreadsheets (CSV)    for reading in Excel, Numbers, Google Sheets
//
//  Each backup is noted in the database, so every phone's dashboard can
//  say when the last one was, and suggest another after 30 days.
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import * as B from '../backup.js';
import { state, refresh } from '../store.js';
import { esc, toast, saveFile } from '../ui.js';

export function backupScreen() {
  const { data } = state;
  const counts = [
    [data.doses.length, 'dose', 'doses'], [data.weights.length, 'weight', 'weights'],
    [data.events.length, 'visit or note', 'visits and notes'], [data.identifiers.length, 'ID', 'IDs'],
    [data.contacts.length, 'contact', 'contacts'],
  ].map(([n, one, many]) => `${n} ${n === 1 ? one : many}`).join(', ');
  return `
    <h1 class="page-title">Back up</h1>
    <section class="card">
      <p>${esc(lastBackupWords())}</p>
      <div class="backup-choice">
        <button class="btn primary" data-action="backup-json">Full backup (JSON)</button>
        <p class="muted small">Every record exactly as stored: ${esc(counts)}.
          This is the one that can be loaded back in if anything is ever lost.</p>
      </div>
      <div class="backup-choice">
        <button class="btn" data-action="backup-csv">Spreadsheets (CSV)</button>
        <p class="muted small">One spreadsheet per kind of record, zipped into one file, for Excel, Numbers,
          or Google Sheets.</p>
      </div>
    </section>
    <section class="card">
      <h2>Where to keep it</h2>
      <p>Somewhere other than this phone or computer: iCloud Drive, Google Drive, or an email to yourself.
        On a phone, the button opens the Share sheet; pick <strong>Save to Files</strong> or Mail.</p>
      <p class="muted small">The file holds microchip and tag numbers, so keep it private.</p>
    </section>`;
}

// "Last backup: Nov 12, 2026 (today)", or "No backup yet."
export function lastBackupWords() {
  const age = L.backupAge(state.lastBackup && state.lastBackup.exported_at, state.today);
  if (!age.day) return 'No backup yet.';
  const ago = age.days === 0 ? 'today' : age.days === 1 ? 'yesterday' : `${age.days} days ago`;
  return `Last backup: ${L.formatDate(age.day)} (${ago}).`;
}

// The dashboard's reminder, shown when there's no backup from the last
// 30 days.
export function backupReminder() {
  const age = L.backupAge(state.lastBackup && state.lastBackup.exported_at, state.today);
  if (!age.due) return '';
  return `
    <section class="card backup-reminder">
      <p><strong>Time for a backup.</strong> ${esc(lastBackupWords())}</p>
      <a class="btn small" href="#/backup">Back up</a>
    </section>`;
}

export const backupActions = {
  'backup-json': async () => {
    const backup = B.buildBackup(await db.loadAll());
    const file = new File([JSON.stringify(backup, null, 2) + '\n'], B.backupFileName('json', state.today),
      { type: 'application/json' });
    await keep(file, 'json');
  },
  'backup-csv': async () => {
    const zip = B.makeZip(B.csvFiles(await db.loadAll(), state.today));
    const file = new File([zip], B.backupFileName('csv', state.today), { type: 'application/zip' });
    await keep(file, 'csv');
  },
};

async function keep(file, kind) {
  const how = await saveFile(file);
  if (!how) return;   // cancelled
  try {
    await db.logBackup(kind);
    await refresh();
  } catch {
    // The file is saved either way; only the "last backup" note missed.
  }
  toast(how === 'shared' ? 'Backup saved' : 'Backup downloaded');
}
