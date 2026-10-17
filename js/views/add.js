// Adding recipes: paste, link, bulk (Apple Notes / Keep), manual — plus the Inbox where imports wait for review.
import * as db from '../db.js';
import { esc, uid } from '../util.js';
import { getPrefs } from '../prefs.js';
import { newRecipe } from '../model.js';
import { parseRecipeText, parseRecipeHtml, splitBulk, isJustUrl, findDuplicate, emptyDraft } from '../parser.js';
import { toast } from '../ui.js';
import { ingredientText } from '../ingredients.js';
import { getLog, noteKey, noteHash, recordImports, logEntryFor } from '../importlog.js';
import { renderRecipeForm } from './recipes.js';

// ---------- Fetching links ----------

async function fetchPage(url) {
  const { fetchProxyUrl, fetchProxyToken } = getPrefs();
  const target = fetchProxyUrl ? `${fetchProxyUrl.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}` : url;
  const res = await fetch(target, { headers: fetchProxyUrl && fetchProxyToken ? { 'X-App-Token': fetchProxyToken } : {} });
  if (!res.ok) throw new Error(`The site returned ${res.status}`);
  return res.text();
}

async function draftFromUrl(url) {
  const html = await fetchPage(url);
  const draft = parseRecipeHtml(html, url);
  if (!draft.title && !draft.ingredients.length) throw new Error('No recipe found on that page');
  return draft;
}

// ---------- Inbox items ----------
// { id, createdAt, source, rawText, url, draft, status: 'ready' | 'needs-fetch' }

function makeItem({ text = '', url = '', source }) {
  const linkOnly = url || isJustUrl(text);
  if (linkOnly) {
    const d = emptyDraft();
    d.sourceUrl = linkOnly;
    d.title = text.replace(linkOnly, '').trim().split('\n')[0].slice(0, 100);
    return { id: uid(), createdAt: Date.now(), source, rawText: text, url: linkOnly, draft: d, status: 'needs-fetch' };
  }
  return { id: uid(), createdAt: Date.now(), source, rawText: text, url: '', draft: parseRecipeText(text), status: 'ready' };
}

async function tryFetch(item) {
  try {
    const fetched = await draftFromUrl(item.url);
    // Keep anything typed in the note itself (e.g. "doubled the garlic") as notes.
    const extra = item.rawText.replace(item.url, '').trim();
    if (extra && extra !== fetched.title) fetched.notes = [extra, fetched.notes].filter(Boolean).join('\n\n');
    item.draft = fetched;
    item.status = 'ready';
    item.error = '';
  } catch (err) {
    item.status = 'needs-fetch';
    item.error = getPrefs().fetchProxyUrl ? err.message : 'Link importing needs the helper set up (Settings). You can still save it as a link and fill it in.';
  }
  await db.put('inbox', item);
  return item;
}

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toast('Clipboard not available — long-press the box and choose Paste');
    return '';
  }
}

// ---------- Add screen ----------

