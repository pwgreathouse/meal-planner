// Shared UI pieces: toast, bottom sheets, steppers.
import { esc } from './util.js';

export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
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
