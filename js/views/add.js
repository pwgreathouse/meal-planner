// Adding recipes: type one in, or bring one in from a website link. Imports wait in the Inbox for a quick check.
import * as db from '../db.js';
import { esc, uid } from '../util.js';
import { getPrefs } from '../prefs.js';
import { newRecipe } from '../model.js';
import { parseRecipeHtml, findDuplicate, emptyDraft } from '../parser.js';
import { toast } from '../ui.js';
import { renderRecipeForm } from './recipes.js';

// ---------- Fetching links ----------

async function fetchPage(url) {
  const { fetchProxyUrl, fetchProxyToken } = getPrefs();
  if (!fetchProxyUrl || !fetchProxyToken) throw new Error('Link import needs the helper code under More → Link import.');
  const res = await fetch(`${fetchProxyUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
    headers: { 'X-App-Token': fetchProxyToken },
  });
  if (res.status === 401) throw new Error('The link helper code under More doesn’t match.');
  if (!res.ok) throw new Error(`The site returned an error (${res.status}).`);
  return res.text();
}

// Adds a recipe link to the Inbox and reads it. Returns the inbox item id.
export async function importUrl(url) {
  const draft = emptyDraft();
  draft.sourceUrl = url;
  const item = { id: uid(), createdAt: Date.now(), source: 'link', rawText: '', url, draft, status: 'needs-fetch' };
  await db.put('inbox', item);
  await tryFetch(item);
  return item.id;
}

async function tryFetch(item) {
  try {
    const draft = parseRecipeHtml(await fetchPage(item.url), item.url);
    if (!draft.title && !draft.ingredients.length) throw new Error('No recipe found on that page.');
    // Keep anything typed alongside the link (e.g. an older note) as notes.
    const extra = (item.rawText || '').replace(item.url, '').trim();
    if (extra && extra !== draft.title) draft.notes = [extra, draft.notes].filter(Boolean).join('\n\n');
    Object.assign(item, { draft, status: 'ready', error: '' });
  } catch (err) {
    Object.assign(item, { status: 'needs-fetch', error: err.message });
  }
  await db.put('inbox', item);
}

const isComplete = (i) => i.status === 'ready' && i.draft.title && i.draft.ingredients.some((x) => !x.header) && i.draft.steps.length > 0;

// ---------- Add screen ----------

export function addView(el) {
  el.innerHTML = `
    <header class="topbar"><a class="back" href="#/recipes">‹ Recipes</a><h1 class="topbar-title">Add a recipe</h1><span></span></header>
    <section class="inbox" id="inbox"><div class="section-head"><h2>To review <small class="muted" id="inbox-count"></small></h2><span id="inbox-actions"></span></div><div id="inbox-list"></div></section>
    <div class="add-grid">
      <a class="panel row-panel big-link" href="#/recipe/new">
        <div><h2>Type it in</h2><p class="muted small">Title, ingredients and steps. Only the title is required.</p></div>
        <span class="btn primary">New recipe</span>
      </a>
      <section class="panel">
        <h2>From a website</h2>
        <p class="muted small">Paste a recipe page's link. Most recipe sites work; you'll check it before saving.</p>
        <form class="inline-form" id="link-form">
          <input id="link" type="url" inputmode="url" placeholder="https://…" autocomplete="off">
          <button class="btn primary">Import</button>
        </form>
      </section>
    </div>`;

  el.querySelector('#link-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#link');
    const url = (input.value.match(/https?:\/\/\S+/) || [])[0];
    if (!url) return toast('Paste a link that starts with https://');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Reading…';
    const id = await importUrl(url);
    location.hash = `#/inbox/${id}`;
  });

  function drawInbox() {
    const recipes = db.all('recipes');
    const items = db.all('inbox').sort((a, b) => a.createdAt - b.createdAt);
    const complete = items.filter((i) => isComplete(i) && !findDuplicate(i.draft, recipes));
    el.querySelector('#inbox').hidden = !items.length;
    el.querySelector('#inbox-count').textContent = items.length ? `${items.length}` : '';
    el.querySelector('#inbox-actions').innerHTML = complete.length > 1
      ? `<button class="btn-text small strong" id="save-all">Save ${complete.length} complete</button>` : '';
    el.querySelector('#inbox-list').innerHTML = items.map((i) => {
      const n = i.draft.ingredients.filter((x) => !x.header).length;
      const dup = findDuplicate(i.draft, recipes);
      const sub = i.status === 'needs-fetch' ? 'Link couldn’t be read' : n ? `${n} ingredients · ${i.draft.steps.length} steps` : 'Needs ingredients and steps';
      return `<a class="card inbox-card" href="#/inbox/${i.id}">
        <div class="card-title">${esc(i.draft.title || i.url || 'Untitled')}</div>
        <div class="card-sub">${esc(sub)}</div>
        ${dup ? `<div class="warn small">Possible duplicate of “${esc(dup.title)}”</div>` : ''}
      </a>`;
    }).join('');
  }

  el.addEventListener('click', async (e) => {
    if (e.target.id !== 'save-all') return;
    const recipes = db.all('recipes');
    const ready = db.all('inbox').filter((i) => isComplete(i) && !findDuplicate(i.draft, recipes));
    if (!confirm(`Save ${ready.length} complete recipes without reviewing each one?`)) return;
    await db.putMany('recipes', ready.map((i) => newRecipe({ ...i.draft, servings: i.draft.servings || 4, category: i.draft.category || 'Other' })));
    for (const i of ready) await db.remove('inbox', i.id);
    toast(`Saved ${ready.length} recipes`);
  });

  drawInbox();
  return { refresh: (store) => (store === 'inbox' || store === 'recipes') && drawInbox() };
}

