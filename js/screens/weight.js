// =====================================================================
//  Weight: latest weight, size check, growth chart, and the log
// =====================================================================
//  #/weight/<dog id>  one dog
//  #/weight/both      both dogs, with their lines on one chart
//
//  The size check compares each dog's weight with the top of its
//  current Heartgard Plus and NexGard size (see sizeCheck in logic.js).
// =====================================================================

import * as L from '../logic.js';
import { state, shortName } from '../store.js';
import { esc, statusChip, dogColor } from '../ui.js';
import { keySwatch } from '../chart.js';

// Size check words and colors: over the top / getting close / fits.
export const SIZE_CHIPS = {
  over: { cls: 'overdue', text: 'Too big for this size' },
  near: { cls: 'soon', text: 'Size up soon' },
  ok: { cls: 'ok', text: 'Size fits' },
};

let lastChoice = null;   // remembers Sunny / Chomper / Both for the tab

export function weightScreen(choice) {
  const { data, today } = state;
  const dogs = L.sortedDogs(data.dogs);
  if (!choice) choice = lastChoice || (dogs[0] && dogs[0].id);
  const shown = choice === 'both' ? dogs : dogs.filter((d) => d.id === choice);
  if (shown.length === 0) return '<section class="card"><p>No dogs yet.</p></section>';
  lastChoice = choice;

  const switcher = [...dogs.map((d) => ({ id: d.id, label: shortName(d), color: dogColor(d) })),
    { id: 'both', label: 'Both', color: 'var(--accent)' }]
    .map((o) => `<a href="#/weight/${o.id}" class="${o.id === choice ? 'on' : ''}" style="--dog:${o.color}">${esc(o.label)}</a>`).join('');

  const ids = shown.map((d) => d.id).join(',');
  return `
    <nav class="dog-switch" aria-label="Choose a dog">${switcher}</nav>
    <section class="weight-tops">${shown.map((d) => latestCard(data, d, today, shown.length > 1)).join('')}</section>
    <div class="button-row add-weight-row">
      <button class="btn primary" data-action="add-weight" data-dogs="${ids}">＋ Add weight</button>
    </div>
    ${sizeCard(data, shown, today)}
    <section class="card">
      <h2>Growth in pounds${shown.length === 1 ? `: ${esc(shortName(shown[0]))}` : ''}</h2>
      <div class="chart" data-chart="weight" data-dogs="${ids}"></div>
    </section>
    <section class="card">
      <h2>Weight log</h2>
      ${shown.length === 1 ? oneDogLog(data, shown[0], today) : bothDogsLog(data, shown, today)}
    </section>`;
}


// ---------------------------------------------------------------------
//  Latest weight, change, and growth speed
// ---------------------------------------------------------------------
function latestCard(data, dog, today, compact) {
  const list = L.weightsFor(data.weights, dog.id);
  const last = list[list.length - 1];
  if (!last) {
    return `<div class="card weight-top" style="--dog:${dogColor(dog)}">
      <span class="weight-name">${esc(shortName(dog))}</span><p class="muted">No weight yet.</p></div>`;
  }
  const prev = list[list.length - 2];
  const change = prev ? L.round1(Number(last.weight_lbs) - Number(prev.weight_lbs)) : null;
  const rate = L.growthRate(data.weights, dog.id);
  const ago = L.daysBetween(last.date, today);
  return `
    <div class="card weight-top" style="--dog:${dogColor(dog)}">
      ${compact ? `<span class="weight-name">${esc(shortName(dog))}</span>` : ''}
      <span class="hero-num">${Number(last.weight_lbs)} lb</span>
      <span class="muted">${esc(L.formatDate(last.date, { short: true, today }))}${ago > 0 ? ` (${ago} day${ago === 1 ? '' : 's'} ago)` : ' (today)'}</span>
      ${change !== null ? `<span>${change >= 0 ? '+' : '−'}${Math.abs(change)} lb since ${esc(L.formatDate(prev.date, { short: true, today }))}</span>` : ''}
      ${rate ? `<span class="muted">Growing about ${L.round1(rate.perDay * 7)} lb a week since ${esc(L.formatDate(rate.from.date, { short: true, today }))}</span>` : ''}
    </div>`;
}


