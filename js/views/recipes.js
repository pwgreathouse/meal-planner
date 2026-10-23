// Recipe list (search + categories), recipe detail (with serving scaler), and the recipe form.
import * as db from '../db.js';
import { esc, fmtMinutes, fmtDay } from '../util.js';
import { getPrefs } from '../prefs.js';
import { newRecipe, searchRecipes, allTags, addRecipesToList, listResultText, knownIngredientNames } from '../model.js';
import { parseIngredient, formatIngredient, ingredientText } from '../ingredients.js';
import { formatQty, UNITS } from '../units.js';
import { toast, stepperHtml, wireSteppers, emptyState, openSheet } from '../ui.js';
import { openAddToPlan } from './plan.js';
import { remember } from '../catalog.js';

const listState = { q: '', cat: 'All', sort: 'az' };

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function recipeMeta(r) {
  const time = (r.prepMin || 0) + (r.cookMin || 0);
  return [r.category, time ? fmtMinutes(time) : '', r.ingredients?.length ? `${r.ingredients.filter((i) => !i.header).length} ingredients` : '']
    .filter(Boolean)
    .join(' · ');
}

export function recipeCard(r, { href = `#/recipe/${r.id}`, extra = '' } = {}) {
  const tags = (r.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `<a class="card recipe-card" href="${href}" data-id="${r.id}">
    <div class="card-title">${esc(r.title || 'Untitled')}${r.rating ? ` <span class="stars-sm">${'★'.repeat(r.rating)}</span>` : ''}</div>
    <div class="card-sub">${esc(recipeMeta(r))}</div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}${extra}
  </a>`;
}

export function listView(el) {
  const prefs = getPrefs();
  el.innerHTML = `
    <header class="topbar"><h1>Recipes</h1><a class="btn add-btn" href="#/add">＋ Add${db.all('inbox').length ? ` <span class="badge" title="In Inbox">${db.all('inbox').length}</span>` : ''}</a></header>
    <div class="search-bar"><input type="search" id="q" placeholder="Search title, ingredient, tag…" value="${esc(listState.q)}" autocomplete="off" enterkeyhint="search"></div>
    <div class="chips scroll-x" id="cats"></div>
    <div class="list-meta"><span id="count"></span>
      <select id="sort" aria-label="Sort">
        <option value="az">A–Z</option><option value="new">Newest</option>
        <option value="made">Recently made</option><option value="stale">Not made in a while</option><option value="rating">Top rated</option>
      </select></div>
    <div id="results" class="cards"></div>`;

  const sortSel = el.querySelector('#sort');
  sortSel.value = listState.sort;

  function draw() {
    const all = db.all('recipes');
    const counts = { All: all.length };
    for (const r of all) counts[r.category] = (counts[r.category] || 0) + 1;
    const cats = ['All', ...prefs.categories.filter((c) => counts[c]), ...Object.keys(counts).filter((c) => c !== 'All' && !prefs.categories.includes(c))];
    el.querySelector('#cats').innerHTML = cats
      .map((c) => `<button class="chip ${listState.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)} <small>${counts[c] || 0}</small></button>`)
      .join('');

    if (!all.length) {
      el.querySelector('#count').textContent = '';
      el.querySelector('#results').innerHTML = emptyState(
        'No recipes yet',
        'Paste one in, import from a link, or bring over your Apple Notes all at once.',
        `<div class="row-gap"><a class="btn primary" href="#/add">Add recipes</a><a class="btn" href="#/help/notes">Import Apple Notes</a></div>`
      );
      return;
    }

    let rows = searchRecipes(listState.cat === 'All' ? all : all.filter((r) => r.category === listState.cat), listState.q);
    if (!listState.q) {
      const by = {
        az: (a, b) => a.r.title.localeCompare(b.r.title),
        new: (a, b) => (b.r.createdAt || 0) - (a.r.createdAt || 0),
        made: (a, b) => (b.r.lastMade || '').localeCompare(a.r.lastMade || ''),
        stale: (a, b) => (a.r.lastMade || '').localeCompare(b.r.lastMade || ''),
        rating: (a, b) => (b.r.rating || 0) - (a.r.rating || 0) || a.r.title.localeCompare(b.r.title),
      }[listState.sort];
      rows.sort(by);
    }
    el.querySelector('#count').textContent = `${rows.length} recipe${rows.length === 1 ? '' : 's'}`;
    el.querySelector('#results').innerHTML = rows.length
      ? rows.map(({ r }) => recipeCard(r)).join('')
      : `<p class="muted center pad">No matches for “${esc(listState.q)}”.</p>`;
  }

  el.querySelector('#q').addEventListener('input', (e) => {
    listState.q = e.target.value;
    draw();
  });
  sortSel.addEventListener('change', () => {
    listState.sort = sortSel.value;
    draw();
  });
  el.querySelector('#cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    listState.cat = b.dataset.cat;
    draw();
  });

  draw();
  return { refresh: (store) => store === 'recipes' && draw() };
}

