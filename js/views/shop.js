// Shopping list for a week: built from the plan, grouped by aisle, with manual items and staples.
import * as db from '../db.js';
import { esc, today, weekStart, addDays, fmtWeek } from '../util.js';
import { getPrefs, savePrefs, AISLES } from '../prefs.js';
import { getShopping, syncShopping, addManualItem } from '../model.js';
import { ingredientKey } from '../ingredients.js';
import { openSheet, toast, emptyState } from '../ui.js';
import { addToPantry, defaultsFor, LOCATIONS } from '../pantry.js';

export function shopView(el, startParam) {
  const start = startParam || defaultShopWeek();
  let showSources = false;

  el.innerHTML = `
    <header class="topbar"><h1>Shopping</h1><button class="btn-text" id="share">Share</button></header>
    <div class="week-nav">
      <a class="btn-icon" href="#/shop/${addDays(start, -7)}" aria-label="Previous week">‹</a>
      <div class="week-label"><strong>${esc(fmtWeek(start))}</strong><small><a href="#/plan/${start}">View plan</a></small></div>
      <a class="btn-icon" href="#/shop/${addDays(start, 7)}" aria-label="Next week">›</a>
    </div>
    <form class="inline-form add-item" id="add"><input id="add-name" placeholder="Add an item…" autocomplete="off" enterkeyhint="done"><button class="btn">Add</button></form>
    <div class="chips scroll-x" id="staples"></div>
    <div id="list"></div>`;

  function draw() {
    const prefs = getPrefs();
    const list = getShopping(start);
    const haveKeys = new Set(list.items.map((i) => i.key));
    el.querySelector('#staples').innerHTML = prefs.staples
      .filter((s) => !haveKeys.has(ingredientKey(s)))
      .map((s) => `<button class="chip" data-staple="${esc(s)}">＋ ${esc(s)}</button>`)
      .join('');

    const visible = list.items.filter((i) => !i.hidden && !(i.have && !i.checked));
    const haveItems = list.items.filter((i) => !i.hidden && i.have && !i.checked);
    const open = visible.filter((i) => !i.checked);
    const done = visible.filter((i) => i.checked);
    const toPutAway = done.filter((i) => !i.putAway);
    if (!visible.length && !haveItems.length) {
      el.querySelector('#list').innerHTML = emptyState(
        'Nothing on the list yet',
        'Add recipes to this week’s plan and their ingredients show up here, combined and grouped by aisle.',
        `<a class="btn primary" href="#/plan/${start}">Go to plan</a>`
      );
      return;
    }
    const groups = AISLES.map((a) => [a, open.filter((i) => (AISLES.includes(i.aisle) ? i.aisle : 'Other') === a)]).filter(([, items]) => items.length);
    el.querySelector('#list').innerHTML = `
      <div class="list-meta"><span>${open.length} to get${done.length ? ` · ${done.length} in cart` : ''}</span>
        <label class="small"><input type="checkbox" id="src" ${showSources ? 'checked' : ''}> show recipes</label></div>
      ${groups.map(([a, items]) => `<section class="aisle"><h3>${esc(a)}</h3>${items.map(itemHtml).join('')}</section>`).join('')}
      ${done.length ? `<section class="aisle done"><h3>In cart
          <span>${toPutAway.length ? `<button class="btn-text small strong" id="put-away">Put away ${toPutAway.length}</button>` : ''}<button class="btn-text small" id="clear">Clear</button></span></h3>
          ${done.map(itemHtml).join('')}</section>` : ''}
      ${haveItems.length ? `<details class="aisle have"><summary><h3>Already in pantry (${haveItems.length})</h3></summary>
          ${haveItems.map(itemHtml).join('')}</details>` : ''}`;
  }

  function itemHtml(i) {
    return `<div class="item ${i.checked ? 'checked' : ''}" data-item="${i.id}">
      <button class="check-btn" data-toggle="${i.id}" aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.name)}"></button>
      <button class="item-body" data-edit="${i.id}">
        <span class="item-name">${esc(i.name)}${i.putAway ? ' <small class="muted">· put away</small>' : ''}</span>
        ${i.have ? `<span class="item-amt">have ${esc(i.haveText)}</span>` : i.amount ? `<span class="item-amt">${esc(i.amount)}${i.haveText ? ` <small>(have ${esc(i.haveText)})</small>` : ''}</span>` : ''}
        ${showSources && i.sources?.length ? `<span class="item-src">${esc(i.sources.join(', '))}</span>` : ''}
      </button></div>`;
  }

  async function mutate(fn) {
    const list = getShopping(start);
    fn(list);
    await db.put('shopping', list);
  }

  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tog = t.closest('[data-toggle]');
    if (tog) return mutate((l) => { const i = l.items.find((x) => x.id === tog.dataset.toggle); if (i) i.checked = !i.checked; });
    const ed = t.closest('[data-edit]');
    if (ed) return openItemSheet(start, ed.dataset.edit);
    const st = t.closest('[data-staple]');
    if (st) return addManualItem(start, st.dataset.staple);
    if (t.id === 'clear') {
      if (!confirm('Remove checked items from the list?')) return;
      // Plan items stay hidden by keeping them checked; manual items are deleted.
      return mutate((l) => { l.items = l.items.filter((i) => !(i.checked && !i.fromPlan)); l.items.forEach((i) => { if (i.checked) i.hidden = true; }); });
    }
    if (t.id === 'put-away') return openPutAway(start);
    if (t.id === 'src') {
      showSources = t.checked;
      draw();
    }
    if (t.id === 'share') shareList(start);
  });
  el.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = el.querySelector('#add-name');
    const v = inp.value.trim();
    if (!v) return;
    await addManualItem(start, v);
    inp.value = '';
  });

  syncShopping(start).then(draw);
  draw();
  return {
    refresh: (store) => {
      if (store === 'shopping') draw();
      if (store === 'pantry' || store === 'recipes' || store === 'weeks') syncShopping(start);
    },
  };
}

