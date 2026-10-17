// Pantry screen: what's on hand by location, use-soon items, cook-from-pantry ideas, and the cooking deduction sheet.
import * as db from '../db.js';
import { esc, today, addDays, fromISO, normalizeText } from '../util.js';
import { openSheet, toast, emptyState } from '../ui.js';
import {
  LOCATIONS, pantryItems, formatItemAmount, defaultsFor, addToPantry, parseAmount, pantryMatches, planDeductions, applyDeductions,
} from '../pantry.js';
import { formatAmount, formatQty, unitLabel } from '../units.js';
import { ingredientKey } from '../ingredients.js';
import { aiReady, aiSuggest } from '../ai.js';
import { getPrefs } from '../prefs.js';
import { importUrl } from './add.js';

const state = { q: '' };

function daysLeft(iso) {
  if (!iso) return null;
  return Math.round((fromISO(iso) - fromISO(today())) / 86400000);
}

function expiryLabel(iso) {
  const d = daysLeft(iso);
  if (d == null) return '';
  if (d < 0) return `<span class="exp bad">expired</span>`;
  if (d === 0) return `<span class="exp bad">use today</span>`;
  if (d <= 3) return `<span class="exp warn">${d} day${d === 1 ? '' : 's'}</span>`;
  return `<span class="exp">${esc(fromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>`;
}

export function pantryView(el) {
  el.innerHTML = `
    <header class="topbar"><h1>Pantry</h1><button class="btn-icon" id="add" aria-label="Add to pantry">＋</button></header>
    <div class="search-bar"><input type="search" id="q" placeholder="Search pantry…" value="${esc(state.q)}" autocomplete="off"></div>
    <div id="body"></div>`;

  function draw() {
    const all = pantryItems();
    const q = normalizeText(state.q);
    const items = q ? all.filter((p) => normalizeText(p.name).includes(q)) : all;
    const body = el.querySelector('#body');
    if (!all.length) {
      body.innerHTML = emptyState(
        'Pantry is empty',
        'Add what you have on hand, or tap “Put away” on the shopping list after a trip and it fills in automatically.',
        '<button class="btn primary" id="add2">Add an item</button>'
      );
      return;
    }
    const soonCut = addDays(today(), 3);
    const soon = items.filter((p) => p.expires && p.expires <= soonCut).sort((a, b) => a.expires.localeCompare(b.expires));
    const ideas = q ? [] : pantryMatches().slice(0, 5);
    const byName = (a, b) => a.name.localeCompare(b.name);
    body.innerHTML = `
      ${!q ? `<section class="ideas"><div class="section-head ideas-head"><h2>Cook from what you have</h2>
          ${aiReady() ? '<button class="btn-text strong" id="ai-ideas">✨ More ideas</button>' : ''}</div>
        ${ideas.map((m) => `<a class="card idea" href="#/recipe/${m.r.id}">
          <div class="card-title">${esc(m.r.title)}</div>
          <div class="card-sub">have ${m.have} of ${m.total}${m.usesSoon ? ` · <b>uses ${m.usesSoon} expiring soon</b>` : ''}${m.missing.length && m.missing.length <= 3 ? ` · need ${esc(m.missing.join(', '))}` : ''}</div></a>`).join('')
          || '<p class="muted small">None of your saved recipes match yet.</p>'}
      </section>` : ''}
      ${soon.length ? `<section class="aisle"><h3>Use soon</h3>${soon.map(rowHtml).join('')}</section>` : ''}
      ${LOCATIONS.map((loc) => {
        const rows = items.filter((p) => p.location === loc).sort(byName);
        return rows.length ? `<section class="aisle"><h3>${loc} <small>${rows.length}</small></h3>${rows.map(rowHtml).join('')}</section>` : '';
      }).join('')}
      ${!items.length ? `<p class="muted center pad">Nothing matches “${esc(state.q)}”.</p>` : ''}`;
  }

  function rowHtml(p) {
    return `<button class="item pantry-item" data-item="${p.id}">
      <span class="item-body"><span class="item-name">${esc(p.name)}</span><span class="item-amt">${esc(formatItemAmount(p))}</span></span>
      ${expiryLabel(p.expires)}</button>`;
  }

  el.querySelector('#q').addEventListener('input', (e) => {
    state.q = e.target.value;
    draw();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('#ai-ideas')) return openAiIdeas();
    if (e.target.closest('#add, #add2')) return openItemSheet(null);
    const row = e.target.closest('[data-item]');
    if (row) openItemSheet(row.dataset.item);
  });

  draw();
  return { refresh: (store) => (store === 'pantry' || store === 'recipes') && draw() };
}

