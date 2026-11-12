// =====================================================================
//  Add or edit an ID (microchip, AKC, rabies tag, license, insurance),
//  and edit a dog's own details (name, birthday, collar color ...)
// =====================================================================

import * as db from '../db.js';
import { state, save, dogById, shortName } from '../store.js';
import { openSheet, fieldsHtml, readFields, askConfirm, toast, copyText } from '../ui.js';
import { ID_KINDS } from '../screens/ids.js';

export const idActions = {
  'add-id': (ds) => openIdForm({ dogId: ds.dog, kind: ds.kind }),
  'edit-id': (ds) => openIdForm({ id: state.data.identifiers.find((i) => i.id === ds.id) }),
  'edit-dog': (ds) => openDogForm(dogById(ds.id)),
  copy: (ds) => copyText(ds.text, ds.label),
};

function idFields(kind) {
  const k = ID_KINDS[kind];
  return [
    { name: 'kind', label: 'Kind', type: 'select', required: true,
      options: Object.entries(ID_KINDS).map(([value, v]) => ({ value, label: v.label })) },
    { name: 'value', label: k.valueLabel, required: true },
    { name: 'issuer', label: k.issuer, hint: k.issuerHint },
    { name: 'issued_on', label: 'Issued on', type: 'date', half: true },
    { name: 'expires_on', label: k.renews ? 'Renewal date' : 'Expires on', type: 'date', half: true },
    { name: 'details', label: kind === 'insurance' ? 'Policy details' : 'Notes', type: 'textarea', hint: k.detailsHint },
  ];
}

function openIdForm({ id = null, dogId = null, kind = 'other' }) {
  const editing = !!id;
  const dog = dogById(editing ? id.dog_id : dogId);
  const startKind = editing ? id.kind : kind;
  const fields = idFields(startKind);

  openSheet({
    title: `${shortName(dog)}: ${editing ? 'edit' : 'add'} ${ID_KINDS[startKind].label.toLowerCase()}`,
    submit: editing ? 'Save changes' : 'Save',
    body: fieldsHtml(fields, editing ? id : { kind: startKind }),
    extra: editing ? '<button type="button" class="btn danger" data-delete>Delete</button>' : '',
    onOpen: (form) => {
      if (!editing) form.elements.value.focus();
      // Changing the kind relabels the boxes to match (Registry, Town, Company ...).
      form.elements.kind.addEventListener('change', () => {
        const fresh = idFields(form.elements.kind.value);
        for (const f of fresh) {
          const label = form.querySelector(`label[for="f-${f.name}"] > span`);
          if (label && f.type !== 'select') label.textContent = f.label + (f.required ? ' *' : '');
        }
      });
      const del = form.querySelector('[data-delete]');
      if (del) {
        del.addEventListener('click', async () => {
          const ok = await askConfirm(`Delete ${shortName(dog)}'s ${ID_KINDS[id.kind].label.toLowerCase()} ${id.value}?`, 'Delete');
          if (!ok) return;
          try {
            await save(() => db.deleteRow('identifiers', id.id), 'Deleted');
          } catch (err) {
            toast(err.message);
          }
        });
      }
    },
    onSubmit: async (form) => {
      const v = readFields(form, fields);
      if (v.issued_on && v.expires_on && v.expires_on < v.issued_on) {
        throw new Error('The renewal or expiry date can\'t be before the issue date.');
      }
      const clash = state.data.identifiers.find((i) => i.dog_id === dog.id && i.kind === v.kind &&
        i.value.toLowerCase() === v.value.toLowerCase() && (!editing || i.id !== id.id));
      if (clash) throw new Error(`${shortName(dog)} already has ${ID_KINDS[v.kind].label.toLowerCase()} ${clash.value}.`);
      if (editing) return save(() => db.updateRow('identifiers', id.id, v), 'Saved');
      await save(() => db.insertRows('identifiers', [{ ...v, dog_id: dog.id }]), 'Saved');
    },
  });
}


// ---------------------------------------------------------------------
//  The dog's own details
// ---------------------------------------------------------------------
const COLLARS = ['yellow', 'orange', 'red', 'blue', 'green', 'purple', 'pink', 'teal', 'brown', 'black'];

const DOG_FIELDS = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'short_name', label: 'Short name', hint: 'Shown where space is tight, like "Chomper".' },
  { name: 'sex', label: 'Sex', type: 'select', half: true,
    options: [{ value: '', label: '—' }, { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
  { name: 'birth_date', label: 'Birthday', type: 'date', half: true },
  { name: 'breed', label: 'Breed', half: true },
  { name: 'collar_color', label: 'Collar color', type: 'select', half: true, hint: 'Also the dog\'s color in the app.',
    options: [{ value: '', label: '—' }, ...COLLARS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))] },
  { name: 'notes', label: 'Notes', type: 'textarea', hint: 'Markings, temperament, feeding notes, anything a sitter should know.' },
];

function openDogForm(dog) {
  openSheet({
    title: `Edit ${shortName(dog)}'s details`,
    submit: 'Save changes',
    body: fieldsHtml(DOG_FIELDS, dog),
    onSubmit: async (form) => {
      const v = readFields(form, DOG_FIELDS);
      if (v.birth_date && v.birth_date > state.today) throw new Error('The birthday can\'t be in the future.');
      const clash = state.data.dogs.find((d) => d.id !== dog.id && d.name.toLowerCase() === v.name.toLowerCase());
      if (clash) throw new Error(`There's already a dog named ${clash.name}.`);
      await save(() => db.updateRow('dogs', dog.id, v), 'Saved');
    },
  });
}
