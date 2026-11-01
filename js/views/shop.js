// The shopping list: one running checklist. Add anything (with amount, brand and a note); pull in a week's meals with one tap.
import { esc, today, weekStart, addDays, fmtWeek } from '../util.js';
import { getPrefs, savePrefs, aisleList, aisleName, placeAisle } from '../prefs.js';
import { getList, addListItem, splitItemText, updateListItem, removeListItems, addWeekToList, weekBatches, listResultText } from '../model.js';
import { ingredientKey } from '../ingredients.js';
import { guessAisle } from '../aisles.js';
import { openSheet, toast, attachSuggest } from '../ui.js';
import { catalogEntries, searchCatalog, frequentItems, aisleOf, updateEntry, forget } from '../catalog.js';
import { addToPantry } from '../pantry.js';
import { openCategoryEditor } from './categories.js';

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// [[category id, items]] in the user's category order, empty ones left out.
function grouped(items, aisleFor = (i) => i.aisle) {
  return aisleList().map((a) => [a.id, items.filter((i) => placeAisle(aisleFor(i)) === a.id).sort(byName)]).filter(([, g]) => g.length);
}

export function shopView(el) {
  let showRecipes = false;

  el.innerHTML = `
    <header class="topbar"><h1>List</h1><button class="btn-text" id="share">Share</button></header>
    <button class="btn primary block add-open" id="add-open">＋ Add an item</button>
    <div class="chips scroll-x" id="staples"></div>
    <div class="grid-2 list-actions"><button class="btn" id="your-items">Your items</button><button class="btn" id="add-week">＋ This week's meals</button></div>
    <div id="list"></div>`;

  function draw() {
    const prefs = getPrefs();
    const list = getList();
    const onList = new Set(list.items.filter((i) => !i.checked).map((i) => i.key));
    // Quick picks: staples, then your most-used items. A tap opens the add sheet with its usual amount ready to change.
    const staplesKeys = new Set(prefs.staples.map(ingredientKey));
    const byKey = Object.fromEntries(catalogEntries().map((x) => [x.key, x]));
    const staples = prefs.staples.filter((x) => !onList.has(ingredientKey(x))).map((x) => byKey[ingredientKey(x)] || { name: x, amount: '' });
    const freq = frequentItems(8, new Set([...onList, ...staplesKeys]));
    el.querySelector('#staples').innerHTML = [...staples, ...freq]
      .map((x) => `<button class="chip" data-pick="${esc(x.name)}">＋ ${esc(x.name)}</button>`)
      .join('');

    const open = list.items.filter((i) => !i.checked && !i.later);
    const later = list.items.filter((i) => !i.checked && i.later).sort(byName);
    const done = list.items.filter((i) => i.checked);
    if (!list.items.length) {
      el.querySelector('#list').innerHTML = `<p class="muted center pad">Your list is empty. Add an item, tap a quick pick, or add this week's meals.</p>`;
      return;
    }
    const az = prefs.listSort === 'az';
    const body = az
      ? (open.length ? `<section class="aisle">${[...open].sort(byName).map(itemHtml).join('')}</section>` : '')
      : grouped(open).map(([a, items]) => `<section class="aisle"><h3>${esc(aisleName(a))}</h3>${items.map(itemHtml).join('')}</section>`).join('');
    el.querySelector('#list').innerHTML = `
      <div class="list-meta"><span>${open.length} to get${later.length ? ` · ${later.length} later` : ''}${done.length ? ` · ${done.length} done` : ''}</span>
        <span class="meta-tools">
          <label class="small"><input type="checkbox" id="src" ${showRecipes ? 'checked' : ''}> recipes</label>
          <select id="sort" aria-label="Sort"><option value="aisle">By category</option><option value="az" ${az ? 'selected' : ''}>A–Z</option></select>
        </span></div>
      ${body}
      ${later.length ? `<section class="aisle later"><h3>Out of stock · get next time
          <button class="btn-text small" id="unlater">Back on the list</button></h3>
          ${later.map(itemHtml).join('')}</section>` : ''}
      ${done.length ? `<section class="aisle done"><h3>In the cart
          <span><button class="btn-text small strong" id="to-pantry">Move ${done.length} to pantry</button><button class="btn-text small" id="clear">Clear</button></span></h3>
          ${done.map(itemHtml).join('')}</section>` : ''}
      <p class="center"><button class="btn-text small" id="edit-cats">Edit categories</button></p>`;
  }

  function itemHtml(i) {
    return `<div class="item ${i.checked ? 'checked' : ''} ${i.later ? 'is-later' : ''}">
      <button class="check-btn" data-toggle="${i.id}" aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.name)}"></button>
      <button class="item-body" data-edit="${i.id}">
        <span class="item-name">${esc(i.name)}${i.brand ? ` <span class="item-brand">${esc(i.brand)}</span>` : ''}</span>
        ${i.amount ? `<span class="item-amt">${esc(i.amount)}${i.have ? ` <small>(have ${esc(i.have)})</small>` : ''}</span>` : ''}
        ${i.note ? `<span class="item-note">${esc(i.note)}</span>` : ''}
        ${showRecipes && i.recipes?.length ? `<span class="item-src">${esc(i.recipes.join(', '))}</span>` : ''}
      </button></div>`;
  }

  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tog = t.closest('[data-toggle]');
    if (tog) {
      const it = getList().items.find((x) => x.id === tog.dataset.toggle);
      // Ticking off an out-of-stock item means you found it.
      return it && updateListItem(it.id, { checked: !it.checked, later: false });
    }
    const ed = t.closest('[data-edit]');
    if (ed) return openItemSheet(ed.dataset.edit);
    const pick = t.closest('[data-pick]');
    if (pick) {
      const x = catalogEntries().find((c) => c.key === ingredientKey(pick.dataset.pick)) || { name: pick.dataset.pick };
      return openAddItem(x, { focusAmount: true });
    }
    if (t.id === 'add-open') return openAddItem();
    if (t.id === 'your-items') return openYourItems();
    if (t.id === 'clear') return removeListItems(getList().items.filter((i) => i.checked).map((i) => i.id));
    if (t.id === 'to-pantry') return openMoveToPantry();
    if (t.id === 'add-week') return openAddWeek();
    if (t.id === 'edit-cats') return openCategoryEditor('aisles');
    if (t.id === 'unlater') {
      for (const i of getList().items.filter((x) => x.later && !x.checked)) await updateListItem(i.id, { later: false });
      return;
    }
    if (t.id === 'src') {
      showRecipes = t.checked;
      draw();
    }
    if (t.id === 'share') shareList();
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'sort') savePrefs({ listSort: e.target.value });
  });

  draw();
  return { refresh: (store) => (store === 'shopping' || store === 'settings') && draw() };
}

