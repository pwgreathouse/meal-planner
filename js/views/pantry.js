// Pantry screen: a plain list of what you have, grouped by aisle. Type to add; tap to edit or remove.
import * as db from '../db.js';
import { esc, normalizeText } from '../util.js';
import { getPrefs, savePrefs, aisleList, aisleName, placeAisle } from '../prefs.js';
import { guessAisle } from '../aisles.js';
import { ingredientKey } from '../ingredients.js';
import { openSheet, toast, attachSuggest, fillWithAmount, categoryOptions } from '../ui.js';
import { setItemCategory } from '../model.js';
import { searchCatalog, leadingAmount } from '../catalog.js';
import { pantryItems, amountText, addTextToPantry, updatePantryItem, planDeductions, applyDeductions, formatPantryAmount, isCounted, stepCount, removePantryItems, restorePantryItems } from '../pantry.js';

const state = { q: '' };
const aisleOf = (p) => placeAisle(guessAisle(p.key || ingredientKey(p.name), getPrefs().aisleOverrides, /\bcans?\b/i.test(amountText(p)) ? 'can' : null));

// "Removed Milk · Undo": puts removed items back if tapped.
function undoable(copies, verb) {
  if (!copies.length) return;
  const what = copies.length === 1 ? copies[0].name : `${copies.length} items`;
  toast(`${verb} ${what}`, 5000, { label: 'Undo', run: () => restorePantryItems(copies) });
}

export function pantryView(el) {
  let selected = null; // Set of ticked ids while in Select mode
  el.innerHTML = `
    <header class="topbar"><h1>Pantry</h1><button class="btn-text" id="select">Select</button></header>
    <div class="sel-bar" id="sel-bar" hidden><button class="btn danger" id="sel-remove">Remove</button><button class="btn" id="sel-done" data-cancel>Cancel</button></div>
    <p class="muted small">What you have on hand. Add an amount (“2 cups”, “1 1/2 lb”) and the shopping list buys only what's missing; leave it off and it counts as “have it”.</p>
    <form class="inline-form add-item" id="add">
      <input id="add-name" placeholder="Add what you have, e.g. rice or 2 cans beans" autocomplete="off" autocorrect="off" enterkeyhint="done">
      <button class="btn primary">Add</button>
    </form>
    <div class="list-meta"><input type="search" id="q" placeholder="Search pantry…" value="${esc(state.q)}" autocomplete="off">
      <select id="sort" aria-label="Sort"><option value="aisle">By category</option><option value="az">A–Z</option></select></div>
    <div id="body"></div>`;

  function draw() {
    const prefs = getPrefs();
    const q = normalizeText(state.q);
    const all = pantryItems();
    const items = (q ? all.filter((p) => normalizeText(p.name).includes(q)) : all).sort((a, b) => a.name.localeCompare(b.name));
    el.querySelector('#q').hidden = all.length < 8;
    el.querySelector('#sort').hidden = !all.length;
    const az = prefs.pantrySort === 'az';
    el.querySelector('#sort').value = az ? 'az' : 'aisle';
    const groups = az ? [['', items]] : aisleList().map((a) => [a.id, items.filter((p) => aisleOf(p) === a.id)]).filter(([, g]) => g.length);
    el.querySelector('#body').innerHTML = !all.length
      ? '<p class="muted center pad">Nothing here yet. Add the things you usually have, like rice, olive oil, spices.</p>'
      : !items.length
        ? `<p class="muted center pad">Nothing matches “${esc(state.q)}”.</p>`
        : groups.map(([a, g]) => `<section class="aisle">${a ? `<h3>${esc(aisleName(a))} <small>${g.length}</small></h3>` : ''}
            ${g.map(rowHtml).join('')}
          </section>`).join('');
    el.querySelector('#select').textContent = selected ? 'Done' : 'Select';
    el.querySelector('#select').hidden = !all.length;
    el.querySelector('#sel-bar').hidden = !selected;
    if (selected) {
      el.querySelector('#sel-remove').textContent = selected.size ? `Remove ${selected.size}` : 'Remove';
      el.querySelector('#sel-remove').disabled = !selected.size;
    }
  }

  // Tap the name to edit; − / + for things counted in whole items; ✕ when it's used up or tossed.
  // In Select mode, tapping rows ticks them for removing several at once.
  function rowHtml(p) {
    const body = `<span class="item-name">${esc(p.name)}${p.brand ? ` <span class="item-brand">${esc(p.brand)}</span>` : ''}</span>${amountText(p) ? `<span class="item-amt">${esc(amountText(p))}</span>` : ''}${p.note ? `<span class="item-note">${esc(p.note)}</span>` : ''}`;
    if (selected) {
      return `<label class="item pantry-item selecting"><input type="checkbox" data-sel="${p.id}" ${selected.has(p.id) ? 'checked' : ''}><span class="item-body">${body}</span></label>`;
    }
    return `<div class="item pantry-item">
      <button class="item-body" data-item="${p.id}">${body}</button>
      ${isCounted(p) ? `<button class="qty-btn" data-step="-1" data-id="${p.id}" aria-label="One fewer ${esc(p.name)}">−</button><button class="qty-btn" data-step="1" data-id="${p.id}" aria-label="One more ${esc(p.name)}">+</button>` : ''}
      <button class="row-x" data-gone="${p.id}" aria-label="Used up: ${esc(p.name)}">✕</button>
    </div>`;
  }

  el.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = el.querySelector('#add-name');
    if (!inp.value.trim()) return;
    await addTextToPantry(inp.value);
    inp.value = '';
    inp.focus();
  });
  el.querySelector('#q').addEventListener('input', (e) => {
    state.q = e.target.value;
    draw();
  });
  el.querySelector('#sort').addEventListener('change', (e) => savePrefs({ pantrySort: e.target.value }));
  el.addEventListener('change', (e) => {
    const box = e.target.closest('[data-sel]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.sel);
    else selected.delete(box.dataset.sel);
    draw();
  });
  el.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'select' || t.id === 'sel-done') {
      selected = selected ? null : new Set();
      return draw();
    }
    if (t.id === 'sel-remove') {
      const copies = await removePantryItems([...selected]);
      selected = null;
      draw();
      return undoable(copies, 'Removed');
    }
    const step = t.closest('[data-step]');
    if (step) {
      const p = db.get('pantry', step.dataset.id);
      const gone = p && (await stepCount(p, +step.dataset.step));
      return gone && undoable([gone], 'Used up');
    }
    const x = t.closest('[data-gone]');
    if (x) return undoable(await removePantryItems([x.dataset.gone]), 'Removed');
    const row = t.closest('[data-item]');
    if (row) openItemSheet(row.dataset.item);
  });

  attachSuggest(el.querySelector('#add-name'), {
    search: (q) => searchCatalog(q),
    label: (x) => esc(x.name),
    // Keeps an amount already typed: "2 cans bla" + pick → "2 cans Black beans".
    onPick: (x) => fillWithAmount(el.querySelector('#add-name'), x.name, leadingAmount(el.querySelector('#add-name').value)),
  });

  draw();
  return { refresh: (store) => (store === 'pantry' || store === 'settings') && draw() };
}

