// =====================================================================
//  Add or edit a visit or note
// =====================================================================
//  Vet visits, reactions, allergies, illnesses, injuries, and general
//  notes. Vet findings (temperature, body condition score) have their
//  own boxes. "Still applies" puts it on the dashboard (for allergies
//  and ongoing conditions).
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import { state, save, dogById, shortName } from '../store.js';
import { esc, openSheet, fieldsHtml, readFields, askConfirm, toast } from '../ui.js';
import { KIND_WORDS } from '../screens/health.js';

export const eventActions = {
  'add-event': (ds) => openEventForm({ dogIds: [ds.dog].filter(Boolean) }),
  'edit-event': (ds) => openEventForm({ event: state.data.events.find((e) => e.id === ds.id) }),
};

// Vet findings with their own boxes. Any other findings already stored
// (like "safe to vaccinate") are kept as they are.
const VITAL_FIELDS = [
  { name: 'temp', label: 'Temperature (°F)', type: 'number', step: '0.1', inputmode: 'decimal', half: true },
  { name: 'body_condition_score', label: 'Body condition (1-9)', type: 'number', step: '1', inputmode: 'numeric', half: true },
];

const EVENT_FIELDS = [
  { name: 'kind', label: 'Type', type: 'select', required: true, half: true,
    options: Object.entries(KIND_WORDS).map(([value, label]) => ({ value, label })) },
  { name: 'date', label: 'Date', type: 'date', required: true, half: true },
  { name: 'title', label: 'Title', required: true, placeholder: 'e.g. Rabies, boosters, Lyme #1' },
  { name: 'clinic', label: 'Clinic', half: true },
  { name: 'vet', label: 'Vet', half: true },
  ...VITAL_FIELDS,
  { name: 'details', label: 'Details', type: 'textarea' },
  { name: 'ongoing', label: 'Still applies (an allergy or ongoing condition). Shows on the dashboard.', type: 'checkbox' },
];

export function openEventForm({ event = null, dogIds = [] }) {
  const editing = !!event;
  const dogs = L.sortedDogs(state.data.dogs);
  const dogPart = editing
    ? `<p class="field-static"><span>Dog</span> <strong>${esc(dogById(event.dog_id).name)}</strong></p>`
    : `<fieldset class="field"><legend>Which dogs *</legend>${dogs.map((d) => `
        <label class="field check"><input type="checkbox" name="dog" value="${d.id}"${dogIds.includes(d.id) ? ' checked' : ''}>
        <span>${esc(shortName(d))}</span></label>`).join('')}</fieldset>`;

  const start = editing
    ? { ...event, ...event.vitals }
    : { kind: 'note', date: state.today };
  const otherVitals = editing ? L.vitalsList(omit(event.vitals, VITAL_FIELDS.map((f) => f.name))) : [];

  openSheet({
    title: editing ? 'Visit or note' : 'Add a visit or note',
    submit: editing ? 'Save changes' : 'Save',
    body: dogPart + fieldsHtml(EVENT_FIELDS, start) +
      (otherVitals.length ? `<p class="muted small">Also recorded: ${esc(otherVitals.join(' · '))}</p>` : ''),
    extra: editing ? '<button type="button" class="btn danger" data-delete>Delete</button>' : '',
    onOpen: (form) => wireDelete(form, event),
    onSubmit: async (form) => {
      const v = readFields(form, EVENT_FIELDS);
      // Put the finding boxes into "vitals", next to anything else stored there.
      const vitals = { ...(editing ? event.vitals : {}) };
      for (const f of VITAL_FIELDS) {
        if (v[f.name] === null) delete vitals[f.name]; else vitals[f.name] = v[f.name];
        delete v[f.name];
      }
      const row = { ...v, vitals };

      if (editing) return save(() => db.updateRow('events', event.id, row), 'Saved');

      const chosen = [...form.querySelectorAll('input[name=dog]:checked')].map((b) => b.value);
      if (chosen.length === 0) throw new Error('Tick at least one dog.');
      await save(() => db.insertRows('events', chosen.map((dog_id) => ({ ...row, dog_id }))),
        chosen.length > 1 ? 'Saved for both dogs' : 'Saved');
    },
  });
}

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));

function wireDelete(form, event) {
  const button = form.querySelector('[data-delete]');
  if (!button) return;
  button.addEventListener('click', async () => {
    const linked = state.data.doses.filter((d) => d.event_id === event.id).length;
    const ok = await askConfirm(
      `Delete "${event.title}" (${L.formatDate(event.date)})?` +
      (linked ? ` The ${linked} dose${linked === 1 ? '' : 's'} given at this visit stay in the history.` : ''), 'Delete');
    if (!ok) return;
    try {
      await save(() => db.deleteRow('events', event.id), 'Deleted');
    } catch (err) {
      toast(err.message);
    }
  });
}