function aisleOptions(selected) {
  return aisleList().map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}
const usualAisle = (name) => placeAisle(guessAisle(ingredientKey(name), getPrefs().aisleOverrides));

// Add an item with its details: name, amount, category, brand, note. Picking a remembered item fills in its usual ones.
function openAddItem(prefill = {}, { focusAmount = false } = {}) {
  let aisleTouched = false;
  const sheet = openSheet(`
    <h2>Add to list</h2>
    <form class="form" id="f" autocomplete="off">
      <div class="sug-wrap"><label>Item<input name="name" value="${esc(prefill.name || '')}" placeholder="e.g. milk, chicken thighs" autocorrect="off" enterkeyhint="next" required></label></div>
      <div class="grid-2">
        <label>Amount<input name="amount" value="${esc(prefill.amount || '')}" placeholder="e.g. 2 lb, 1 1/2 lb" autocorrect="off" enterkeyhint="next"></label>
        <label>Category<select name="aisle">${aisleOptions(usualAisle(prefill.name || ''))}</select></label>
      </div>
      <label>Brand <small class="muted">optional</small><input name="brand" value="${esc(prefill.brand || '')}" placeholder="e.g. Kerrygold" enterkeyhint="next"></label>
      <label>Note <small class="muted">optional</small><input name="note" value="${esc(prefill.note || '')}" placeholder="e.g. big bag, organic, ask at the deli" enterkeyhint="done"></label>
      <div class="action-row"><button class="btn primary">Add</button><button type="button" class="btn" id="another">Add, then another</button></div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  const field = (n) => f.elements[n];
  const setAisle = () => { if (!aisleTouched) field('aisle').value = usualAisle(field('name').value); };
  field('name').addEventListener('input', setAisle);
  field('aisle').addEventListener('change', () => (aisleTouched = true));
  attachSuggest(field('name'), {
    search: (q) => searchCatalog(q),
    label: (x) => `${esc(x.name)}${x.amount ? ` <small>${esc(x.amount)}</small>` : ''}${x.brand ? ` <small>· ${esc(x.brand)}</small>` : ''}`,
    onPick: (x) => {
      field('name').value = x.name;
      for (const k of ['amount', 'brand', 'note']) if (x[k] && !field(k).value) field(k).value = x[k];
      setAisle();
      field('amount').focus();
      field('amount').select();
    },
  });
  // Return in a box moves to the next one; Return in the last box adds.
  f.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.name === 'note') return;
    e.preventDefault();
    const order = ['name', 'amount', 'brand', 'note'];
    field(order[order.indexOf(e.target.name) + 1] || 'note').focus();
  });

  const add = async () => {
    let name = field('name').value.trim();
    let amount = field('amount').value.trim();
    if (!name) return field('name').focus(), false;
    // "2 lb chicken" typed into the Item box still splits into amount and item.
    if (!amount) ({ name, amount } = splitItemText(name));
    await addListItem({ name, amount, brand: field('brand').value, note: field('note').value, aisle: field('aisle').value });
    toast(`Added ${name}${amount ? ` (${amount})` : ''}`);
    return true;
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await add()) sheet.close();
  });
  sheet.el.querySelector('#another').addEventListener('click', async () => {
    if (!(await add())) return;
    f.reset();
    for (const k of ['name', 'amount', 'brand', 'note']) field(k).value = '';
    aisleTouched = false;
    setAisle();
    field('name').focus();
  });
  setTimeout(() => {
    const target = focusAmount ? field('amount') : field('name');
    target.focus();
    if (focusAmount) target.select();
  }, 250);
}

// Every item you've ever added, grouped by category. Each has its own amount box: change it, then Add.
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
    const items = catalogEntries().filter((x) => !n || x.name.toLowerCase().includes(n));
    const groups = grouped(items, aisleOf);
    b.querySelector('#yi-edit').textContent = editing ? 'Done' : 'Edit';
    b.querySelector('#yi-list').innerHTML = groups.length
      ? groups.map(([a, g]) => `<section class="aisle"><h3>${esc(aisleName(a))}</h3>${g.map((x) => `
          <div class="yi-row" data-key="${esc(x.key)}">
            ${editing
              ? `<input class="yi-name" value="${esc(x.name)}" aria-label="Name" autocomplete="off">`
              : `<span class="yi-label">${esc(x.name)}${x.brand ? ` <small class="muted">${esc(x.brand)}</small>` : ''}${onList.has(x.key) ? ' <small class="muted">· on list</small>' : ''}</span>`}
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
      await addListItem({ name: x.name, amount, brand: x.brand, note: x.note });
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
        <label class="pa-check"><input type="checkbox" name="on" checked> <b>${esc(i.name)}</b>${i.brand ? ` <small class="muted">${esc(i.brand)}</small>` : ''}</label>
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
      await addToPantry(it.name, amount, { brand: it.brand, note: it.note });
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
  const aisle = placeAisle(item.aisle);
  const sheet = openSheet(`
    <h2>Edit item</h2>
    <form class="form" id="f" autocomplete="off">
      <label>Item<input name="name" value="${esc(item.name)}" autocorrect="off"></label>
      <div class="grid-2">
        <label>Amount<input name="amount" value="${esc(item.amount || '')}" placeholder="e.g. 2 lb, 1/2 gallon" autocorrect="off"></label>
        <label>Category<select name="aisle">${aisleOptions(aisle)}</select></label>
      </div>
      <label>Brand <small class="muted">optional</small><input name="brand" value="${esc(item.brand || '')}" placeholder="e.g. Kerrygold"></label>
      <label>Note <small class="muted">optional</small><input name="note" value="${esc(item.note || '')}" placeholder="e.g. big bag, organic"></label>
      ${item.recipes?.length ? `<p class="muted small">For: ${esc(item.recipes.join(', '))}</p>` : ''}
      <button type="button" class="btn block" id="later">${item.later ? '✓ Found it, back on the list' : '⚑ Out of stock, get next time'}</button>
      <div class="action-row"><button class="btn primary">Save</button><button type="button" class="btn danger" id="del">Remove</button></div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  const save = async (extra = {}) => {
    const d = new FormData(f);
    const next = d.get('aisle');
    // Remember the category for this item from now on.
    if (next !== aisle) await savePrefs({ aisleOverrides: { ...getPrefs().aisleOverrides, [item.key]: next } });
    await updateListItem(id, {
      name: d.get('name').trim() || item.name, amount: d.get('amount').trim(), aisle: next,
      brand: d.get('brand').trim(), note: d.get('note').trim(), ...extra,
    });
    sheet.close();
  };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  sheet.el.querySelector('#later').addEventListener('click', async () => {
    const wasLater = !!item.later;
    await save({ later: !wasLater, checked: false });
    toast(wasLater ? 'Back on the list' : `${item.name} saved for next time`);
  });
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    await removeListItems([id]);
    sheet.close();
  });
}

async function shareList() {
  const items = getList().items.filter((i) => !i.checked);
  const line = (i) => `• ${i.name}${i.amount ? ` (${i.amount})` : ''}${i.brand ? `, ${i.brand}` : ''}${i.note ? ` — ${i.note}` : ''}`;
  const now = items.filter((i) => !i.later);
  const later = items.filter((i) => i.later);
  const sections = getPrefs().listSort === 'az'
    ? [now.length ? now.sort(byName).map(line).join('\n') : '']
    : grouped(now).map(([a, g]) => `${aisleName(a)}\n${g.map(line).join('\n')}`);
  if (later.length) sections.push(`Out of stock last time\n${later.sort(byName).map(line).join('\n')}`);
  const text = sections.filter(Boolean).join('\n\n');
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
