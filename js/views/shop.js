// The shopping list: one running checklist. Add anything by typing; pull in a week's meals with one tap.
import * as db from '../db.js';
import { esc, today, weekStart, addDays, fmtWeek } from '../util.js';
import { getPrefs, savePrefs, AISLES } from '../prefs.js';
import { getList, addManualItem, updateListItem, removeListItems, addWeekToList, weekBatches, listResultText } from '../model.js';
import { ingredientKey } from '../ingredients.js';
import { openSheet, toast, attachSuggest, fillWithAmount } from '../ui.js';
import { catalogEntries, searchCatalog, frequentItems, aisleOf, remember, updateEntry, forget } from '../catalog.js';
import { addToPantry } from '../pantry.js';

export function shopView(el) {
  let showRecipes = false;

  el.innerHTML = `
    <header class="topbar"><h1>List</h1><button class="btn-text" id="share">Share</button></header>
    <form class="inline-form add-item" id="add">
      <input id="add-name" placeholder="Add an item, e.g. milk or 2 lb chicken" autocomplete="off" autocorrect="off" enterkeyhint="done">
      <button class="btn primary">Add</button>
    </form>
    <div class="chips scroll-x" id="staples"></div>
    <div class="grid-2 list-actions"><button class="btn" id="your-items">Your items</button><button class="btn" id="add-week">＋ This week's meals</button></div>
    <div id="list"></div>`;

  function draw() {
    const prefs = getPrefs();
    const list = getList();
    const onList = new Set(list.items.filter((i) => !i.checked).map((i) => i.key));
    // Quick picks: staples, then your most-used items. A tap puts it in the box so the amount can be changed first.
    const staplesKeys = new Set(prefs.staples.map(ingredientKey));
    const byKey = Object.fromEntries(catalogEntries().map((x) => [x.key, x]));
    const staples = prefs.staples.filter((x) => !onList.has(ingredientKey(x))).map((x) => byKey[ingredientKey(x)] || { name: x, amount: '' });
    const freq = frequentItems(8, new Set([...onList, ...staplesKeys]));
    el.querySelector('#staples').innerHTML = [...staples, ...freq]
      .map((x) => `<button class="chip" data-pick="${esc(x.name)}" data-amount="${esc(x.amount || '')}">＋ ${esc(x.name)}</button>`)
      .join('');

    const open = list.items.filter((i) => !i.checked);
    const done = list.items.filter((i) => i.checked);
    if (!list.items.length) {
      el.querySelector('#list').innerHTML = `<p class="muted center pad">Your list is empty. Type an item above, tap a staple, or add this week's meals.</p>`;
      return;
    }
    const groups = AISLES.map((a) => [a, open.filter((i) => (AISLES.includes(i.aisle) ? i.aisle : 'Other') === a)]).filter(([, items]) => items.length);
    el.querySelector('#list').innerHTML = `
      <div class="list-meta"><span>${open.length} to get${done.length ? ` · ${done.length} done` : ''}</span>
        <label class="small"><input type="checkbox" id="src" ${showRecipes ? 'checked' : ''}> show recipes</label></div>
      ${groups.map(([a, items]) => `<section class="aisle"><h3>${esc(a)}</h3>${items.map(itemHtml).join('')}</section>`).join('')}
      ${done.length ? `<section class="aisle done"><h3>In the cart
          <span><button class="btn-text small strong" id="to-pantry">Move ${done.length} to pantry</button><button class="btn-text small" id="clear">Clear</button></span></h3>
          ${done.map(itemHtml).join('')}</section>` : ''}`;
  }

  function itemHtml(i) {
    return `<div class="item ${i.checked ? 'checked' : ''}">
      <button class="check-btn" data-toggle="${i.id}" aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.name)}"></button>
      <button class="item-body" data-edit="${i.id}">
        <span class="item-name">${esc(i.name)}</span>${i.amount ? `<span class="item-amt">${esc(i.amount)}${i.have ? ` <small>(have ${esc(i.have)})</small>` : ''}</span>` : ''}
        ${showRecipes && i.recipes?.length ? `<span class="item-src">${esc(i.recipes.join(', '))}</span>` : ''}
      </button></div>`;
  }

  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tog = t.closest('[data-toggle]');
    if (tog) {
      const it = getList().items.find((x) => x.id === tog.dataset.toggle);
      return it && updateListItem(it.id, { checked: !it.checked });
    }
    const ed = t.closest('[data-edit]');
    if (ed) return openItemSheet(ed.dataset.edit);
    const pick = t.closest('[data-pick]');
    if (pick) return fillWithAmount(el.querySelector('#add-name'), pick.dataset.pick, pick.dataset.amount);
    if (t.id === 'your-items') return openYourItems();
    if (t.id === 'clear') return removeListItems(getList().items.filter((i) => i.checked).map((i) => i.id));
    if (t.id === 'to-pantry') return openMoveToPantry();
    if (t.id === 'add-week') return openAddWeek();
    if (t.id === 'src') {
      showRecipes = t.checked;
      draw();
    }
    if (t.id === 'share') shareList();
  });

  el.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = el.querySelector('#add-name');
    const v = inp.value.trim();
    if (!v) return;
    await addManualItem(v);
    inp.value = '';
    inp.focus();
  });

  attachSuggest(el.querySelector('#add-name'), {
    search: (q) => searchCatalog(q),
    label: (x) => `${esc(x.name)}${x.amount ? ` <small>${esc(x.amount)}</small>` : ''}`,
    onPick: (x) => fillWithAmount(el.querySelector('#add-name'), x.name, x.amount),
  });

  draw();
  return { refresh: (store) => (store === 'shopping' || store === 'settings') && draw() };
}

