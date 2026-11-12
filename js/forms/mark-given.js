// =====================================================================
//  "Mark as given" for monthly medications (Heartgard Plus, NexGard)
// =====================================================================
//  Logs a dose for today (or a day you pick) and sets the next due
//  date 30 days later. Both dogs are ticked when both are due, since
//  they usually get it together. The size is picked from each dog's
//  latest weight, with a warning if a dog is close to outgrowing it.
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import { state, save, dogById, treatmentById, shortName } from '../store.js';
import { esc, openSheet } from '../ui.js';

export const markGivenActions = {
  'mark-given': (ds) => openMarkGiven(ds.treatment, (ds.dogs || '').split(',').filter(Boolean)),
};

function openMarkGiven(treatmentId, dogIds) {
  const treatment = treatmentById(treatmentId);
  const dogs = L.sortedDogs(state.data.dogs);
  const ticked = new Set(dogIds);

  const dogBoxes = dogs.map((d) => {
    const draft = L.markGivenDose({ dog: d, treatment, data: state.data });
    // Close to outgrowing this size? Say so right here, before it's given.
    const check = L.sizeCheck(state.data, d, treatment, state.today);
    const warning = check && check.level !== 'ok'
      ? `<p class="size-warning ${check.level}">${esc(check.message)}</p>` : '';
    return `
      <label class="field check">
        <input type="checkbox" name="dog" value="${d.id}"${ticked.has(d.id) ? ' checked' : ''}>
        <span>${esc(shortName(d))}${draft.size ? ` <small class="muted">· ${esc(draft.size)}</small>` : ''}</span>
      </label>${warning}`;
  }).join('');

  openSheet({
    title: `${treatment.name}: mark as given`,
    submit: 'Mark as given',
    body: `
      <fieldset class="field"><legend>Which dogs</legend>${dogBoxes}</fieldset>
      <label class="field"><span>Date given</span>
        <input type="date" name="date_given" value="${state.today}" max="${state.today}" required></label>
      <p class="next-due-preview"></p>
      <p class="muted small">Size comes from each dog's latest weight. Tap the dose later in the history to change anything.</p>`,
    onOpen: (form) => {
      // Shows the next due date as the date changes.
      const preview = () => {
        const date = form.date_given.value;
        form.querySelector('.next-due-preview').innerHTML = L.isDate(date)
          ? `Next due: <strong>${esc(L.formatDate(L.addDays(date, treatment.repeat_days)))}</strong> (${treatment.repeat_days} days later)`
          : '';
      };
      form.date_given.addEventListener('input', preview);
      preview();
    },
    onSubmit: async (form) => {
      const date = form.date_given.value;
      if (!L.isDate(date)) throw new Error('Please pick the date it was given.');
      if (date > state.today) throw new Error('The date given can\'t be in the future.');
      const chosen = [...form.querySelectorAll('input[name=dog]:checked')].map((b) => dogById(b.value));
      if (chosen.length === 0) throw new Error('Tick at least one dog.');

      const rows = chosen.map((dog) => L.markGivenDose({ dog, treatment, data: state.data, date }));
      for (const row of rows) {
        if (L.findSameDayDose(state.data.doses, row)) {
          throw new Error(`${shortName(dogById(row.dog_id))} already has ${treatment.name} recorded on ${L.formatDate(date)}.`);
        }
      }
      const names = chosen.map(shortName).join(' and ');
      await save(() => db.insertRows('doses', rows), `${treatment.name} logged for ${names}`);
    },
  });
}