// ---------- Review one imported recipe ----------

export function reviewView(el, id) {
  const item = db.get('inbox', id);
  if (!item) {
    el.innerHTML = `<div class="empty"><h2>Already handled</h2><a class="btn" href="#/add">Back</a></div>`;
    return;
  }
  const d = item.draft;
  const dup = findDuplicate(d, db.all('recipes'));
  const recipe = newRecipe({ ...d, servings: d.servings || 4, category: d.category || 'Other' });
  const empty = item.status === 'ready' && !d.ingredients.some((x) => !x.header);

  const banner = `
    ${item.status === 'needs-fetch' ? `<div class="banner warn">
        <p>${esc(item.error || 'This link hasn’t been read yet.')}</p>
        <div class="action-row"><button class="btn" id="retry">Try again</button><a class="btn" href="${esc(item.url)}" target="_blank" rel="noopener">Open link ↗</a></div>
      </div>` : ''}
    ${empty && item.status === 'ready' ? `<div class="banner">Fill in the ingredients and steps below, or if the original has a website link, import that from <a href="#/add">Add a recipe</a>.</div>` : ''}
    ${dup ? `<div class="banner warn">Looks like a duplicate of <a href="#/recipe/${dup.id}">${esc(dup.title)}</a>.</div>` : ''}
    ${item.rawText ? `<details class="original"><summary>Original note</summary><pre>${esc(item.rawText)}</pre></details>` : ''}`;

  renderRecipeForm(el, recipe, {
    heading: 'Check & save',
    backHref: '#/add',
    aboveForm: banner,
    onSave: async (r) => {
      await db.put('recipes', r);
      await db.remove('inbox', id);
      const next = db.all('inbox').sort((a, b) => a.createdAt - b.createdAt)[0];
      toast('Saved');
      location.hash = next ? `#/inbox/${next.id}` : `#/recipe/${r.id}`;
    },
    onCancel: async () => {
      if (!confirm('Discard this one?')) return;
      await db.remove('inbox', id);
      location.hash = '#/add';
    },
  });

  el.querySelector('#retry')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Reading…';
    await tryFetch(item);
    reviewView(el, id);
  });
}