function amountText(p) {
  if (!p || p.qty == null) return '';
  let s = formatAmount(p.qty, p.unit);
  if (p.size) s = `${formatQty(p.qty)} (${formatQty(p.size.qty)} ${unitLabel(p.size.unit, p.size.qty)}) ${p.unit ? unitLabel(p.unit, p.qty) : ''}`.trim();
  return s;
}

// Add or edit one item. Editing offers Used up and Tossed.
function openItemSheet(id) {
  const p = id ? db.get('pantry', id) : null;
  const d = p ? { location: p.location, expires: p.expires } : { location: 'Pantry', expires: '' };
  const sheet = openSheet(`
    <h2>${p ? esc(p.name) : 'Add to pantry'}</h2>
    <form class="form" id="f">
      <label>Item<input name="name" value="${esc(p?.name || '')}" required placeholder="e.g. Chicken broth" autocomplete="off"></label>
      <label>Amount <small class="muted">e.g. 1 qt, 2 cans (14 oz), 1 lb — blank if you're not sure</small>
        <input name="amount" value="${esc(amountText(p))}" autocomplete="off"></label>
      <div class="grid-2">
        <label>Where<select name="location">${LOCATIONS.map((l) => `<option ${l === d.location ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Use by<input name="expires" type="date" value="${esc(d.expires || '')}"></label>
      </div>
      <div class="action-row">
        <button class="btn primary">${p ? 'Save' : 'Add'}</button>
        ${p ? '<button type="button" class="btn" data-out="used">Used up</button><button type="button" class="btn danger" data-out="tossed">Tossed</button>' : '<button type="button" class="btn" id="add-more">Add & next</button>'}
      </div>
    </form>`);
  const f = sheet.el.querySelector('#f');
  const nameInput = f.querySelector('[name=name]');

  // Suggest where a new item lives and when it goes off, once its name is known.
  if (!p) {
    nameInput.addEventListener('change', () => {
      const dd = defaultsFor(nameInput.value, null);
      f.querySelector('[name=location]').value = dd.location;
      if (!f.querySelector('[name=expires]').value) f.querySelector('[name=expires]').value = dd.expires;
    });
    setTimeout(() => nameInput.focus(), 250);
  }

  const save = async () => {
    const fd = new FormData(f);
    const name = fd.get('name').trim();
    if (!name) return false;
    if (p) {
      const { qty, unit, size } = parseAmount(fd.get('amount'), name);
      Object.assign(p, { name, key: ingredientKey(name), qty, unit, size, location: fd.get('location'), expires: fd.get('expires') || '' });
      await db.put('pantry', p);
    } else {
      await addToPantry({ name, amount: fd.get('amount'), location: fd.get('location'), expires: fd.get('expires') || '' });
    }
    return true;
  };

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await save()) {
      sheet.close();
      toast(p ? 'Saved' : 'Added');
    }
  });
  sheet.el.querySelector('#add-more')?.addEventListener('click', async () => {
    if (!(await save())) return;
    toast(`Added ${nameInput.value}`);
    f.reset();
    nameInput.focus();
  });
  sheet.el.querySelectorAll('[data-out]').forEach((b) =>
    b.addEventListener('click', async () => {
      await db.remove('pantry', p.id);
      sheet.close();
      toast(b.dataset.out === 'tossed' ? `Tossed ${p.name}` : `${p.name} used up`);
    })
  );
}

// AI meal ideas from the pantry: saved recipes first, plus real recipes found on the web.
function openAiIdeas() {
  const opts = { meal: '', web: true };
  const sheet = openSheet(`
    <h2>✨ Ideas from your pantry</h2>
    <p class="muted small">Looks at what you have (and what's expiring) and suggests meals from your recipes and the web.</p>
    <div class="field-label">For</div>
    <div class="chips wrap" id="meal">${['Any', 'Breakfast', 'Lunch', 'Dinner', 'Snack'].map((m, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-meal="${i ? m.toLowerCase() : ''}">${m}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="web" checked> Include new recipes from the web</label>
    <input id="notes" class="field-row" placeholder="Anything else? e.g. quick, no spicy, use the chicken" autocomplete="off">
    <button class="btn primary block" id="go">Find ideas</button>
    <p class="muted small center" id="cost">About 15–20¢ with web search, 2–3¢ without.</p>
    <div id="results" class="ideas"></div>`);
  const b = sheet.el;
  b.querySelector('#meal').addEventListener('click', (e) => {
    const c = e.target.closest('[data-meal]');
    if (!c) return;
    opts.meal = c.dataset.meal;
    b.querySelectorAll('#meal .chip').forEach((x) => x.classList.toggle('on', x === c));
  });
  b.querySelector('#go').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Thinking… (up to a minute)';
    const results = b.querySelector('#results');
    results.innerHTML = '';
    try {
      const prefs = getPrefs();
      const ideas = await aiSuggest({
        pantry: pantryItems().map((p) => ({ name: p.name, amount: p.qty == null ? '' : formatItemAmount(p), expires: p.expires })),
        recipes: db.all('recipes').map((r) => ({ id: r.id, title: r.title, ingredients: (r.ingredients || []).filter((i) => !i.header).map((i) => i.name) })),
        basics: prefs.basics,
        meal: opts.meal,
        notes: b.querySelector('#notes').value.trim(),
        web: b.querySelector('#web').checked,
      });
      results.innerHTML = ideas.length
        ? ideas.map((i, n) => {
            const saved = i.source === 'saved' && db.get('recipes', i.recipe_id);
            return `<div class="card idea">
              <div class="card-title">${esc(saved ? saved.title : i.title)} <small class="muted">${saved ? 'your recipe' : esc(new URL(i.url).hostname.replace(/^www\./, ''))}</small></div>
              <div class="card-sub">${esc(i.why)}</div>
              ${i.uses.length ? `<div class="card-sub">Uses: ${esc(i.uses.join(', '))}</div>` : ''}
              ${i.missing.length ? `<div class="card-sub">Need: ${esc(i.missing.join(', '))}</div>` : ''}
              <div class="action-row">${saved
                ? `<a class="btn" href="#/recipe/${saved.id}">Open recipe</a>`
                : `<button class="btn primary" data-import="${n}">Import</button><a class="btn" href="${esc(i.url)}" target="_blank" rel="noopener">View ↗</a>`}</div>
            </div>`;
          }).join('')
        : '<p class="muted">No ideas came back. Try again, or loosen the notes.</p>';
      results.onclick = async (ev) => {
        const imp = ev.target.closest('[data-import]');
        if (!imp) return;
        imp.disabled = true;
        imp.textContent = 'Importing…';
        const id = await importUrl(ideas[+imp.dataset.import].url);
        location.hash = `#/inbox/${id}`;
      };
    } catch (err) {
      results.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
    }
    btn.disabled = false;
    btn.textContent = 'Find ideas again';
  });
}

// After a meal is marked made: show what comes out of the pantry and let the user untick anything.
export function openDeductSheet(recipe, servings) {
  const rows = planDeductions(recipe, servings);
  if (!rows.length) return;
  const fmtLeft = (r) => (r.after <= 0.02 ? 'used up' : `${formatAmount(r.after, r.unit)}${r.size ? ` (${formatQty(r.size.qty)} ${unitLabel(r.size.unit, r.size.qty)} each)` : ''} left`);
  const sheet = openSheet(`
    <h2>Update pantry?</h2>
    <p class="muted small">From cooking ${esc(recipe.title)} (${servings} servings). Untick anything that's not right.</p>
    <div class="deduct">
      ${rows.map((r, i) => r.mismatch
        ? `<div class="deduct-row muted"><span><b>${esc(r.name)}</b>: recipe used ${esc(r.needText)}, which can't be matched to how it's stored. Adjust it in the Pantry.</span></div>`
        : `<label class="deduct-row"><input type="checkbox" data-row="${i}" checked>
             <span><b>${esc(r.name)}</b>: −${esc(r.used)} → ${esc(fmtLeft(r))}${r.short ? ` <small class="warn">(recipe needed ${esc(r.short)} more than you had)</small>` : ''}</span></label>`).join('')}
    </div>
    <div class="action-row"><button class="btn primary" id="apply">Update pantry</button><button class="btn" data-close>Skip</button></div>`);
  sheet.el.querySelector('#apply').addEventListener('click', async () => {
    const chosen = [...sheet.el.querySelectorAll('[data-row]')].filter((c) => c.checked).map((c) => rows[+c.dataset.row]);
    // Rows for the same item build on each other, so drop later rows for an item if an earlier one was unticked.
    const skipped = new Set(rows.filter((r, i) => !r.mismatch && !sheet.el.querySelector(`[data-row="${i}"]`).checked).map((r) => r.itemId));
    const res = await applyDeductions(chosen.filter((r) => !skipped.has(r.itemId)));
    sheet.close();
    toast(`Pantry updated${res.removed ? ` · ${res.removed} used up` : ''}`);
  });
}
