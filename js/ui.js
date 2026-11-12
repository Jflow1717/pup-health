// =====================================================================
//  Small screen helpers shared by every page
// =====================================================================
//  - esc():        makes text safe to show on the page
//  - toast():      a short message at the bottom ("Saved")
//  - openSheet():  the pop-up panel used for every form
//  - askConfirm(): "Are you sure?" before deleting
//  - fieldHtml() / readFields(): build a form from a list of fields,
//                  and read the answers back out
//  - saveFile():   hand the person a file (a backup) to keep
// =====================================================================

// Anything typed by a person (names, notes) goes through esc() before it
// is shown, so a stray "<" can't break the page.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A short message that fades away by itself.
let toastTimer = null;
export function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 2600);
}


// ---------------------------------------------------------------------
//  The pop-up panel ("sheet") that holds forms
// ---------------------------------------------------------------------
// title:     the heading
// body:      the form's fields, as HTML
// submit:    the save button's words ("Save"); leave out for no button
// onSubmit:  called with the form when Save is tapped. If it throws,
//            the error is shown in the panel and the panel stays open.
// onOpen:    called with the form once it is on screen, to wire up
//            anything extra (like filling in a due date)
// extra:     more buttons under Save (like Delete), as HTML
export function openSheet({ title, body, submit = 'Save', onSubmit, onOpen, extra = '' }) {
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `
    <form class="sheet-form" novalidate>
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="sheet-actions">
        ${submit ? `<button type="submit" class="btn primary">${esc(submit)}</button>` : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        ${extra}
      </div>
    </form>`;
  const form = sheet.querySelector('form');
  const errorBox = form.querySelector('.form-error');
  form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const saveButton = form.querySelector('button[type=submit]');
    if (saveButton) saveButton.disabled = true;
    try {
      await onSubmit(form);
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.hidden = false;
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });
  if (!sheet.open) sheet.showModal();
  if (onOpen) onOpen(form);
  return form;
}

export function closeSheet() {
  const sheet = document.getElementById('sheet');
  if (sheet.open) sheet.close();
  sheet.innerHTML = '';
}

// "Are you sure?" Resolves to true or false. The yes button is red
// (for deleting) unless style is 'primary'.
export function askConfirm(message, yesLabel = 'Yes', style = 'danger') {
  return new Promise((resolve) => {
    const box = document.getElementById('confirm');
    box.innerHTML = `
      <p>${esc(message)}</p>
      <div class="sheet-actions">
        <button type="button" class="btn ${style}" data-answer="yes">${esc(yesLabel)}</button>
        <button type="button" class="btn" data-answer="no">Cancel</button>
      </div>`;
    box.querySelectorAll('[data-answer]').forEach((b) => b.addEventListener('click', () => {
      box.close();
      resolve(b.dataset.answer === 'yes');
    }));
    box.addEventListener('cancel', () => resolve(false), { once: true });
    box.showModal();
  });
}


// ---------------------------------------------------------------------
//  Forms from a list of fields
// ---------------------------------------------------------------------
// Each field is described like:
//   { name: 'lot_number', label: 'Lot number', type: 'text' }
// Types: text, date, number, select, textarea, checkbox.
// Selects take options: [{ value, label }]. Extras: required, hint,
// placeholder, step, inputmode, half (two half-width fields side by side),
// id (when one page has several boxes with the same name), attrs (more
// attributes for the box itself, as HTML).
export function fieldHtml(f, value) {
  const id = f.id || 'f-' + f.name;
  const attrs = f.attrs ? ' ' + f.attrs : '';
  const req = f.required ? ' required' : '';
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  const wrap = (inner) =>
    `<label class="field${f.half ? ' half' : ''}" for="${id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${inner}${hint}</label>`;

  if (f.type === 'checkbox') {
    return `<label class="field check" for="${id}"><input type="checkbox" id="${id}" name="${f.name}"${value ? ' checked' : ''}${attrs}>
      <span>${esc(f.label)}</span>${hint}</label>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map((o) =>
      `<option value="${esc(o.value)}"${String(o.value) === String(value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    return wrap(`<select id="${id}" name="${f.name}"${req}${attrs}>${opts}</select>`);
  }
  if (f.type === 'textarea') {
    return wrap(`<textarea id="${id}" name="${f.name}" rows="3"${req}${attrs}>${esc(value)}</textarea>`);
  }
  const extra = [
    f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '',
    f.step ? ` step="${f.step}"` : '',
    f.inputmode ? ` inputmode="${f.inputmode}"` : '',
  ].join('');
  return wrap(`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(value)}"${req}${extra}${attrs}>`);
}

export function fieldsHtml(fields, values = {}) {
  return fields.map((f) => fieldHtml(f, values[f.name])).join('');
}

// Reads the answers back out of a form. Blank boxes become null, number
// boxes become numbers, checkboxes become true/false.
export function readFields(form, fields) {
  const out = {};
  for (const f of fields) {
    const input = form.elements[f.name];
    if (!input) continue;
    if (f.type === 'checkbox') { out[f.name] = input.checked; continue; }
    const text = input.value.trim();
    if (text === '') { out[f.name] = null; continue; }
    out[f.name] = f.type === 'number' ? Number(text) : text;
  }
  for (const f of fields) {
    if (f.required && (out[f.name] === null || out[f.name] === undefined)) {
      throw new Error(`Please fill in "${f.label}".`);
    }
    if (f.type === 'number' && out[f.name] !== null && Number.isNaN(out[f.name])) {
      throw new Error(`"${f.label}" needs to be a number.`);
    }
  }
  return out;
}

// A colored label for due status: Overdue / Due soon / OK / No due date.
export function statusChip(level, text) {
  return `<span class="chip ${level}">${esc(text)}</span>`;
}

// One-tap copy. Puts the text on the clipboard and says so.
export async function copyText(text, what = 'Text') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers: copy from a hidden text box instead.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    if (!ok) { toast('Couldn\'t copy. Press and hold the number to copy it.'); return; }
  }
  toast(`${what} copied`);
}

// Long numbers in groups of three, easier to read aloud:
// 985000000000123 -> 985 000 000 000 123. (Copy uses the plain number.)
export function groupDigits(value) {
  const text = String(value ?? '');
  return /^\d{9,}$/.test(text) ? text.replace(/(\d{3})(?=\d)/g, '$1 ') : text;
}

// Each dog's collar color is its color in the app.
const COLLAR_COLORS = {
  yellow: '#e9b300', orange: '#ec7a1c', red: '#d64545', blue: '#3b7dd8', green: '#3a9d5d',
  purple: '#8a5cd0', pink: '#e06aa6', black: '#444', brown: '#8b5a2b', teal: '#1f9e9e',
};
export function dogColor(dog) {
  return COLLAR_COLORS[(dog.collar_color || '').toLowerCase()] || '#888';
}
// A small colored dot plus the dog's short name.
export function dogTag(dog) {
  return `<span class="dog-tag"><i style="background:${dogColor(dog)}"></i>${esc(dog.short_name || dog.name)}</span>`;
}

// Saves a file the person can keep. On a phone it opens the Share
// sheet (Save to Files, iCloud Drive, email, AirDrop ...); on a
// computer it downloads. Returns 'shared', 'downloaded', or null if
// they cancelled.
export async function saveFile(file) {
  const phone = window.matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return null;   // they closed the Share sheet
      // Anything else (some browsers refuse): fall back to downloading.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