function openItemSheet(id) {
  const p = db.get('pantry', id);
  if (!p) return;
  const sheet = openSheet(`
    <h2>${esc(p.name)}</h2>
    <form class="form" id="f">
      <div class="sug-wrap"><label>Item<input name="name" value="${esc(p.name)}" autocomplete="off" autocorrect="off"></label></div>
      <label>Amount <small class="muted">optional</small><input name="amount" value="${esc(amountText(p))}" placeholder="e.g. 2 cups, 1 1/2 lb, 1 (14.5 oz) can" autocomplete="off"></label>
      <label>Category<select name="aisle">${categoryOptions(aisleOf(p))}</select></label>
      <label>Brand <small class="muted">optional</small><input name="brand" value="${esc(p.brand || '')}" autocomplete="off"></label>
      <label>Note <small class="muted">optional</small><input name="note" value="${esc(p.note || '')}" placeholder="e.g. in the basement freezer" autocomplete="off"></label>
      <div class="action-row">
        <button class="btn primary">Save</button>
        <button type="button" class="btn danger" id="del">Used up / tossed</button>
      </div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  attachSuggest(f.elements.name, { search: (q) => searchCatalog(q), label: (x) => esc(x.name), onPick: (x) => (f.elements.name.value = x.name) });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    await updatePantryItem(p, { name: d.get('name').trim() || p.name, amount: d.get('amount').trim(), brand: d.get('brand').trim(), note: d.get('note').trim() });
    // Remember the category for this item from now on (list and Your items too).
    if (aisleOf(p) !== d.get('aisle')) await setItemCategory(p.key, d.get('aisle'));
    sheet.close();
  });
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    const copies = await removePantryItems([p.id]);
    sheet.close();
    undoable(copies, 'Removed');
  });
}

// After a meal is marked made: show what comes out of the pantry, let the user untick anything, then subtract.
// Amounts that can be worked out are ticked; items that can't be measured are offered as "used it up", unticked.
export function openDeductSheet(recipe, servings) {
  const rows = planDeductions(recipe, servings);
  if (!rows.length) return false;
  const left = (r) => (r.after <= 0.02 ? 'used up' : `${formatPantryAmount(r.after, r.unit, r.size)} left`);
  const row = (r) => {
    const i = rows.indexOf(r);
    return r.kind === 'use'
      ? `<label class="deduct-row"><input type="checkbox" data-row="${i}" checked>
           <span><b>${esc(r.name)}</b>${r.for ? ` <small class="muted">(${esc(r.for)})</small>` : ''}: −${esc(r.used)} → ${esc(left(r))}</span></label>`
      : `<label class="deduct-row"><input type="checkbox" data-row="${i}">
           <span><b>${esc(r.name)}</b>: used it up <small class="muted">· ${esc(r.why)}</small></span></label>`;
  };
  const use = rows.filter((r) => r.kind === 'use');
  const maybe = rows.filter((r) => r.kind === 'remove');
  const sheet = openSheet(`
    <h2>Update pantry?</h2>
    <p class="muted small">From making ${esc(recipe.title)} (${servings} servings).</p>
    ${use.length ? `<p class="small">Taking out what the recipe used. Untick anything that's not right.</p><div class="deduct">${use.map(row).join('')}</div>` : ''}
    ${maybe.length ? `<p class="small">Also in your pantry. Tick anything you used up and it's removed; the rest stays.</p><div class="deduct">${maybe.map(row).join('')}</div>` : ''}
    <div class="action-row"><button class="btn primary" id="apply">Update pantry</button><button class="btn" data-close>Skip</button></div>`);
  sheet.el.querySelector('#apply').addEventListener('click', async () => {
    const ticked = (r) => sheet.el.querySelector(`[data-row="${rows.indexOf(r)}"]`).checked;
    // Rows for the same item build on each other, so an unticked row drops that item entirely.
    const skipped = new Set(use.filter((r) => !ticked(r)).map((r) => r.itemId));
    const chosen = [...use.filter((r) => !skipped.has(r.itemId)), ...maybe.filter(ticked)];
    if (!chosen.length) { sheet.close(); return toast('Pantry unchanged'); }
    const res = await applyDeductions(chosen);
    sheet.close();
    toast(`Pantry updated${res.removed ? ` · ${res.removed} used up` : ''}`);
  });
  return true;
}
