// Recipe list (search + categories), recipe detail (with serving scaler), and the recipe form.
import * as db from '../db.js';
import { esc, fmtMinutes, fmtDay } from '../util.js';
import { getPrefs } from '../prefs.js';
import { newRecipe, searchRecipes, allTags } from '../model.js';
import { parseIngredients, formatIngredient, ingredientText } from '../ingredients.js';
import { toast, stepperHtml, wireSteppers, emptyState } from '../ui.js';
import { openAddToPlan } from './plan.js';

const listState = { q: '', cat: 'All', sort: 'az' };

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
    <header class="topbar"><h1>Recipes</h1><a class="btn-icon" href="#/add" aria-label="Add recipe">＋</a></header>
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
      <div class="action-row">
        <button class="btn primary" id="plan">Add to plan</button>
        ${r.sourceUrl ? `<a class="btn" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
      </div>
      ${r.lastMade ? `<p class="muted small">Last made ${esc(fmtDay(r.lastMade, { month: 'short', day: 'numeric', year: 'numeric' }))}</p>` : ''}
      <section>
        <div class="section-head"><h2>Ingredients</h2>${stepperHtml('servings', servings, { label: 'Servings', max: 200 })}</div>
        <ul class="ingredients" id="ings"></ul>
      </section>
      ${r.steps?.length ? `<section><h2>Steps</h2><ol class="steps">${r.steps.map((s) => (/:$/.test(s) ? `<li class="step-head">${esc(s)}</li>` : `<li>${esc(s)}</li>`)).join('')}</ol></section>` : ''}
      ${r.notes ? `<section><h2>Notes</h2><p class="notes">${esc(r.notes)}</p></section>` : ''}
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
  el.querySelector('#stars').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    const n = +b.dataset.star;
    r.rating = r.rating === n ? 0 : n;
    await db.put('recipes', r);
    el.querySelectorAll('#stars button').forEach((s) => s.classList.toggle('on', +s.dataset.star <= r.rating));
  });
}

// Shared form for new, edited, and imported recipes.
export function renderRecipeForm(el, recipe, { heading, backHref, onSave, onDelete, onCancel, aboveForm = '' }) {
  const prefs = getPrefs();
  const cats = [...new Set([...prefs.categories, recipe.category].filter(Boolean))];
  el.innerHTML = `
    <header class="topbar"><a class="back" href="${backHref}">‹ Back</a><h1 class="topbar-title">${esc(heading)}</h1><button class="btn-text strong" id="save" form="rform">Save</button></header>
    ${aboveForm}
    <form id="rform" class="form" autocomplete="off">
      <label>Title<input name="title" required value="${esc(recipe.title)}" placeholder="e.g. Sheet-pan chicken fajitas"></label>
      <div class="grid-2">
        <label>Category<select name="category">${cats.map((c) => `<option ${c === recipe.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Servings<input name="servings" type="number" inputmode="numeric" min="1" value="${recipe.servings || ''}" placeholder="4"></label>
      </div>
      <div class="grid-2">
        <label>Prep (min)<input name="prepMin" type="number" inputmode="numeric" min="0" value="${recipe.prepMin || ''}"></label>
        <label>Cook (min)<input name="cookMin" type="number" inputmode="numeric" min="0" value="${recipe.cookMin || ''}"></label>
      </div>
      <label>Ingredients <small class="muted">one per line · end a line with “:” for a heading</small>
        <textarea name="ingredients" rows="10" placeholder="2 cups chicken broth&#10;1 lb chicken thighs&#10;1 onion, diced">${esc((recipe.ingredients || []).map((i) => (i.header ? `${i.name}:` : i.raw || ingredientText(i))).join('\n'))}</textarea></label>
      <label>Steps <small class="muted">one per line</small>
        <textarea name="steps" rows="10">${esc((recipe.steps || []).join('\n'))}</textarea></label>
      <label>Tags <small class="muted">comma separated</small>
        <input name="tags" list="tag-list" value="${esc((recipe.tags || []).join(', '))}" placeholder="quick, kid-friendly, freezer">
        <datalist id="tag-list">${allTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label>Notes<textarea name="notes" rows="4" placeholder="Swaps, tips, what the family thought…">${esc(recipe.notes || '')}</textarea></label>
      <label>Source link<input name="sourceUrl" type="url" inputmode="url" value="${esc(recipe.sourceUrl || '')}" placeholder="https://…"></label>
      <div class="form-actions">
        ${onCancel ? '<button type="button" class="btn" id="cancel">Discard</button>' : ''}
        ${onDelete ? '<button type="button" class="btn danger" id="delete">Delete recipe</button>' : ''}
      </div>
    </form>`;

  const form = el.querySelector('#rform');
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
      ingredients: parseIngredients(f.get('ingredients')),
      steps: String(f.get('steps')).split('\n').map((s) => s.trim()).filter(Boolean),
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
