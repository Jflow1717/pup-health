// =====================================================================
//  Add or edit a weight
// =====================================================================
//  Adding: one box per dog, so you can weigh both and save once.
//  Leave a box empty to skip that dog. One weight per dog per day.
// =====================================================================

import * as db from '../db.js';
import * as L from '../logic.js';
import { state, save, dogById, shortName } from '../store.js';
import { openSheet, fieldsHtml, readFields, askConfirm, toast } from '../ui.js';

export const weightActions = {
  'add-weight': (ds) => openAddWeight((ds.dogs || '').split(',').filter(Boolean)),
  'edit-weight': (ds) => openEditWeight(state.data.weights.find((w) => w.id === ds.id)),
};

// Pounds: more than 0, less than 300, up to two decimals (28.88).
function checkLbs(lbs, who) {
  if (!(lbs > 0 && lbs < 300)) throw new Error(`${who}: the weight needs to be between 0 and 300 lb.`);
  return Math.round(lbs * 100) / 100;
}

function openAddWeight(dogIds) {
  const dogs = L.sortedDogs(state.data.dogs);
  const focusFirst = dogIds.length ? dogIds : dogs.map((d) => d.id);
  const fields = [
    { name: 'date', label: 'Date weighed', type: 'date', required: true },
    ...dogs.map((d) => ({ name: 'lbs_' + d.id, label: `${shortName(d)} (lb)`, type: 'number', step: '0.01', inputmode: 'decimal', half: true })),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  openSheet({
    title: 'Add weight',
    body: fieldsHtml(fields, { date: state.today }) +
      '<p class="muted small">Leave a box empty to skip that dog.</p>',
    onOpen: (form) => {
      form.elements.date.max = state.today;
      const first = form.elements['lbs_' + focusFirst[0]];
      if (first) first.focus();
    },
    onSubmit: async (form) => {
      const v = readFields(form, fields);
      if (v.date > state.today) throw new Error('The date can\'t be in the future.');
      const rows = [];
      for (const d of dogs) {
        const lbs = v['lbs_' + d.id];
        if (lbs === null) continue;
        const row = { dog_id: d.id, date: v.date, weight_lbs: checkLbs(lbs, shortName(d)), notes: v.notes };
        const clash = state.data.weights.find((w) => w.dog_id === d.id && w.date === v.date);
        if (clash) {
          throw new Error(`${shortName(d)} already has a weight on ${L.formatDate(v.date)} (${Number(clash.weight_lbs)} lb). ` +
            'Tap it in the weight log to change it.');
        }
        rows.push(row);
      }
      if (rows.length === 0) throw new Error('Type at least one weight.');
      const names = rows.map((r) => shortName(dogById(r.dog_id))).join(' and ');
      await save(() => db.insertRows('weights', rows), `Weight saved for ${names}`);
    },
  });
}

function openEditWeight(weight) {
  const dog = dogById(weight.dog_id);
  const fields = [
    { name: 'date', label: 'Date weighed', type: 'date', required: true, half: true },
    { name: 'weight_lbs', label: 'Weight (lb)', type: 'number', step: '0.01', inputmode: 'decimal', required: true, half: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  openSheet({
    title: `${shortName(dog)}'s weight`,
    submit: 'Save changes',
    body: fieldsHtml(fields, { ...weight, weight_lbs: Number(weight.weight_lbs) }) +
      (weight.event_id ? '<p class="muted small">Recorded at a vet visit.</p>' : ''),
    extra: '<button type="button" class="btn danger" data-delete>Delete</button>',
    onOpen: (form) => {
      form.elements.date.max = state.today;
      form.querySelector('[data-delete]').addEventListener('click', async () => {
        const ok = await askConfirm(`Delete ${shortName(dog)}'s ${Number(weight.weight_lbs)} lb from ${L.formatDate(weight.date)}?`, 'Delete');
        if (!ok) return;
        try {
          await save(() => db.deleteRow('weights', weight.id), 'Weight deleted');
        } catch (err) {
          toast(err.message);
        }
      });
    },
    onSubmit: async (form) => {
      const v = readFields(form, fields);
      if (v.date > state.today) throw new Error('The date can\'t be in the future.');
      v.weight_lbs = checkLbs(v.weight_lbs, shortName(dog));
      const clash = state.data.weights.find((w) => w.id !== weight.id && w.dog_id === dog.id && w.date === v.date);
      if (clash) throw new Error(`${shortName(dog)} already has a weight on ${L.formatDate(v.date)}.`);
      await save(() => db.updateRow('weights', weight.id, v), 'Weight updated');
    },
  });
}