// Every item you've ever added, grouped by aisle. Each has its own amount box: change it, then Add.
// Edit mode renames items, sets their usual amount, or removes them from the catalog.
function openYourItems() {
  let q = '';
  let editing = false;
  const sheet = openSheet(`
    <div class="section-head sheet-head"><h2>Your items</h2><button class="btn-text small" id="yi-edit">Edit</button></div>
    <input type="search" id="yi-q" placeholder="Search your items…" autocomplete="off">
    <div id="yi-list" class="yi-list"></div>`);
  const b = sheet.el;
  const draw = () => {
    const onList = new Set(getList().items.filter((i) => !i.checked).map((i) => i.key));
    const n = q.trim().toLowerCase();
    const items = catalogEntries().filter((x) => !n || x.name.toLowerCase().includes(n)).sort((a, c) => a.name.localeCompare(c.name));
    const groups = AISLES.map((a) => [a, items.filter((x) => aisleOf(x) === a)]).filter(([, g]) => g.length);
    b.querySelector('#yi-edit').textContent = editing ? 'Done' : 'Edit';
    b.querySelector('#yi-list').innerHTML = groups.length
      ? groups.map(([a, g]) => `<section class="aisle"><h3>${esc(a)}</h3>${g.map((x) => `
          <div class="yi-row" data-key="${esc(x.key)}">
            ${editing
              ? `<input class="yi-name" value="${esc(x.name)}" aria-label="Name" autocomplete="off">`
              : `<span class="yi-label">${esc(x.name)}${onList.has(x.key) ? ' <small class="muted">· on list</small>' : ''}</span>`}
            <input class="yi-amt" value="${esc(x.amount || '')}" placeholder="amount" aria-label="Amount" autocomplete="off">
            ${editing
              ? '<button type="button" class="btn-text small" data-save>Save</button><button type="button" class="row-x" data-forget aria-label="Remove">✕</button>'
              : '<button type="button" class="btn small-btn" data-add>Add</button>'}
          </div>`).join('')}</section>`).join('')
      : '<p class="muted center pad">Nothing yet. Items you add to the list or pantry, and recipe ingredients, show up here.</p>';
  };
  b.querySelector('#yi-q').addEventListener('input', (e) => { q = e.target.value; draw(); });
  b.addEventListener('click', async (e) => {
    if (e.target.id === 'yi-edit') { editing = !editing; return draw(); }
    const row = e.target.closest('.yi-row');
    if (!row) return;
    const key = row.dataset.key;
    const amount = row.querySelector('.yi-amt').value.trim();
    if (e.target.closest('[data-add]')) {
      const x = catalogEntries().find((c) => c.key === key);
      await addManualItem(amount ? `${amount} ${x.name}` : x.name);
      toast(`Added ${x.name}${amount ? ` (${amount})` : ''}`);
      draw();
    } else if (e.target.closest('[data-save]')) {
      await updateEntry(key, { name: row.querySelector('.yi-name').value || key, amount });
      toast('Saved');
      draw();
    } else if (e.target.closest('[data-forget]')) {
      await forget(key);
      draw();
    }
  });
  draw();
}