export function detailView(el, id) {
  const r = db.get('recipes', id);
  if (!r) {
    el.innerHTML = emptyState('Recipe not found', 'It may have been deleted.', '<a class="btn" href="#/recipes">Back to recipes</a>');
    return;
  }
  let servings = r.servings || 1;

  el.innerHTML = `
    <header class="topbar"><a class="back" href="#/recipes">‹ Recipes</a><a class="btn-text" href="#/recipe/${r.id}/edit">Edit</a></header>
    <article class="recipe">
      ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <h1 class="recipe-title">${esc(r.title)}</h1>
      <div class="muted">${esc(recipeMeta(r))}</div>
      <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" class="${n <= (r.rating || 0) ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div>
      ${r.tags?.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.sourceUrl ? `<a class="btn primary block open-recipe" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Open recipe ↗ <small>${esc(hostOf(r.sourceUrl))}</small></a>` : ''}
      ${r.notes ? `<p class="notes recipe-note">${esc(r.notes)}</p>` : ''}
      <div class="action-row">
        <button class="btn ${r.sourceUrl ? '' : 'primary'}" id="plan">Add to plan</button>
        ${r.ingredients?.length ? '<button class="btn" id="to-list">Add to list</button>' : ''}
      </div>
      ${r.lastMade ? `<p class="muted small">Last made ${esc(fmtDay(r.lastMade, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>` : ''}
      <section>
        <div class="section-head"><h2>Ingredients</h2>${stepperHtml('servings', servings, { label: 'Servings', max: 200 })}</div>
        <ul class="ingredients" id="ings"></ul>
      </section>
      ${r.steps?.length ? `<details class="saved-steps"><summary>Saved steps (${r.steps.length})</summary><ol class="steps">${r.steps.map((s) => (/:$/.test(s) ? `<li class="step-head">${esc(s)}</li>` : `<li>${esc(s)}</li>`)).join('')}</ol></details>` : ''}
    </article>`;

  function drawIngs() {
    const factor = servings / (r.servings || 1);
    el.querySelector('#ings').innerHTML = (r.ingredients || [])
      .map((ing) => {
        const f = formatIngredient(ing, factor);
        if (f.header) return `<li class="ing-head">${esc(f.name)}</li>`;
        return `<li><span class="amt">${esc(f.amount)}</span> ${esc(f.name)}${f.note ? `<span class="muted">, ${esc(f.note)}</span>` : ''}</li>`;
      })
      .join('') || '<li class="muted">No ingredients listed.</li>';
  }
  drawIngs();
  wireSteppers(el, (_, v) => {
    servings = v;
    drawIngs();
  });

  el.querySelector('#plan').addEventListener('click', () => openAddToPlan({ recipeId: r.id, servings: servings !== r.servings ? servings : null }));
  el.querySelector('#to-list')?.addEventListener('click', async () => {
    const res = await addRecipesToList([{ recipe: r, servings }]);
    toast(listResultText(res), 3500);
  });
  el.querySelector('#stars').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const n = +b.dataset.star;
    r.rating = r.rating === n ? 0 : n;
    await db.put('recipes', r);
    el.querySelectorAll('#stars button').forEach((s) => s.classList.toggle('on', +s.dataset.star <= r.rating));
  });
}

// Units offered in the ingredient picker, in a sensible order.
const UNIT_CHOICES = ['tsp', 'tbsp', 'cup', 'floz', 'pint', 'quart', 'gallon', 'oz', 'lb', 'g', 'kg', 'ml', 'l',
  'can', 'jar', 'package', 'bag', 'box', 'bottle', 'carton', 'clove', 'slice', 'stick', 'bunch', 'head', 'sprig', 'stalk', 'piece', 'pinch', 'dash', 'handful', 'loaf', 'block'];

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + 2}px`;
}

// Removes rows the user never filled in, before pasting a list after them.
function clearEmpty(container, selector) {
  [...container.children].forEach((row) => {
    const fields = [...row.querySelectorAll('input, textarea')].filter((x) => x.type !== 'hidden');
    if (row.querySelector(selector) && fields.every((x) => !x.value.trim())) row.remove();
  });
}

function pasteList(title, hint, onAdd) {
  const sheet = openSheet(`<h2>${esc(title)}</h2><p class="muted small">${esc(hint)}</p>
    <textarea id="pl" rows="10" class="field-row"></textarea>
    <div class="action-row"><button class="btn primary" id="pl-add">Add</button><button class="btn" data-close>Cancel</button></div>`);
  setTimeout(() => sheet.el.querySelector('#pl').focus(), 250);
  sheet.el.querySelector('#pl-add').onclick = () => {
    const lines = sheet.el.querySelector('#pl').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) onAdd(lines);
    sheet.close();
  };
}

// Shared form for new, edited, and imported recipes.
export function renderRecipeForm(el, recipe, { heading, backHref, onSave, onDelete, onCancel, cancelLabel = 'Discard', aboveForm = '' }) {
  const prefs = getPrefs();
  const cats = [...new Set([...prefs.categories, recipe.category].filter(Boolean))];
  el.innerHTML = `
    <header class="topbar"><a class="back" href="${backHref}">‹ Back</a><h1 class="topbar-title">${esc(heading)}</h1><button class="btn-text strong" id="save" form="rform">Save</button></header>
    ${aboveForm}
    <form id="rform" class="form" autocomplete="off">
      <label>Name<input name="title" required value="${esc(recipe.title)}" placeholder="e.g. Sheet-pan chicken fajitas"></label>
      <label>Recipe link <small class="muted">where the full recipe lives</small>
        <input name="sourceUrl" type="url" inputmode="url" value="${esc(recipe.sourceUrl || '')}" placeholder="https://…" autocapitalize="off"></label>
      <label>Note <small class="muted">or where to find it, e.g. “Mom's red binder, p. 12”</small>
        <textarea name="notes" rows="2" placeholder="Where it's from, tweaks, what the family thought…">${esc(recipe.notes || '')}</textarea></label>
      <div class="grid-2">
        <label>Category<select name="category">${cats.map((c) => `<option ${c === recipe.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Servings<input name="servings" type="number" inputmode="numeric" min="1" value="${recipe.servings || ''}" placeholder="4"></label>
      </div>
      <fieldset class="rows-field">
        <legend>Ingredients</legend>
        <div class="ing-head-row muted small"><span></span><span>Amount</span><span>Unit</span><span>Ingredient</span></div>
        <div id="ing-rows"></div>
        <div class="row-actions">
          <button type="button" class="btn" id="add-ing">＋ Ingredient</button>
          <button type="button" class="btn-text small" id="add-sec">＋ Section heading</button>
          <button type="button" class="btn-text small" id="paste-ing">Paste a list</button>
        </div>
        <datalist id="ing-names">${knownIngredientNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </fieldset>
      <details class="more-details" ${recipe.tags?.length ? 'open' : ''}>
        <summary>More details</summary>
        <label>Tags <small class="muted">comma separated</small>
          <input name="tags" list="tag-list" value="${esc((recipe.tags || []).join(', '))}" placeholder="quick, kid-friendly, freezer">
          <datalist id="tag-list">${allTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <div class="grid-2">
          <label>Prep (min)<input name="prepMin" type="number" inputmode="numeric" min="0" value="${recipe.prepMin || ''}"></label>
          <label>Cook (min)<input name="cookMin" type="number" inputmode="numeric" min="0" value="${recipe.cookMin || ''}"></label>
        </div>
      </details>
      <div class="form-actions">
        ${onCancel ? `<button type="button" class="btn" id="cancel">${esc(cancelLabel)}</button>` : ''}
        ${onDelete ? '<button type="button" class="btn danger" id="delete">Delete recipe</button>' : ''}
      </div>
    </form>`;

  const form = el.querySelector('#rform');
  const ingRows = el.querySelector('#ing-rows');

  // ----- ingredient rows -----
  const unitOptions = (sel) => `<option value="">—</option>${UNIT_CHOICES.map((k) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(UNITS[k].one)}</option>`).join('')}`;
  // Safari's AutoFill copies values between identical-looking fields; a unique name per row and
  // autocomplete="off" on each field keep every new line empty.
  let rowSeq = 0;
  const noFill = () => `autocomplete="off" autocorrect="off" spellcheck="false"`;
  const handle = '<button type="button" class="drag" aria-label="Drag to reorder" tabindex="-1">≡</button>';
  function addIngRow(ing = {}, focus = false) {
    const row = document.createElement('div');
    const n = rowSeq++;
    if (ing.header) {
      row.className = 'ing-row section';
      row.innerHTML = `${handle}<input class="i-head" name="head-${n}" ${noFill()} value="${esc(ing.name || '')}" placeholder="Section, e.g. For the sauce" enterkeyhint="next">
        <button type="button" class="row-x" aria-label="Remove">✕</button>`;
    } else {
      const amount = ing.qty != null
        ? formatQty(ing.qty) + (ing.max != null ? `-${formatQty(ing.max)}` : '') + (ing.size ? ` (${formatQty(ing.size.qty)} ${UNITS[ing.size.unit]?.one || ing.size.unit})` : '')
        : '';
      const unit = ing.unit && UNIT_CHOICES.includes(ing.unit) ? ing.unit : '';
      // A unit we don't offer in the picker stays with the name, so nothing is lost.
      const name = (ing.unit && !unit ? `${ing.unit} ` : '') + (ing.name || '') + (ing.note ? `, ${ing.note}` : '');
      row.className = 'ing-row';
      row.innerHTML = `${handle}<input class="i-amt" name="amt-${n}" ${noFill()} value="${esc(amount)}" inputmode="decimal" placeholder="2" aria-label="Amount">
        <select class="i-unit" name="unit-${n}" autocomplete="off" aria-label="Unit">${unitOptions(unit)}</select>
        <input class="i-name" name="ing-${n}" ${noFill()} value="${esc(name)}" list="ing-names" placeholder="ingredient, prep" aria-label="Ingredient" enterkeyhint="next" autocapitalize="off">
        <button type="button" class="row-x" aria-label="Remove">✕</button>`;
    }
    ingRows.appendChild(row);
    if (focus) {
      // Start the new line clean even if the browser tried to fill it in.
      row.querySelectorAll('input').forEach((i) => { if (!ing.name && !ing.qty) i.value = ''; });
      row.querySelector('input').focus();
    }
    return row;
  }

  // ----- drag to reorder (pointer events, so it works with touch on iPhone too) -----
  ingRows.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.drag');
    if (!grip) return;
    e.preventDefault();
    const row = grip.closest('.ing-row');
    row.classList.add('dragging');
    document.activeElement?.blur?.();
    const move = (ev) => {
      ev.preventDefault();
      const y = ev.clientY;
      const others = [...ingRows.children].filter((r) => r !== row);
      const before = others.find((r) => {
        const b = r.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if ((before || null) !== row.nextElementSibling) ingRows.insertBefore(row, before || null);
      // Scroll when dragging near the top or bottom of the screen.
      if (y < 90) window.scrollBy(0, -10);
      else if (y > window.innerHeight - 110) window.scrollBy(0, 10);
    };
    const end = () => {
      row.classList.remove('dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  });
  (recipe.ingredients?.length ? recipe.ingredients : [{}, {}, {}]).forEach((i) => addIngRow(i));

  el.querySelector('#add-ing').onclick = () => addIngRow({}, true);
  el.querySelector('#add-sec').onclick = () => addIngRow({ header: true }, true);
  el.querySelector('#paste-ing').onclick = () => pasteList('Paste ingredients', 'One ingredient per line, e.g. “2 cups chicken broth”.', (lines) => {
    clearEmpty(ingRows, '.i-name, .i-head');
    lines.forEach((l) => addIngRow(parseIngredient(l) || {}));
  });
  // Enter in an ingredient name jumps to a fresh row, so a list can be typed quickly.
  ingRows.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.i-name, .i-head')) return;
    e.preventDefault();
    const row = e.target.closest('.ing-row');
    const next = row.nextElementSibling;
    if (next) next.querySelector('input').focus();
    else addIngRow({}, true);
  });
  form.addEventListener('click', (e) => {
    const row = e.target.closest('.ing-row');
    if (!row) return;
    if (e.target.closest('.row-x')) row.remove();
    else if (e.target.closest('.row-up') && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    else if (e.target.closest('.row-down') && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  });

  const readIngredients = () =>
    [...ingRows.children].map((row) => {
      const head = row.querySelector('.i-head');
      if (head) return head.value.trim() ? { raw: `${head.value.trim()}:`, header: true, name: head.value.trim().replace(/:$/, '') } : null;
      const amt = row.querySelector('.i-amt').value.trim();
      const unit = row.querySelector('.i-unit').value;
      const name = row.querySelector('.i-name').value.trim();
      if (!name && !amt) return null;
      return parseIngredient([amt, unit ? UNITS[unit].one : '', name].filter(Boolean).join(' '));
    }).filter(Boolean);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) ? +f.get(k) : null);
    const updated = {
      ...recipe,
      title: f.get('title').trim(),
      category: f.get('category'),
      servings: num('servings') || recipe.servings || 4,
      prepMin: num('prepMin'),
      cookMin: num('cookMin'),
      ingredients: readIngredients(),
      tags: [...new Set(String(f.get('tags')).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))],
      notes: f.get('notes').trim(),
      sourceUrl: f.get('sourceUrl').trim(),
    };
    await onSave(updated);
  });
  el.querySelector('#cancel')?.addEventListener('click', onCancel);
  el.querySelector('#delete')?.addEventListener('click', onDelete);
}

export function editView(el, id) {
  const existing = id ? db.get('recipes', id) : null;
  if (id && !existing) {
    el.innerHTML = emptyState('Recipe not found', '', '<a class="btn" href="#/recipes">Back</a>');
    return;
  }
  const recipe = existing ? structuredClone(existing) : newRecipe({ category: 'Dinner' });
  renderRecipeForm(el, recipe, {
    heading: existing ? 'Edit recipe' : 'New recipe',
    backHref: existing ? `#/recipe/${id}` : '#/recipes',
    onSave: async (r) => {
      await db.put('recipes', r);
      await remember(r.ingredients.filter((i) => !i.header && i.name).map((i) => ({ name: i.name })));
      toast('Saved');
      location.hash = `#/recipe/${r.id}`;
    },
    onDelete: existing
      ? async () => {
          if (!confirm(`Delete “${existing.title}”? This can't be undone.`)) return;
          await db.remove('recipes', id);
          toast('Recipe deleted');
          location.hash = '#/recipes';
        }
      : null,
  });
}
