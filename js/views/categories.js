// Editing a category list: list categories (store aisles) or recipe categories. Rename, drag to reorder, add, remove.
import * as db from '../db.js';
import { esc, uid } from '../util.js';
import { getPrefs, savePrefs, aisleList } from '../prefs.js';
import { openSheet, toast, makeSortable } from '../ui.js';

export function openCategoryEditor(kind) {
  const isAisles = kind === 'aisles';
  const rows = isAisles ? aisleList() : getPrefs().categories.map((c) => ({ id: c, name: c }));
  const sheet = openSheet(`
    <h2>${isAisles ? 'List categories' : 'Recipe categories'}</h2>
    <p class="muted small">${isAisles
      ? 'Rename them, or drag ≡ to match the order you walk the store. Items in a removed category go to Other.'
      : 'Rename them, or drag ≡ to change the order they’re shown in. Renaming also updates your recipes.'}</p>
    <div id="cat-rows" class="cat-rows"></div>
    <button type="button" class="btn" id="cat-add">＋ Add category</button>
    <div class="action-row"><button type="button" class="btn primary" id="cat-save">Save</button><button type="button" class="btn" data-close>Cancel</button></div>`);
  const box = sheet.el.querySelector('#cat-rows');
  // "Other" catches everything else, so it can be renamed or moved but not removed.
  const rowHtml = (r) => `<div class="cat-row" data-id="${esc(r.id)}">
      <button type="button" class="drag" aria-label="Drag to reorder" tabindex="-1">≡</button>
      <input value="${esc(r.name)}" aria-label="Category name" placeholder="Category name" autocomplete="off" autocorrect="off" enterkeyhint="done">
      ${isAisles && r.id === 'Other' ? '<span></span>' : '<button type="button" class="row-x" aria-label="Remove">✕</button>'}
    </div>`;
  box.innerHTML = rows.map(rowHtml).join('');
  makeSortable(box, '.cat-row');
  box.addEventListener('click', (e) => e.target.closest('.row-x')?.closest('.cat-row').remove());
  box.addEventListener('keydown', (e) => e.key === 'Enter' && e.target.blur());
  sheet.el.querySelector('#cat-add').onclick = () => {
    box.insertAdjacentHTML('beforeend', rowHtml({ id: '', name: '' }));
    box.lastElementChild.querySelector('input').focus();
  };

  sheet.el.querySelector('#cat-save').onclick = async () => {
    const seen = new Set();
    const out = [];
    for (const row of box.children) {
      const id = row.dataset.id;
      const name = row.querySelector('input').value.trim().replace(/\s+/g, ' ') || (id === 'Other' && isAisles ? 'Other' : '');
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ id, name });
    }
    if (isAisles) {
      // New categories get an id of their own; existing ones keep theirs, so their items stay put when renamed.
      const ids = new Set(out.map((r) => r.id).filter(Boolean));
      for (const r of out.filter((x) => !x.id)) {
        r.id = ids.has(r.name) ? `c-${uid()}` : r.name;
        ids.add(r.id);
      }
      await savePrefs({ aisles: out });
    } else {
      const renamed = new Map(out.filter((r) => r.id && r.id !== r.name).map((r) => [r.id, r.name]));
      for (const recipe of db.all('recipes')) {
        if (renamed.has(recipe.category)) await db.put('recipes', { ...recipe, category: renamed.get(recipe.category) });
      }
      await savePrefs({ categories: out.map((r) => r.name) });
    }
    sheet.close();
    toast('Categories saved');
  };
}