// Checked items go into the pantry at the amount actually bought (remembered for next time), then leave the list.
function openMoveToPantry() {
  const prefs = getPrefs();
  const items = getList().items.filter((i) => i.checked);
  const sheet = openSheet(`
    <h2>Move to pantry</h2>
    <p class="muted small">Change amounts to what you bought, e.g. “1 qt” of broth even if you needed 2 cups. Clear an amount to just mark it as “have it”.</p>
    <form id="mp" class="put-away">
      ${items.map((i) => `<div class="pa-row" data-id="${i.id}">
        <label class="pa-check"><input type="checkbox" name="on" checked> <b>${esc(i.name)}</b></label>
        <div class="pa-fields"><input name="amount" value="${esc(prefs.purchaseSizes?.[i.key] || i.amount || '')}" placeholder="amount (optional)" autocomplete="off"></div>
      </div>`).join('')}
      <button class="btn primary block">Move to pantry</button>
      <p class="muted small center">Unticked items are just cleared from the list.</p>
    </form>`);
  sheet.el.querySelector('#mp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sizes = { ...(getPrefs().purchaseSizes || {}) };
    let n = 0;
    for (const row of sheet.el.querySelectorAll('.pa-row')) {
      const it = items.find((x) => x.id === row.dataset.id);
      if (!row.querySelector('[name=on]').checked) continue;
      const amount = row.querySelector('[name=amount]').value.trim();
      await addToPantry(it.name, amount);
      if (amount && amount !== it.amount) sizes[it.key] = amount;
      n++;
    }
    await savePrefs({ purchaseSizes: sizes });
    await removeListItems(items.map((i) => i.id));
    sheet.close();
    toast(`${n} item${n === 1 ? '' : 's'} moved to the pantry`);
  });
}

// Pick which week's meals to add (this week or next).
function openAddWeek() {
  const thisWeek = weekStart(today());
  const weeks = [thisWeek, addDays(thisWeek, 7)];
  const added = getList().addedWeeks || {};
  const sheet = openSheet(`
    <h2>Add meals to the list</h2>
    <p class="muted small">Adds the ingredients from that week's planned meals, scaled to your servings and combined. Things in your Pantry are skipped.</p>
    ${weeks.map((w, n) => {
      const count = weekBatches(w).length;
      return `<button class="pick" data-week="${w}" ${count ? '' : 'disabled'}>
        <strong>${n ? 'Next week' : 'This week'} <small class="muted">${esc(fmtWeek(w))}</small></strong>
        <small>${count ? `${count} meal${count === 1 ? '' : 's'}${added[w] ? ' · added before' : ''}` : 'nothing planned'}</small></button>`;
    }).join('')}`);
  sheet.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-week]');
    if (!b) return;
    if (added[b.dataset.week] && !confirm('You already added this week once. Add its meals again?')) return;
    const res = await addWeekToList(b.dataset.week);
    sheet.close();
    toast(listResultText(res), 4000);
  });
}

function openItemSheet(id) {
  const item = getList().items.find((i) => i.id === id);
  if (!item) return;
  const sheet = openSheet(`
    <h2>Edit item</h2>
    <form class="form" id="f">
      <label>Item<input name="name" value="${esc(item.name)}"></label>
      <label>Amount<input name="amount" value="${esc(item.amount || '')}" placeholder="e.g. 2 lb"></label>
      <label>Aisle<select name="aisle">${AISLES.map((a) => `<option ${a === item.aisle ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      ${item.recipes?.length ? `<p class="muted small">For: ${esc(item.recipes.join(', '))}</p>` : ''}
      <div class="action-row"><button class="btn primary">Save</button><button type="button" class="btn danger" id="del">Remove</button></div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    const aisle = d.get('aisle');
    if (aisle !== item.aisle) {
      // Remember the aisle for this item from now on.
      await savePrefs({ aisleOverrides: { ...getPrefs().aisleOverrides, [item.key]: aisle } });
    }
    await updateListItem(id, { name: d.get('name').trim() || item.name, amount: d.get('amount').trim(), aisle });
    sheet.close();
  });
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    await removeListItems([id]);
    sheet.close();
  });
}

async function shareList() {
  const open = getList().items.filter((i) => !i.checked);
  const text = AISLES.map((a) => {
    const items = open.filter((i) => (i.aisle || 'Other') === a);
    return items.length ? `${a}\n${items.map((i) => `• ${i.name}${i.amount ? ` (${i.amount})` : ''}`).join('\n')}` : '';
  }).filter(Boolean).join('\n\n');
  if (!text) return toast('List is empty');
  try {
    if (navigator.share) await navigator.share({ title: 'Shopping list', text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  } catch {
    /* share sheet dismissed */
  }
}
