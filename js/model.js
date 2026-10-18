// Domain logic: recipes, weekly plans, and the shopping list built from a plan.
import * as db from './db.js';
import { uid, normalizeText, capitalize } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { unitDim, toBase, friendlyVolume, friendlyWeight, formatAmount, unitLabel, formatQty } from './units.js';
import { guessAisle } from './aisles.js';
import { getPrefs } from './prefs.js';

// ---------- Recipes ----------

export function newRecipe(draft = {}) {
  return {
    title: '', category: 'Other', tags: [], servings: 4, prepMin: null, cookMin: null,
    ingredients: [], steps: [], notes: '', sourceUrl: '', image: '', rating: 0,
    lastMade: null, createdAt: Date.now(),
    ...draft,
    id: draft.id || uid(),
  };
}

const hayCache = new Map();
function haystack(r) {
  const c = hayCache.get(r.id);
  if (c && c.at === r.updatedAt) return c;
  const h = {
    at: r.updatedAt,
    title: normalizeText(r.title),
    tags: normalizeText((r.tags || []).join(' ') + ' ' + r.category),
    ing: normalizeText((r.ingredients || []).map((i) => i.name).join(' ')),
    rest: normalizeText(`${r.notes || ''} ${(r.steps || []).join(' ')}`),
  };
  hayCache.set(r.id, h);
  return h;
}