// ---------------------------------------------------------------------
//  Heartgard / NexGard size check
// ---------------------------------------------------------------------
function sizeCard(data, dogs, today) {
  const sized = L.sortedTreatments(data.treatments).filter((t) => t.active && (t.weight_bands || []).length);
  const rows = [];
  for (const dog of dogs) {
    for (const t of sized) {
      const check = L.sizeCheck(data, dog, t, today);
      if (!check) continue;
      const chip = SIZE_CHIPS[check.level];
      rows.push(`
        <li class="size-row ${chip.cls}">
          <div class="size-head">
            <strong>${esc(t.name)} ${esc(check.band.label)}</strong>
            <small class="muted">${esc(check.band.min_lbs)}-${esc(check.band.max_lbs)} lb${dogs.length > 1 ? ` · ${esc(shortName(dog))}` : ''}</small>
            ${statusChip(chip.cls, chip.text)}
          </div>
          <p>${esc(check.message)}</p>
        </li>`);
    }
  }
  if (rows.length === 0) return '';
  return `
    <section class="card">
      <h2>Heartgard &amp; NexGard sizes</h2>
      <ul class="size-list">${rows.join('')}</ul>
      <p class="muted small">Warns when a dog is within ${L.SIZE_MARGIN_LBS} lb of the top of its size, or growing fast
        enough to pass it in the next ${L.SIZE_LOOKAHEAD_DAYS} days. Growth dates are estimates; the scale decides.</p>
    </section>`;
}


// ---------------------------------------------------------------------
//  The log (every number on the chart, in a list)
// ---------------------------------------------------------------------
function oneDogLog(data, dog, today) {
  const list = L.weightsFor(data.weights, dog.id).reverse();
  if (list.length === 0) return '<p class="muted">No weights yet.</p>';
  return `<ol class="weight-log">${list.map((w, i) => {
    const older = list[i + 1];
    const change = older ? L.round1(Number(w.weight_lbs) - Number(older.weight_lbs)) : null;
    return `
      <li><button class="weight-line" data-action="edit-weight" data-id="${w.id}">
        <span class="w-date">${esc(L.formatDate(w.date, { today }))}${w.event_id ? ' <small class="kind-tag vet_visit">Vet</small>' : ''}</span>
        <strong class="w-lbs">${Number(w.weight_lbs)} lb</strong>
        <span class="w-change muted">${change === null ? '' : `${change >= 0 ? '+' : '−'}${Math.abs(change)}`}</span>
        ${w.notes ? `<span class="note-text">${esc(w.notes)}</span>` : ''}
      </button></li>`;
  }).join('')}</ol>`;
}

// Both dogs: one row per date, a column per dog. Tap a number to edit it.
function bothDogsLog(data, dogs, today) {
  const dates = [...new Set(data.weights.filter((w) => dogs.some((d) => d.id === w.dog_id)).map((w) => w.date))].sort().reverse();
  if (dates.length === 0) return '<p class="muted">No weights yet.</p>';
  const head = dogs.map((d) => `<th scope="col">${keySwatch(d)} ${esc(shortName(d))}</th>`).join('');
  const rows = dates.map((date) => `
    <tr><th scope="row">${esc(L.formatDate(date, { today }))}</th>${dogs.map((d) => {
      const w = data.weights.find((x) => x.dog_id === d.id && x.date === date);
      return `<td>${w ? `<button class="link-btn" data-action="edit-weight" data-id="${w.id}">${Number(w.weight_lbs)} lb</button>` : '<span class="muted">—</span>'}</td>`;
    }).join('')}</tr>`).join('');
  return `<table class="weight-table"><thead><tr><th scope="col">Date</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}