export function addView(el, params = {}) {
  el.innerHTML = `
    <header class="topbar"><h1>Add recipes</h1></header>
    <section class="inbox" id="inbox"><div class="section-head"><h2>Inbox <small class="muted" id="inbox-count"></small></h2><span id="inbox-actions"></span></div><div id="inbox-list"></div></section>
    <div class="add-grid">
      <section class="panel">
        <h2>Paste a recipe</h2>
        <p class="muted small">Text from a note, email, or web page. A link on its own works too.</p>
        <textarea id="paste" rows="6" placeholder="Paste recipe text or a link…">${esc(params.text || params.url || '')}</textarea>
        <div class="action-row"><button class="btn" id="clip">Paste from clipboard</button><button class="btn primary" id="parse">Import</button></div>
      </section>
      <section class="panel">
        <h2>Bulk import</h2>
        <p class="muted small">For your Apple Notes folder or Keep notes. Separate recipes with a line like <code>===== NEXT RECIPE =====</code>. <a href="#/help/notes">How to export Apple Notes</a></p>
        <textarea id="bulk" rows="4" placeholder="Paste many recipes at once…"></textarea>
        <div class="action-row"><button class="btn" id="bulk-clip">Paste from clipboard</button><button class="btn primary" id="bulk-go">Import all</button></div>
      </section>
      <section class="panel row-panel">
        <div><h2>Type it in</h2><p class="muted small">Start from a blank recipe.</p></div>
        <a class="btn" href="#/recipe/new">New recipe</a>
      </section>
      <section class="panel row-panel disabled">
        <div><h2>Screenshot or photo</h2><p class="muted small">Coming with the AI step. For now: open the screenshot in Photos, press and hold the text, Copy, then paste above.</p></div>
      </section>
    </div>`;

  const paste = el.querySelector('#paste');
  const bulk = el.querySelector('#bulk');

  el.querySelector('#clip').onclick = async () => { paste.value = await readClipboard(); };
  el.querySelector('#bulk-clip').onclick = async () => { bulk.value = await readClipboard(); };

  el.querySelector('#parse').onclick = async () => {
    const text = paste.value.trim();
    if (!text) return toast('Paste something first');
    const item = makeItem({ text, source: 'paste' });
    await db.put('inbox', item);
    paste.value = '';
    if (item.status === 'needs-fetch') {
      toast('Fetching recipe…');
      await tryFetch(item);
    }
    location.hash = `#/inbox/${item.id}`;
  };

  el.querySelector('#bulk-go').onclick = async () => {
    const parts = splitBulk(bulk.value);
    if (!parts.length) return toast('Nothing to import');
    const log = getLog();
    const pending = new Set(db.all('inbox').map((i) => i.noteKey).filter(Boolean));
    const items = [];
    let same = 0, changed = 0;
    for (const text of parts) {
      const key = noteKey(text), hash = noteHash(text), prev = log[key];
      if (pending.has(key) || (prev && prev.hash === hash)) { same++; continue; }
      const item = makeItem({ text, source: 'bulk' });
      Object.assign(item, { noteKey: key, noteHash: hash });
      if (prev?.status === 'saved' && db.get('recipes', prev.recipeId)) {
        Object.assign(item, { kind: 'changed', targetId: prev.recipeId });
        changed++;
      }
      items.push(item);
      pending.add(key);
    }
    if (items.length) await db.putMany('inbox', items);
    bulk.value = '';
    const added = items.length - changed;
    toast([added && `${added} new`, changed && `${changed} changed`, same && `${same} already imported`].filter(Boolean).join(' · ') || 'Nothing new', 3500);
    const links = items.filter((i) => i.status === 'needs-fetch');
    if (links.length && getPrefs().fetchProxyUrl) {
      for (const i of links) await tryFetch(i);
      toast('Links fetched');
    }
  };

  function drawInbox() {
    const recipes = db.all('recipes');
    const items = db.all('inbox').sort((a, b) => a.createdAt - b.createdAt);
    const ready = items.filter((i) => i.status === 'ready' && i.kind !== 'changed');
    el.querySelector('#inbox').hidden = !items.length;
    el.querySelector('#inbox-count').textContent = items.length ? `${items.length} to review` : '';
    el.querySelector('#inbox-actions').innerHTML = items.length
      ? `${ready.length > 1 ? `<button class="btn-text small" id="save-all">Save ${ready.length} as-is</button>` : ''}<button class="btn-text small danger" id="clear-all">Clear</button>`
      : '';
    el.querySelector('#inbox-list').innerHTML = items.length
      ? items.map((i) => {
          const target = i.kind === 'changed' && db.get('recipes', i.targetId);
          const dup = !target && findDuplicate(i.draft, recipes);
          const n = i.draft.ingredients.filter((x) => !x.header).length;
          const sub = i.status === 'needs-fetch' ? 'Link — not fetched yet' : `${n} ingredients · ${i.draft.steps.length} steps`;
          return `<a class="card inbox-card" href="#/inbox/${i.id}">
            <div class="card-title">${target ? '<span class="pill">Changed in Notes</span> ' : ''}${esc(i.draft.title || i.url || 'Untitled')}</div>
            <div class="card-sub">${esc(sub)}${n === 0 && i.status === 'ready' ? ' · <b>needs a look</b>' : ''}</div>
            ${dup ? `<div class="warn small">Possible duplicate of “${esc(dup.title)}”</div>` : ''}
          </a>`;
        }).join('')
      : '';
  }

  el.addEventListener('click', async (e) => {
    if (e.target.id === 'clear-all') {
      if (!confirm('Discard everything in the Inbox? Discarded notes won’t come back on the next import unless they change.')) return;
      const all = db.all('inbox');
      await recordImports(all.map((i) => logEntryFor(i, 'discarded')).filter(Boolean));
      for (const i of all) await db.remove('inbox', i.id);
    }
    if (e.target.id === 'save-all') {
      const recipes = db.all('recipes');
      const ready = db.all('inbox').filter((i) => i.status === 'ready' && i.kind !== 'changed' && !findDuplicate(i.draft, recipes) && i.draft.title);
      if (!ready.length) return toast('Nothing ready to save (duplicates, changes, and untitled items need review)');
      if (!confirm(`Save ${ready.length} recipes without reviewing? Duplicates, changed notes, and untitled items stay in the Inbox.`)) return;
      const saved = ready.map((i) => newRecipe({ ...i.draft, servings: i.draft.servings || 4, category: i.draft.category || 'Other' }));
      await db.putMany('recipes', saved);
      await recordImports(ready.map((i, n) => logEntryFor(i, 'saved', saved[n].id)).filter(Boolean));
      for (const i of ready) await db.remove('inbox', i.id);
      toast(`Saved ${ready.length} recipes`);
    }
  });

  if (params.url || params.text) paste.focus();
  drawInbox();
  return { refresh: (store) => (store === 'inbox' || store === 'recipes') && drawInbox() };
}

