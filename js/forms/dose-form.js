// =====================================================================
//  Add or edit a dose (any vaccine or medication), by hand
// =====================================================================
//  Every detail from the vet paperwork has a box: date given, product,
//  size, lot number and its expiration, vet, clinic, next due date,
//  how long it covers, and notes.
//
//  Adding: tick one or both dogs. Both get an identical record, which
//  is handy when they're seen together.
//  Monthly meds: the next due date fills itself in (30 days later)
//  until you type your own.
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import { state, save, dogById, treatmentById, shortName } from '../store.js';
import { esc, openSheet, fieldsHtml, readFields, askConfirm, toast } from '../ui.js';

export const doseActions = {
  'add-dose': (ds) => openDoseForm({ dogIds: (ds.dogs || '').split(',').filter(Boolean), treatmentId: ds.treatment }),
  'edit-dose': (ds) => openDoseForm({ dose: state.data.doses.find((d) => d.id === ds.id) }),
};

// The boxes, in the order they appear.
function doseFields() {
  const treatments = L.sortedTreatments(state.data.treatments).filter((t) => t.active);
  return [
    { name: 'treatment_id', label: 'Vaccine or medication', type: 'select', required: true,
      options: [{ value: '', label: 'Choose…' },
        ...treatments.map((t) => ({ value: t.id, label: `${t.name} (${t.kind})` }))] },
    { name: 'date_given', label: 'Date given', type: 'date', required: true, half: true },
    { name: 'next_due', label: 'Next due', type: 'date', half: true },
    { name: 'product_name', label: 'Product name', placeholder: 'e.g. Nobivac (Merck)' },
    { name: 'size', label: 'Size', placeholder: 'for sized meds, e.g. Green (26-50.9 lb)' },
    { name: 'lot_number', label: 'Lot number', half: true },
    { name: 'lot_expires', label: 'Lot expires', type: 'date', half: true },
    { name: 'vet', label: 'Vet' },
    { name: 'clinic', label: 'Clinic', hint: 'Write "Home" if you gave it yourself.' },
    { name: 'duration', label: 'Duration', placeholder: 'e.g. 1 year, 3 years, 28 days, 30 days' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

// Suggestions for the vet and clinic boxes, from earlier doses.
function suggestions(column) {
  const seen = [...new Set(state.data.doses.map((d) => d[column]).filter(Boolean))].sort();
  return `<datalist id="list-${column}">${seen.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

export function openDoseForm({ dose = null, dogIds = [], treatmentId = null }) {
  const editing = !!dose;
  const fields = doseFields();
  const dogs = L.sortedDogs(state.data.dogs);

  // When editing, show the dog's name; when adding, tick boxes.
  const dogPart = editing
    ? `<p class="field-static"><span>Dog</span> <strong>${esc(dogById(dose.dog_id).name)}</strong></p>`
    : `<fieldset class="field"><legend>Which dogs *</legend>${dogs.map((d) => `
        <label class="field check"><input type="checkbox" name="dog" value="${d.id}"${dogIds.includes(d.id) ? ' checked' : ''}>
        <span>${esc(shortName(d))}</span></label>`).join('')}</fieldset>`;

  // Editing a dose whose treatment is no longer in use: keep it choosable.
  if (editing && !fields[0].options.some((o) => o.value === dose.treatment_id)) {
    const t = treatmentById(dose.treatment_id);
    fields[0].options.push({ value: t.id, label: `${t.name} (not in use)` });
  }

  const start = editing ? dose : { treatment_id: treatmentId || '', date_given: state.today };
  openSheet({
    title: editing ? 'Dose details' : 'Add a dose',
    submit: editing ? 'Save changes' : 'Save',
    body: dogPart + fieldsHtml(fields, start) + suggestions('vet') + suggestions('clinic') + sizeSuggestions(),
    extra: editing ? '<button type="button" class="btn danger" data-delete>Delete</button>' : '',
    onOpen: (form) => wireForm(form, editing ? dose : null),
    onSubmit: async (form) => {
      const values = readFields(form, fields);
      if (values.date_given > state.today) throw new Error('The date given can\'t be in the future.');
      if (values.next_due && values.next_due < values.date_given) {
        throw new Error('The next due date can\'t be before the date given.');
      }
      const treatment = treatmentById(values.treatment_id);

      if (editing) {
        const clash = L.findSameDayDose(state.data.doses, { ...values, dog_id: dose.dog_id }, dose.id);
        if (clash) throw new Error(`${shortName(dogById(dose.dog_id))} already has ${treatment.name} recorded on ${L.formatDate(values.date_given)}.`);
        return save(() => db.updateRow('doses', dose.id, values), 'Dose updated');
      }

      const chosen = [...form.querySelectorAll('input[name=dog]:checked')].map((b) => b.value);
      if (chosen.length === 0) throw new Error('Tick at least one dog.');
      const rows = chosen.map((dog_id) => ({ ...values, dog_id }));
      for (const row of rows) {
        if (L.findSameDayDose(state.data.doses, row)) {
          throw new Error(`${shortName(dogById(row.dog_id))} already has ${treatment.name} recorded on ${L.formatDate(row.date_given)}. ` +
            'Open that dose in the history to change it.');
        }
      }
      await save(() => db.insertRows('doses', rows), rows.length > 1 ? 'Saved for both dogs' : 'Dose saved');
    },
  });
}

// Size suggestions: every size of every sized medication.
function sizeSuggestions() {
  const labels = state.data.treatments.flatMap((t) => (t.weight_bands || []).map(L.bandLabel));
  return `<datalist id="list-size">${labels.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

// Extra behavior once the form is on screen.
function wireForm(form, dose) {
  const box = form.elements;   // the form's boxes, by name
  box.vet.setAttribute('list', 'list-vet');
  box.clinic.setAttribute('list', 'list-clinic');
  box.size.setAttribute('list', 'list-size');

  // Monthly meds: keep "Next due" at date given + 30 days until the
  // person types a different date themselves.
  let typedOwnDueDate = !!(dose && dose.next_due);
  box.next_due.addEventListener('input', () => { typedOwnDueDate = true; });
  const fillDueDate = () => {
    const t = treatmentById(box.treatment_id.value);
    const date = box.date_given.value;
    if (typedOwnDueDate || !t || !t.repeat_days || !L.isDate(date)) return;
    box.next_due.value = L.addDays(date, t.repeat_days);
    if (!box.duration.value) box.duration.value = `${t.repeat_days} days`;
  };
  box.treatment_id.addEventListener('change', fillDueDate);
  box.date_given.addEventListener('input', fillDueDate);
  fillDueDate();

  const deleteButton = form.querySelector('[data-delete]');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const t = treatmentById(dose.treatment_id);
      const ok = await askConfirm(
        `Delete ${shortName(dogById(dose.dog_id))}'s ${t.name} dose from ${L.formatDate(dose.date_given)}?`, 'Delete');
      if (!ok) return;
      try {
        await save(() => db.deleteRow('doses', dose.id), 'Dose deleted');
      } catch (err) {
        toast(err.message);
      }
    });
  }
}
