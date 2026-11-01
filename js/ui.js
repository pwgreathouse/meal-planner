// Shared UI pieces: toast, bottom sheets, steppers.
import { esc } from './util.js';
import { aisleList } from './prefs.js';

// <option>s for a list-category picker.
export const categoryOptions = (selected) =>
  aisleList().map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

// action: optional { label, run } shown as a button in the toast, e.g. Undo.
export function toast(msg, ms = 2200, action = null) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => {
      t.classList.remove('show');
      action.run();
    };
    t.append(' ', b);
  }
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), action ? Math.max(ms, 5000) : ms);
}

// Opens a bottom sheet. Returns { el, close }.
export function openSheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    if (!document.querySelectorAll('.sheet-wrap.open').length) document.body.classList.remove('sheet-open');
    setTimeout(() => wrap.remove(), 220);
    window.removeEventListener('hashchange', close);
    onClose?.();
  };
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  window.addEventListener('hashchange', close);
  return { el: wrap.querySelector('.sheet-body'), close };
}

export function stepperHtml(name, value, { min = 1, max = 99, label = '' } = {}) {
  return `<div class="stepper" data-stepper="${esc(name)}" data-min="${min}" data-max="${max}">
    ${label ? `<span class="stepper-label">${esc(label)}</span>` : ''}
    <button type="button" class="step-btn" data-step="-1" aria-label="Fewer">−</button>
    <output class="step-val">${value}</output>
    <button type="button" class="step-btn" data-step="1" aria-label="More">+</button>
  </div>`;
}

// Wires every stepper inside root. onChange(name, value) fires after each tap.
export function wireSteppers(root, onChange) {
  root.querySelectorAll('[data-stepper]').forEach((st) => {
    const out = st.querySelector('.step-val');
    st.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const min = +st.dataset.min, max = +st.dataset.max;
      const v = Math.min(max, Math.max(min, +out.textContent + +b.dataset.step));
      out.textContent = v;
      onChange?.(st.dataset.stepper, v);
    });
  });
}

export const stepperValue = (root, name) => +root.querySelector(`[data-stepper="${name}"] .step-val`).textContent;

export function setStepper(root, name, v) {
  const out = root.querySelector(`[data-stepper="${name}"] .step-val`);
  if (out) out.textContent = v;
}

export const emptyState = (title, body, actions = '') =>
  `<div class="empty"><h2>${esc(title)}</h2><p>${body}</p>${actions}</div>`;

// Suggestions under a text box while typing. search(q) returns entries; label(e) is shown; onPick(e) runs on tap.
// The box goes after the input's form or div, or at the end of `container` when given (e.g. a recipe row).
export function attachSuggest(input, { search, label, onPick, container }) {
  const box = document.createElement('div');
  box.className = 'suggest';
  box.hidden = true;
  if (container) container.append(box);
  else input.closest('form, div').insertAdjacentElement('afterend', box);
  let shown = [];
  const draw = () => {
    shown = search(input.value);
    box.innerHTML = shown.map((e, i) => `<button type="button" data-i="${i}">${label(e)}</button>`).join('');
    box.hidden = !shown.length;
  };
  input.addEventListener('input', draw);
  input.addEventListener('focus', () => input.value && draw());
  // Delay hiding so a tap on a suggestion still lands.
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 200));
  box.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    box.hidden = true;
    onPick(shown[+b.dataset.i]);
  });
  return { hide: () => (box.hidden = true) };
}

// Puts "amount name" in a box with the amount selected, so typing replaces it.
export function fillWithAmount(input, name, amount) {
  input.value = amount ? `${amount} ${name}` : name;
  input.focus();
  if (amount) input.setSelectionRange(0, amount.length);
  else input.setSelectionRange(input.value.length, input.value.length);
}

// Drag to reorder rows by their ≡ handle (pointer events, so it works with touch on iPhone too).
// Scrolls the sheet or page when dragging near its top or bottom edge.
export function makeSortable(container, rowSelector, { onMove } = {}) {
  container.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.drag');
    if (!grip) return;
    e.preventDefault();
    const row = grip.closest(rowSelector);
    const sheet = container.closest('.sheet');
    row.classList.add('dragging');
    document.activeElement?.blur?.();
    const move = (ev) => {
      ev.preventDefault();
      const y = ev.clientY;
      const others = [...container.children].filter((r) => r !== row);
      const before = others.find((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if ((before || null) !== row.nextElementSibling) container.insertBefore(row, before || null);
      const top = sheet ? sheet.getBoundingClientRect().top + 60 : 90;
      const step = y < top ? -10 : y > window.innerHeight - 110 ? 10 : 0;
      if (step) (sheet || window).scrollBy(0, step);
    };
    const end = () => {
      row.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      onMove?.();
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
}