// ---------- Review one inbox item ----------

// Lists what differs between the app's recipe and the edited note: struck-through lines leave, green lines arrive.
function changedBanner(oldR, newR) {
  const lines = (r) => ({
    Title: [r.title],
    Servings: [String(r.servings || '')],
    Ingredients: (r.ingredients || []).map((i) => ingredientText(i)),
    Steps: r.steps || [],
  });
  const a = lines(oldR), b = lines(newR);
  const sections = Object.keys(a)
    .map((k) => {
      const oldSet = new Set(a[k]), newSet = new Set(b[k]);
      const removed = a[k].filter((l) => l && !newSet.has(l));
      const added = b[k].filter((l) => l && !oldSet.has(l));
      if (!removed.length && !added.length) return '';
      return `<div class="diff-sec"><strong>${k}</strong>
        ${removed.map((l) => `<div class="diff-del">− ${esc(l)}</div>`).join('')}
        ${added.map((l) => `<div class="diff-add">+ ${esc(l)}</div>`).join('')}</div>`;
    })
    .join('');
  return `<div class="banner">
    <p><b>This note changed in Apple Notes</b> since you imported it as <a href="#/recipe/${oldR.id}">${esc(oldR.title)}</a>.
    Save to update the recipe (your tags, rating, category and app notes stay), or keep your version.</p>
    <div class="diff">${sections || '<p class="muted small">Only notes or formatting changed — nothing in the title, servings, ingredients or steps.</p>'}</div>
  </div>`;
}

export function reviewView(el, id) {
  const item = db.get('inbox', id);
  if (!item) {
    el.innerHTML = `<div class="empty"><h2>Already handled</h2><a class="btn" href="#/add">Back to Inbox</a></div>`;
    return;
  }
  const target = item.kind === 'changed' ? db.get('recipes', item.targetId) : null;
  const dup = !target && findDuplicate(item.draft, db.all('recipes'));
  const d = item.draft;
  // A changed note updates the existing recipe: text from Notes, but app-only details (tags, rating, category, notes) stay.
  const recipe = target
    ? {
        ...structuredClone(target),
        title: d.title || target.title,
        servings: d.servings || target.servings,
        prepMin: d.prepMin ?? target.prepMin,
        cookMin: d.cookMin ?? target.cookMin,
        ingredients: d.ingredients.length ? d.ingredients : target.ingredients,
        steps: d.steps.length ? d.steps : target.steps,
        sourceUrl: d.sourceUrl || target.sourceUrl,
      }
    : newRecipe({ ...d, servings: d.servings || 4, category: d.category || 'Other' });

  const banner = `
    ${target ? changedBanner(target, recipe) : ''}
    ${dup ? `<div class="banner warn">Looks like a duplicate of <a href="#/recipe/${dup.id}">${esc(dup.title)}</a>.</div>` : ''}
    ${item.status === 'needs-fetch' ? `<div class="banner">
        <p>${esc(item.error || 'This is a link that hasn’t been fetched yet.')}</p>
        <div class="action-row"><button class="btn" id="retry">Fetch recipe from link</button><a class="btn" href="${esc(item.url)}" target="_blank" rel="noopener">Open link ↗</a></div>
      </div>` : ''}
    ${item.rawText ? `<details class="original"><summary>Original text</summary><pre>${esc(item.rawText)}</pre></details>` : ''}`;

  renderRecipeForm(el, recipe, {
    heading: target ? 'Update from Notes' : 'Review import',
    backHref: '#/add',
    aboveForm: banner,
    cancelLabel: target ? 'Keep my version' : 'Discard',
    onSave: async (r) => {
      await db.put('recipes', r);
      await recordImports([logEntryFor(item, 'saved', r.id)].filter(Boolean));
      await db.remove('inbox', id);
      const next = db.all('inbox').sort((a, b) => a.createdAt - b.createdAt)[0];
      toast(target ? 'Recipe updated' : 'Saved to recipes');
      location.hash = next ? `#/inbox/${next.id}` : `#/recipe/${r.id}`;
    },
    onCancel: async () => {
      if (!target && !confirm('Discard this import? It won’t come back on the next Notes import unless the note changes.')) return;
      await recordImports([logEntryFor(item, 'discarded')].filter(Boolean));
      await db.remove('inbox', id);
      const next = db.all('inbox').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (target) toast('Kept your version');
      location.hash = next ? `#/inbox/${next.id}` : '#/add';
    },
  });

  el.querySelector('#retry')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Fetching…';
    await tryFetch(item);
    reviewView(el, id);
  });
}
