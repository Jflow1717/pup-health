// =====================================================================
//  Add or edit a contact (vet, emergency vet, breeder ...)
// =====================================================================

import * as db from '../db.js';
import { state, save } from '../store.js';
import { openSheet, fieldsHtml, readFields, askConfirm, toast } from '../ui.js';
import { CONTACT_KINDS, safeWebsite } from '../screens/contacts.js';

export const contactActions = {
  'add-contact': (ds) => openContactForm(null, ds.kind || 'other'),
  'edit-contact': (ds) => openContactForm(state.data.contacts.find((c) => c.id === ds.id)),
};

const FIELDS = [
  { name: 'kind', label: 'Kind', type: 'select', required: true,
    options: Object.entries(CONTACT_KINDS).map(([value, label]) => ({ value, label })) },
  { name: 'name', label: 'Name (business or person)', required: true },
  { name: 'person', label: 'Who to ask for', hint: 'A specific vet, or the breeder\'s name.' },
  { name: 'phone', label: 'Phone', type: 'tel', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'website', label: 'Website', placeholder: 'e.g. petvet.com' },
  { name: 'notes', label: 'Notes', type: 'textarea', hint: 'Hours, after-hours number, account number ...' },
];

function openContactForm(contact, kind = 'other') {
  const editing = !!contact;
  openSheet({
    title: editing ? `Edit ${contact.name}` : `Add ${CONTACT_KINDS[kind].toLowerCase()}`,
    submit: editing ? 'Save changes' : 'Save',
    body: fieldsHtml(FIELDS, editing ? contact : { kind }),
    extra: editing ? '<button type="button" class="btn danger" data-delete>Delete</button>' : '',
    onOpen: (form) => {
      if (!editing) form.elements['name'].focus();
      const del = form.querySelector('[data-delete]');
      if (!del) return;
      del.addEventListener('click', async () => {
        if (!(await askConfirm(`Delete ${contact.name}?`, 'Delete'))) return;
        try {
          await save(() => db.deleteRow('contacts', contact.id), 'Deleted');
        } catch (err) {
          toast(err.message);
        }
      });
    },
    onSubmit: async (form) => {
      const v = readFields(form, FIELDS);
      if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) throw new Error('That email doesn\'t look right.');
      if (v.phone && v.phone.replace(/\D/g, '').length < 7) throw new Error('That phone number looks too short.');
      if (v.website && !safeWebsite(v.website)) throw new Error('That website doesn\'t look right. Try something like petvet.com.');
      if (editing) return save(() => db.updateRow('contacts', contact.id, v), 'Saved');
      const maxOrder = Math.max(0, ...state.data.contacts.map((c) => c.sort_order ?? 0));
      await save(() => db.insertRows('contacts', [{ ...v, sort_order: maxOrder + 1 }]), `${v.name} added`);
    },
  });
}
