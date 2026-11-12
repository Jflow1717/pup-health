// =====================================================================
//  Add or edit a kind of vaccine or medication
// =====================================================================
//  For example, if the vet starts a new vaccine (say, canine flu), add
//  it here once, then log doses of it like any other.
//  "Repeats every ... days" turns on the "Mark as given" button.
//  "In use" off hides it from the dashboard; its history is kept.
//  "Sizes by weight" is for meds sold by weight (Heartgard Plus,
//  NexGard). It powers the size picked by "Mark as given" and the
//  "time for the next size" warning.
// =====================================================================

import * as db from '../db.js';
import { state, save, treatmentById } from '../store.js';
import { openSheet, fieldsHtml, readFields } from '../ui.js';

export const treatmentActions = {
  'add-treatment': () => openTreatmentForm(null),
  'edit-treatment': (ds) => openTreatmentForm(treatmentById(ds.id)),
};

const FIELDS = [
  { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Canine influenza' },
  { name: 'kind', label: 'Type', type: 'select', required: true, half: true,
    options: [{ value: 'vaccine', label: 'Vaccine' }, { value: 'medication', label: 'Medication' }] },
  { name: 'repeat_days', label: 'Repeats every (days)', type: 'number', step: '1', inputmode: 'numeric', half: true,
    hint: 'Monthly meds: 30. Leave blank for vaccines.' },
  { name: 'sizes', label: 'Sizes by weight (meds sold by weight only)', type: 'textarea',
    hint: 'One size per line: name, from lb, to lb. For example: Green, 26, 50.9' },
  { name: 'active', label: 'In use (show on the dashboard)', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

function openTreatmentForm(treatment) {
  const editing = !!treatment;
  openSheet({
    title: editing ? `Edit ${treatment.name}` : 'New kind of vaccine or medication',
    submit: editing ? 'Save changes' : 'Add',
    body: fieldsHtml(FIELDS, editing
      ? { ...treatment, sizes: sizesToText(treatment.weight_bands) }
      : { kind: 'vaccine', active: true }),
    onSubmit: async (form) => {
      const v = readFields(form, FIELDS);
      v.weight_bands = textToSizes(v.sizes);
      delete v.sizes;
      if (v.repeat_days !== null && !(Number.isInteger(v.repeat_days) && v.repeat_days > 0)) {
        throw new Error('"Repeats every" needs a whole number of days, like 30.');
      }
      const clash = state.data.treatments.find((t) =>
        t.name.toLowerCase() === v.name.toLowerCase() && (!editing || t.id !== treatment.id));
      if (clash) throw new Error(`"${clash.name}" is already on the list.`);

      if (editing) return save(() => db.updateRow('treatments', treatment.id, v), 'Saved');
      const maxOrder = Math.max(0, ...state.data.treatments.map((t) => t.sort_order ?? 0));
      await save(() => db.insertRows('treatments', [{ ...v, sort_order: maxOrder + 1, aliases: [] }]),
        `${v.name} added`);
    },
  });
}

// [{label: 'Green', min_lbs: 26, max_lbs: 50.9}]  <->  "Green, 26, 50.9"
function sizesToText(bands) {
  return (bands || []).map((b) => `${b.label}, ${b.min_lbs}, ${b.max_lbs}`).join('\n');
}

function textToSizes(text) {
  if (!text) return [];
  const bands = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(',').map((p) => p.trim());
    const [label, min, max] = [parts[0], Number(parts[1]), Number(parts[2])];
    if (parts.length !== 3 || !label || Number.isNaN(min) || Number.isNaN(max) || parts[1] === '' || parts[2] === '') {
      throw new Error(`Sizes: "${line}" should look like "Green, 26, 50.9" (name, from lb, to lb).`);
    }
    if (min < 0 || max <= min) throw new Error(`Sizes: in "${line}", the "to" weight must be more than the "from" weight.`);
    return { label, min_lbs: min, max_lbs: max };
  });
  bands.sort((a, b) => a.min_lbs - b.min_lbs);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].min_lbs <= bands[i - 1].max_lbs) {
      throw new Error(`Sizes: ${bands[i - 1].label} and ${bands[i].label} overlap. Each size should start above the last one's top.`);
    }
  }
  return bands;
}