// Moves checked items into the pantry at the size actually bought (remembered for next time).
function openPutAway(start) {
  const prefs = getPrefs();
  const items = getShopping(start).items.filter((i) => i.checked && !i.putAway && !i.hidden);
  const sheet = openSheet(`
    <h2>Put away</h2>
    <p class="muted small">Adjust to what you actually bought, e.g. “1 qt” of broth even if recipes need 2 cups. Leftovers stay in the pantry.</p>
    <form id="pa" class="put-away">
      ${items.map((i) => {
        const d = defaultsFor(i.name, null);
        const amount = prefs.purchaseSizes[i.key] || i.amount || '';
        return `<div class="pa-row" data-id="${i.id}">
          <label class="pa-check"><input type="checkbox" name="on" checked> <b>${esc(i.name)}</b></label>
          <div class="pa-fields">
            <input name="amount" value="${esc(amount)}" placeholder="amount, e.g. 1 qt">
            <select name="location">${LOCATIONS.map((l) => `<option ${l === d.location ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input name="expires" type="date" value="${esc(d.expires)}" aria-label="Use by">
          </div>
        </div>`;
      }).join('')}
      <button class="btn primary block">Add to pantry</button>
    </form>`);
  sheet.el.querySelector('#pa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sizes = { ...getPrefs().purchaseSizes };
    const list = getShopping(start);
    let n = 0;
    for (const row of sheet.el.querySelectorAll('.pa-row')) {
      const it = list.items.find((x) => x.id === row.dataset.id);
      if (!it) continue;
      it.putAway = true; // unchecked rows are just marked handled
      if (!row.querySelector('[name=on]').checked) continue;
      const amount = row.querySelector('[name=amount]').value.trim();
      await addToPantry({
        name: it.name, amount, source: 'shopping',
        location: row.querySelector('[name=location]').value,
        expires: row.querySelector('[name=expires]').value,
      });
      if (amount) sizes[it.key] = amount;
      n++;
    }
    await savePrefs({ purchaseSizes: sizes });
    await db.put('shopping', list);
    sheet.close();
    toast(`${n} item${n === 1 ? '' : 's'} added to pantry`);
  });
}

// Saturday or Sunday: the list you're about to shop for is next week's (Sat) or this week's (Sun).
function defaultShopWeek() {
  const t = today();
  return new Date().getDay() === 6 ? addDays(weekStart(t), 7) : weekStart(t);
}

function openItemSheet(start, id) {
  const list = getShopping(start);
  const item = list.items.find((i) => i.id === id);
  if (!item) return;
  const sheet = openSheet(`
    <h2>Edit item</h2>
    <form class="form" id="f">
      <label>Item<input name="name" value="${esc(item.name)}"></label>
      <label>Amount<input name="amount" value="${esc(item.amount || '')}" placeholder="e.g. 2 lb"></label>
      <label>Aisle<select name="aisle">${AISLES.map((a) => `<option ${a === item.aisle ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      ${item.sources?.length ? `<p class="muted small">For: ${esc(item.sources.join(', '))}</p>` : ''}
      <div class="action-row"><button class="btn primary">Save</button><button type="button" class="btn danger" id="del">Remove</button></div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(f);
    const aisle = d.get('aisle');
    if (aisle !== item.aisle) {
      // Remember the aisle for this ingredient from now on.
      const prefs = getPrefs();
      await savePrefs({ aisleOverrides: { ...prefs.aisleOverrides, [item.key]: aisle } });
    }
    const name = d.get('name').trim() || item.name;
    const amount = d.get('amount').trim();
    const l = getShopping(start);
    const it = l.items.find((i) => i.id === id);
    Object.assign(it, { aisle, edited: it.edited || name !== item.name || amount !== (item.amount || ''), name, amount });
    await db.put('shopping', l);
    sheet.close();
  });
  sheet.el.querySelector('#del').addEventListener('click', async () => {
    const l = getShopping(start);
    const it = l.items.find((i) => i.id === id);
    if (it.fromPlan) {
      it.checked = true;
      it.hidden = true;
    } else {
      l.items = l.items.filter((i) => i.id !== id);
    }
    await db.put('shopping', l);
    sheet.close();
  });
}

async function shareList(start) {
  const list = getShopping(start);
  const open = list.items.filter((i) => !i.checked);
  const text = AISLES.map((a) => {
    const items = open.filter((i) => (i.aisle || 'Other') === a);
    return items.length ? `${a}\n${items.map((i) => `• ${i.name}${i.amount ? ` — ${i.amount}` : ''}`).join('\n')}` : '';
  }).filter(Boolean).join('\n\n');
  if (!text) return toast('List is empty');
  try {
    if (navigator.share) await navigator.share({ title: `Shopping ${fmtWeek(start)}`, text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  } catch {
    /* share sheet dismissed */
  }
}
