// Domain logic: recipes, weekly plans, and the shopping list built from a plan.
import * as db from './db.js';
import { uid, normalizeText, capitalize } from './util.js';
import { ingredientKey } from './ingredients.js';
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
  await syncShopping(week.id);
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

const mostCommon = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

export function buildFromPlan(week) {
  const prefs = getPrefs();
  const never = new Set(prefs.neverBuy.map(ingredientKey));
  const items = new Map();

  for (const e of week.entries) {
    if (e.type !== 'recipe') continue;
    const r = db.get('recipes', e.recipeId);
    if (!r) continue;
    const factor = (e.servings || r.servings || 1) / (r.servings || e.servings || 1);
    for (const ing of r.ingredients || []) {
      if (ing.header || !ing.name) continue;
      const key = ingredientKey(ing.name);
      if (!key || never.has(key)) continue;
      let it = items.get(key);
      if (!it) {
        it = { key, names: new Map(), sources: new Set(), ml: 0, vol: new Map(), g: 0, wt: new Map(), counts: new Map(), sizes: new Map(), units: new Map(), asNeeded: false };
        items.set(key, it);
      }
      bump(it.names, ing.name.toLowerCase());
      it.sources.add(r.title);
      if (ing.unit) bump(it.units, ing.unit);
      if (ing.qty == null) { it.asNeeded = true; continue; }
      const q = (ing.max ?? ing.qty) * factor; // buy for the top of a range
      const dim = unitDim(ing.unit);
      if (dim === 'volume') { it.ml += toBase(q, ing.unit); bump(it.vol, ing.unit); }
      else if (dim === 'weight') { it.g += toBase(q, ing.unit); bump(it.wt, ing.unit); }
      else {
        const u = ing.unit || '';
        bump(it.counts, u, q);
        if (ing.size) it.sizes.set(u, `${formatQty(ing.size.qty)} ${unitLabel(ing.size.unit, ing.size.qty)}`);
      }
    }
  }

  return [...items.values()].map((it) => {
    const parts = [];
    // You can't buy ⅔ of an onion or a can: whole items round up. The leftover goes to the pantry later.
    for (const [u, q] of it.counts) parts.push(formatAmount(Math.ceil(q - 0.01), u) + (it.sizes.get(u) ? ` (${it.sizes.get(u)})` : ''));
    if (it.ml) { const f = friendlyVolume(it.ml, mostCommon(it.vol)); parts.push(formatAmount(f.value, f.unit)); }
    if (it.g) { const f = friendlyWeight(it.g, mostCommon(it.wt)); parts.push(formatAmount(f.value, f.unit)); }
    return {
      key: it.key,
      name: capitalize(mostCommon(it.names) || it.key),
      amount: parts.join(' + '),
      aisle: guessAisle(it.key, prefs.aisleOverrides, mostCommon(it.units)),
      sources: [...it.sources],
    };
  });
}

export const getShopping = (start) => db.get('shopping', start) || { id: start, items: [] };

// Regenerates plan-derived items while keeping check marks, manual items, and the user's edits.
export async function syncShopping(start) {
  const list = getShopping(start);
  const generated = buildFromPlan(getWeek(start));
  const byKey = new Map(list.items.filter((i) => i.fromPlan).map((i) => [i.key, i]));
  const next = list.items.filter((i) => !i.fromPlan);
  for (const g of generated) {
    const old = byKey.get(g.key);
    next.push({
      id: old?.id || uid(),
      key: g.key,
      name: old?.edited ? old.name : g.name,
      amount: old?.edited ? old.amount : g.amount,
      aisle: g.aisle,
      sources: g.sources,
      checked: old?.checked || false,
      hidden: old?.hidden || false,
      edited: old?.edited || false,
      fromPlan: true,
    });
  }
  const strip = (items) => JSON.stringify(items.map(({ id, ...rest }) => rest).sort((a, b) => (a.key > b.key ? 1 : -1)));
  if (strip(next) !== strip(list.items) || !db.get('shopping', start)) {
    list.items = next;
    await db.put('shopping', list);
  }
  return list;
}

export async function addManualItem(start, name, amount = '') {
  const list = getShopping(start);
  const key = ingredientKey(name);
  list.items.push({
    id: uid(), key, name: capitalize(name.trim()), amount, checked: false, fromPlan: false,
    aisle: guessAisle(key, getPrefs().aisleOverrides), sources: [],
  });
  await db.put('shopping', list);
}
