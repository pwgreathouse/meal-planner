// The shopping list: one running checklist. Add anything by typing; pull in a week's meals with one tap.
import * as db from '../db.js';
import { esc, today, weekStart, addDays, fmtWeek } from '../util.js';
import { getPrefs, savePrefs, AISLES } from '../prefs.js';
import { getList, addManualItem, updateListItem, removeListItems, addWeekToList, weekBatches, listResultText } from '../model.js';
import { ingredientKey } from '../ingredients.js';
import { openSheet, toast } from '../ui.js';

export function shopView(el) {
  let showRecipes = false;

  el.innerHTML = `
    <header class="topbar"><h1>List</h1><button class="btn-text" id="share">Share</button></header>
    <form class="inline-form add-item" id="add">
      <input id="add-name" placeholder="Add an item, e.g. milk or 2 lb chicken" autocomplete="off" enterkeyhint="done" list="list-suggest">
      <button class="btn primary">Add</button>
    </form>
    <datalist id="list-suggest"></datalist>
    <div class="chips scroll-x" id="staples"></div>
    <button class="btn block" id="add-week">＋ Add this week's meals</button>
    <div id="list"></div>`;

  function draw() {
    const prefs = getPrefs();
    const list = getList();
    const onList = new Set(list.items.filter((i) => !i.checked).map((i) => i.key));
    el.querySelector('#staples').innerHTML = prefs.staples
      .filter((s) => !onList.has(ingredientKey(s)))
      .map((s) => `<button class="chip" data-staple="${esc(s)}">＋ ${esc(s)}</button>`)
      .join('');
    // Suggest things bought before.
    el.querySelector('#list-suggest').innerHTML = [...new Set(list.items.map((i) => i.name))].map((n) => `<option value="${esc(n)}">`).join('');

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
      ${done.length ? `<section class="aisle done"><h3>Done <button class="btn-text small" id="clear">Clear ${done.length}</button></h3>${done.map(itemHtml).join('')}</section>` : ''}`;
  }

  function itemHtml(i) {
    return `<div class="item ${i.checked ? 'checked' : ''}">
      <button class="check-btn" data-toggle="${i.id}" aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.name)}"></button>
      <button class="item-body" data-edit="${i.id}">
        <span class="item-name">${esc(i.name)}</span>${i.amount ? `<span class="item-amt">${esc(i.amount)}</span>` : ''}
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
    const st = t.closest('[data-staple]');
    if (st) return addManualItem(st.dataset.staple);
    if (t.id === 'clear') return removeListItems(getList().items.filter((i) => i.checked).map((i) => i.id));
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

  draw();
  return { refresh: (store) => store === 'shopping' && draw() };
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
