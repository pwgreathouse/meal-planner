// Pantry screen: a plain list of what you have, grouped by aisle. Type to add; tap to edit or remove.
import * as db from '../db.js';
import { esc, normalizeText } from '../util.js';
import { getPrefs, AISLES } from '../prefs.js';
import { guessAisle } from '../aisles.js';
import { ingredientKey } from '../ingredients.js';
import { openSheet, toast } from '../ui.js';
import { pantryItems, amountText, addToPantry, updatePantryItem } from '../pantry.js';

const state = { q: '' };

export function pantryView(el) {
  el.innerHTML = `
    <header class="topbar"><h1>Pantry</h1></header>
    <p class="muted small">What you have on hand. These get skipped when you add meals to your shopping list.</p>
    <form class="inline-form add-item" id="add">
      <input id="add-name" placeholder="Add what you have, e.g. rice or 2 cans beans" autocomplete="off" enterkeyhint="done">
      <button class="btn primary">Add</button>
    </form>
    <input type="search" id="q" class="field-row" placeholder="Search pantry…" value="${esc(state.q)}" autocomplete="off">
    <div id="body"></div>`;

  function draw() {
    const prefs = getPrefs();
    const q = normalizeText(state.q);
    const all = pantryItems();
    const items = (q ? all.filter((p) => normalizeText(p.name).includes(q)) : all).sort((a, b) => a.name.localeCompare(b.name));
    el.querySelector('#q').hidden = all.length < 8;
    const aisleOf = (p) => guessAisle(p.key || ingredientKey(p.name), prefs.aisleOverrides, /\bcans?\b/i.test(amountText(p)) ? 'can' : null);
    const groups = AISLES.map((a) => [a, items.filter((p) => aisleOf(p) === a)]).filter(([, g]) => g.length);
    el.querySelector('#body').innerHTML = !all.length
      ? '<p class="muted center pad">Nothing here yet. Add the things you usually have, like rice, olive oil, spices.</p>'
      : !items.length
        ? `<p class="muted center pad">Nothing matches “${esc(state.q)}”.</p>`
        : groups.map(([a, g]) => `<section class="aisle"><h3>${esc(a)} <small>${g.length}</small></h3>
            ${g.map((p) => `<button class="item pantry-item" data-item="${p.id}">
              <span class="item-body"><span class="item-name">${esc(p.name)}</span>${amountText(p) ? `<span class="item-amt">${esc(amountText(p))}</span>` : ''}</span></button>`).join('')}
          </section>`).join('');
  }

  el.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = el.querySelector('#add-name');
    if (!inp.value.trim()) return;
    await addToPantry(inp.value);
    inp.value = '';
    inp.focus();
  });
  el.querySelector('#q').addEventListener('input', (e) => {
    state.q = e.target.value;
    draw();
  });
  el.addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (row) openItemSheet(row.dataset.item);
  });

  draw();
  return { refresh: (store) => store === 'pantry' && draw() };
}

function openItemSheet(id) {
  const p = db.get('pantry', id);
  if (!p) return;
  const sheet = openSheet(`
    <h2>${esc(p.name)}</h2>
    <form class="form" id="f">
      <label>Item<input name="name" value="${esc(p.name)}" autocomplete="off"></label>
      <label>Amount <small class="muted">optional</small><input name="amount" value="${esc(amountText(p))}" placeholder="e.g. 2 cans, half a bag" autocomplete="off"></label>
      <div class="action-row">
        <button class="btn primary">Save</button>
        <button type="button" class="btn danger" id="del">Used up / tossed</button>
      </div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    await updatePantryItem(p, { name: d.get('name').trim() || p.name, amount: d.get('amount').trim() });
    sheet.close();
  });
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    await db.remove('pantry', p.id);
    sheet.close();
    toast(`Removed ${p.name}`);
  });
}