// Every word must match somewhere; title hits rank above tag, ingredient and note hits.
export function searchRecipes(list, query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (!tokens.length) return list.map((r) => ({ r, score: 0 }));
  const out = [];
  for (const r of list) {
    const h = haystack(r);
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      if (h.title.includes(t)) score += h.title.split(' ').includes(t) ? 12 : 8;
      else if (h.tags.includes(t)) score += 6;
      else if (h.ing.includes(t)) score += 4;
      else if (h.rest.includes(t)) score += 1;
      else { ok = false; break; }
    }
    if (ok) out.push({ r, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function allTags() {
  const counts = new Map();
  for (const r of db.all('recipes')) for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

// ---------- Weekly plan ----------
// A week is { id: <Sunday ISO>, entries: [...] }.
// entry.type: 'recipe' (cook it), 'leftover' (eat from entry.sourceId), 'skip' (no cooking needed).

export const getWeek = (start) => db.get('weeks', start) || { id: start, entries: [] };

export async function saveWeek(week) {
  await db.put('weeks', week);
}

export async function addRecipeEntry(start, { date, meal, recipeId, servings, covers = [], coverMeal }) {
  const week = getWeek(start);
  const entry = { id: uid(), type: 'recipe', date, meal, recipeId, servings, made: false };
  week.entries.push(entry);
  for (const d of covers) {
    week.entries.push({ id: uid(), type: 'leftover', date: d, meal: coverMeal || meal, sourceId: entry.id });
  }
  await saveWeek(week);
  return entry;
}

export async function setCovers(start, entryId, covers, coverMeal) {
  const week = getWeek(start);
  week.entries = week.entries.filter((e) => !(e.type === 'leftover' && e.sourceId === entryId));
  const src = week.entries.find((e) => e.id === entryId);
  for (const d of covers) week.entries.push({ id: uid(), type: 'leftover', date: d, meal: coverMeal || src.meal, sourceId: entryId });
  await saveWeek(week);
}

export async function addSkip(start, { date, meal, label }) {
  const week = getWeek(start);
  week.entries.push({ id: uid(), type: 'skip', date, meal, label });
  await saveWeek(week);
}

export async function updateEntry(start, id, patch) {
  const week = getWeek(start);
  const e = week.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch);
  await saveWeek(week);
}

export async function removeEntry(start, id) {
  const week = getWeek(start);
  week.entries = week.entries.filter((e) => e.id !== id && e.sourceId !== id);
  await saveWeek(week);
}

export const leftoversOf = (week, id) => week.entries.filter((e) => e.type === 'leftover' && e.sourceId === id);

// ---------- Shopping list ----------
// One running list, like a checklist: { id: 'list', items: [...], addedWeeks: { <Sunday ISO>: true } }.
// item: { id, key, name, amount, measure, aisle, checked, recipes: [titles] }.
// `measure` keeps the numbers behind `amount` so the same ingredient from more recipes adds up properly.

export const getList = () => db.get('shopping', 'list') || { id: 'list', items: [], addedWeeks: {} };
const saveList = (list) => db.put('shopping', list);

// Every ingredient name used in your recipes, most used first: suggestions while typing.
export function knownIngredientNames() {
  const counts = new Map();
  for (const r of db.all('recipes')) {
    for (const i of r.ingredients || []) if (!i.header && i.name) counts.set(i.name.toLowerCase(), (counts.get(i.name.toLowerCase()) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([n]) => n);
}

const emptyMeasure = () => ({ ml: 0, vol: {}, g: 0, wt: {}, counts: {}, sizes: {} });
const mostUsed = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];

function addToMeasure(m, ing, factor) {
  if (ing.qty == null) return;
  const q = (ing.max ?? ing.qty) * factor; // buy for the top of a range
  const dim = unitDim(ing.unit);
  if (dim === 'volume') { m.ml += toBase(q, ing.unit); m.vol[ing.unit] = (m.vol[ing.unit] || 0) + 1; }
  else if (dim === 'weight') { m.g += toBase(q, ing.unit); m.wt[ing.unit] = (m.wt[ing.unit] || 0) + 1; }
  else {
    const u = ing.unit || '';
    m.counts[u] = (m.counts[u] || 0) + q;
    if (ing.size) m.sizes[u] = `${formatQty(ing.size.qty)} ${unitLabel(ing.size.unit, ing.size.qty)}`;
  }
}

function mergeMeasures(a, b) {
  const m = { ml: a.ml + b.ml, vol: { ...a.vol }, g: a.g + b.g, wt: { ...a.wt }, counts: { ...a.counts }, sizes: { ...a.sizes, ...b.sizes } };
  for (const [k, v] of Object.entries(b.vol)) m.vol[k] = (m.vol[k] || 0) + v;
  for (const [k, v] of Object.entries(b.wt)) m.wt[k] = (m.wt[k] || 0) + v;
  for (const [k, v] of Object.entries(b.counts)) m.counts[k] = (m.counts[k] || 0) + v;
  return m;
}

export function formatMeasure(m) {
  if (!m) return '';
  const parts = [];
  // You can't buy ⅔ of an onion or a can: whole items round up.
  for (const [u, q] of Object.entries(m.counts)) if (q > 0.01) parts.push(formatAmount(Math.ceil(q - 0.01), u) + (m.sizes[u] ? ` (${m.sizes[u]})` : ''));
  if (m.ml > 0.5) { const f = friendlyVolume(m.ml, mostUsed(m.vol)); parts.push(formatAmount(f.value, f.unit)); }
  if (m.g > 0.5) { const f = friendlyWeight(m.g, mostUsed(m.wt)); parts.push(formatAmount(f.value, f.unit)); }
  return parts.join(' + ');
}

// Ingredients of several recipes, scaled and combined: [{ recipe, servings }] -> items.
function combineIngredients(batches) {
  const prefs = getPrefs();
  const never = new Set(prefs.neverBuy.map(ingredientKey));
  const items = new Map();
  for (const { recipe: r, servings } of batches) {
    const factor = (servings || r.servings || 1) / (r.servings || servings || 1);
    for (const ing of r.ingredients || []) {
      if (ing.header || !ing.name) continue;
      const key = ingredientKey(ing.name);
      if (!key || never.has(key)) continue;
      let it = items.get(key);
      if (!it) {
        it = { key, names: {}, units: {}, recipes: new Set(), measure: emptyMeasure() };
        items.set(key, it);
      }
      it.names[ing.name.toLowerCase()] = (it.names[ing.name.toLowerCase()] || 0) + 1;
      if (ing.unit) it.units[ing.unit] = (it.units[ing.unit] || 0) + 1;
      it.recipes.add(r.title);
      addToMeasure(it.measure, ing, factor);
    }
  }
  return [...items.values()].map((it) => ({
    key: it.key,
    name: capitalize(mostUsed(it.names) || it.key),
    measure: it.measure,
    aisle: guessAisle(it.key, prefs.aisleOverrides, mostUsed(it.units)),
    recipes: [...it.recipes],
  }));
}

// Adds recipes' ingredients to the list. Things in the pantry are skipped; items already on the list add up.
export async function addRecipesToList(batches) {
  const have = new Set(db.all('pantry').map((p) => p.key || ingredientKey(p.name)));
  const list = getList();
  let added = 0, merged = 0;
  const skipped = [];
  for (const g of combineIngredients(batches)) {
    if (have.has(g.key)) { skipped.push(g.name.toLowerCase()); continue; }
    const existing = list.items.find((i) => !i.checked && i.key === g.key);
    if (existing) {
      if (existing.measure) {
        existing.measure = mergeMeasures(existing.measure, g.measure);
        existing.amount = formatMeasure(existing.measure);
      } else {
        existing.amount = [existing.amount, formatMeasure(g.measure)].filter(Boolean).join(' + ');
      }
      existing.recipes = [...new Set([...(existing.recipes || []), ...g.recipes])];
      merged++;
    } else {
      list.items.push({ id: uid(), key: g.key, name: g.name, amount: formatMeasure(g.measure), measure: g.measure, aisle: g.aisle, checked: false, recipes: g.recipes });
      added++;
    }
  }
  await saveList(list);
  return { added, merged, skipped };
}

export function listResultText({ added, merged, skipped }) {
  const parts = [];
  if (added) parts.push(`Added ${added} item${added === 1 ? '' : 's'}`);
  if (merged) parts.push(`${merged} combined with what was on the list`);
  if (skipped.length) parts.push(`skipped ${skipped.length} you have (${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''})`);
  return parts.join(' · ') || 'Nothing new to add';
}

// The week's planned (and not yet cooked) recipes, ready for addRecipesToList.
export function weekBatches(start) {
  return getWeek(start).entries
    .filter((e) => e.type === 'recipe' && !e.made)
    .map((e) => ({ recipe: db.get('recipes', e.recipeId), servings: e.servings }))
    .filter((b) => b.recipe);
}

export async function addWeekToList(start) {
  const res = await addRecipesToList(weekBatches(start));
  const list = getList();
  list.addedWeeks = { ...(list.addedWeeks || {}), [start]: true };
  await saveList(list);
  return res;
}

// "2 lb chicken thighs" -> name "Chicken thighs", amount "2 lb". Plain "milk" stays as is.
export async function addManualItem(text) {
  const ing = parseIngredient(text.trim());
  const name = capitalize(ing?.qty != null && ing.name ? ing.name : text.trim());
  const key = ingredientKey(name);
  const measure = ing?.qty != null ? (() => { const m = emptyMeasure(); addToMeasure(m, ing, 1); return m; })() : null;
  const list = getList();
  const existing = list.items.find((i) => !i.checked && i.key === key);
  if (existing) {
    if (measure && existing.measure) {
      existing.measure = mergeMeasures(existing.measure, measure);
      existing.amount = formatMeasure(existing.measure);
    } else if (measure) {
      existing.amount = [existing.amount, formatMeasure(measure)].filter(Boolean).join(' + ');
    }
  } else {
    list.items.push({
      id: uid(), key, name, amount: measure ? formatMeasure(measure) : '', measure,
      aisle: guessAisle(key, getPrefs().aisleOverrides, ing?.unit), checked: false, recipes: [],
    });
  }
  await saveList(list);
}

export async function updateListItem(id, patch) {
  const list = getList();
  const it = list.items.find((i) => i.id === id);
  if (!it) return;
  // Typing an amount by hand replaces the computed one.
  if ('amount' in patch && patch.amount !== it.amount) it.measure = null;
  Object.assign(it, patch);
  await saveList(list);
}

export async function removeListItems(ids) {
  const list = getList();
  const drop = new Set(ids);
  list.items = list.items.filter((i) => !drop.has(i.id));
  await saveList(list);
}

