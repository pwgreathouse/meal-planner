// Domain logic: recipes, weekly plans, and the shopping list built from a plan.
import * as db from './db.js';
import { uid, normalizeText, capitalize } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { unitDim, toBase, friendlyVolume, friendlyWeight, formatAmount, unitLabel, formatQty } from './units.js';
import { guessAisle } from './aisles.js';
import { getPrefs, savePrefs } from './prefs.js';
import { subtractPantry } from './pantry.js';
import { remember, catalogEntries } from './catalog.js';

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
// item: { id, key, name, amount, measure, aisle, brand, note, later, checked, recipes: [titles], parts }.
// `measure` keeps the numbers behind `amount` so the same ingredient from more recipes adds up properly.
// `parts` is what each source asked for: { [source]: { title, m } }, where source is a plan entry id,
//   "r:<recipe id>" (added from the recipe page) or "_manual" (typed in). A meal taken off the plan can then
//   take its share back off the list. null when it can't be known (older items, amounts typed over).
// `later`: couldn't get it (out of stock); it stays on the list for next time.

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
  for (const { recipe: r, servings, source } of batches) {
    const src = source || `r:${r.id}`;
    const factor = (servings || r.servings || 1) / (r.servings || servings || 1);
    for (const ing of r.ingredients || []) {
      if (ing.header || !ing.name) continue;
      const key = ingredientKey(ing.name);
      if (!key || never.has(key)) continue;
      let it = items.get(key);
      if (!it) {
        it = { key, names: {}, units: {}, recipes: new Set(), measure: emptyMeasure(), parts: {} };
        items.set(key, it);
      }
      it.names[ing.name.toLowerCase()] = (it.names[ing.name.toLowerCase()] || 0) + 1;
      if (ing.unit) it.units[ing.unit] = (it.units[ing.unit] || 0) + 1;
      it.recipes.add(r.title);
      addToMeasure(it.measure, ing, factor);
      addToMeasure((it.parts[src] ||= { title: r.title, m: emptyMeasure() }).m, ing, factor);
    }
  }
  return [...items.values()].map((it) => ({
    key: it.key,
    name: capitalize(mostUsed(it.names) || it.key),
    measure: it.measure,
    aisle: guessAisle(it.key, prefs.aisleOverrides, mostUsed(it.units)),
    recipes: [...it.recipes],
    parts: it.parts,
  }));
}

// Adds recipes' ingredients to the list. Things in the pantry are skipped; items already on the list add up.
export async function addRecipesToList(batches) {
  const list = getList();
  let added = 0, merged = 0;
  const skipped = [];
  for (const g of combineIngredients(batches)) {
    // Buy only what the pantry doesn't already cover.
    const { need, have, covered } = subtractPantry(g.key, g.measure);
    if (covered) { skipped.push(g.name.toLowerCase()); continue; }
    g.measure = need;
    g.have = have;
    const existing = list.items.find((i) => !i.checked && i.key === g.key);
    if (existing) {
      if (existing.measure) {
        existing.measure = mergeMeasures(existing.measure, g.measure);
        existing.amount = formatMeasure(existing.measure);
      } else {
        existing.amount = [existing.amount, formatMeasure(g.measure)].filter(Boolean).join(' + ');
      }
      existing.recipes = [...new Set([...(existing.recipes || []), ...g.recipes])];
      existing.parts = existing.parts && existing.measure ? mergeParts(existing.parts, g.parts) : null;
      merged++;
    } else {
      list.items.push({ id: uid(), key: g.key, name: g.name, amount: formatMeasure(g.measure), measure: g.measure, have: g.have, aisle: g.aisle, checked: false, recipes: g.recipes, parts: g.parts });
      added++;
    }
  }
  await saveList(list);
  await remember(batches.flatMap(({ recipe }) => (recipe.ingredients || []).filter((i) => !i.header && i.name).map((i) => ({ name: i.name }))));
  return { added, merged, skipped };
}

function mergeParts(a, b) {
  const out = { ...a };
  for (const [s, p] of Object.entries(b)) out[s] = out[s] ? { ...p, m: mergeMeasures(out[s].m, p.m) } : p;
  return out;
}

export function listResultText({ added, merged, skipped }) {
  const parts = [];
  if (added) parts.push(`Added ${added} item${added === 1 ? '' : 's'}`);
  if (merged) parts.push(`${merged} combined with what was on the list`);
  if (skipped.length) parts.push(`skipped ${skipped.length} the pantry covers (${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''})`);
  return parts.join(' · ') || 'Nothing new to add';
}

// The week's planned (and not yet cooked) recipes, ready for addRecipesToList.
export function weekBatches(start) {
  return getWeek(start).entries
    .filter((e) => e.type === 'recipe' && !e.made)
    .map((e) => ({ recipe: db.get('recipes', e.recipeId), servings: e.servings, source: e.id }))
    .filter((b) => b.recipe);
}

export async function addWeekToList(start) {
  const res = await addRecipesToList(weekBatches(start));
  const list = getList();
  list.addedWeeks = { ...(list.addedWeeks || {}), [start]: true };
  await saveList(list);
  return res;
}

// Is anything on the list there because of this plan entry? (Older items only know the recipe's title.)
export function listHasSource(source, title) {
  return getList().items.some((i) => !i.checked && (i.parts ? !!i.parts[source] : i.recipes?.includes(title)));
}

// Takes a planned meal's ingredients back off the list (items still to get, not ones in the cart).
// Items only that meal needed go; shared items go down by its share, or keep their amount when it isn't known.
export async function removeSourceFromList(source, title) {
  const list = getList();
  const res = { removed: 0, reduced: 0, kept: 0 };
  const drop = new Set();
  for (const it of list.items) {
    if (it.checked) continue;
    if (it.parts?.[source]) {
      delete it.parts[source];
      const rest = Object.values(it.parts);
      if (!rest.length) { drop.add(it.id); res.removed++; continue; }
      if (!rest.some((p) => p.title === title)) it.recipes = (it.recipes || []).filter((t) => t !== title);
      if (!it.measure) { res.kept++; continue; }
      const { need, have, covered } = subtractPantry(it.key, rest.reduce((m, p) => mergeMeasures(m, p.m), emptyMeasure()));
      if (covered && !it.parts._manual) { drop.add(it.id); res.removed++; continue; }
      Object.assign(it, { measure: need, amount: formatMeasure(need), have });
      res.reduced++;
    } else if (!it.parts && it.recipes?.includes(title)) {
      it.recipes = it.recipes.filter((t) => t !== title);
      if (it.recipes.length) res.kept++;
      else { drop.add(it.id); res.removed++; }
    }
  }
  list.items = list.items.filter((i) => !drop.has(i.id));
  await saveList(list);
  return res;
}

export function removedText({ removed, reduced, kept }) {
  const parts = [];
  if (removed) parts.push(`Took ${removed} item${removed === 1 ? '' : 's'} off the list`);
  if (reduced) parts.push(`${reduced} lowered`);
  if (kept) parts.push(`${kept} shared with other meals left as they were`);
  return parts.join(' · ') || 'Nothing on the list was from this meal';
}

// Splits typed text into item name and amount.
// If it ends with an item you've used before ("2 half gallons milk"), that's the name and the rest is the amount,
// kept word for word. Otherwise "2 lb chicken thighs" -> "Chicken thighs" + "2 lb"; plain "milk" has no amount.
export function splitItemText(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  const lower = t.toLowerCase();
  const known = catalogEntries()
    .filter((e) => lower === e.name.toLowerCase() || lower.endsWith(` ${e.name.toLowerCase()}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (known) return { name: known.name, amount: t.slice(0, t.length - known.name.length).trim() };
  const ing = parseIngredient(t);
  if (ing?.qty != null && ing.name) {
    const at = lower.lastIndexOf(ing.name.toLowerCase());
    return { name: capitalize(ing.name), amount: at > 0 ? t.slice(0, at).trim() : '' };
  }
  return { name: capitalize(t), amount: '' };
}

// The numbers behind an amount like "2 lb" or "1 (14.5 oz) can", so it can add up; null for "a bunch", "2 half gallons".
function amountMeasure(amount) {
  if (!amount) return null;
  const ing = parseIngredient(`${amount} xx`);
  if (ing?.qty == null || ing.name !== 'xx') return null; // only when the whole amount was understood
  const m = emptyMeasure();
  addToMeasure(m, ing, 1);
  return { m, unit: ing.unit };
}

// Typed as one line, e.g. "2 lb chicken thighs" (Your items, quick picks).
export const addManualItem = (text) => addListItem(splitItemText(text));

// Adds an item with its details. The same item already on the list gets the amount added on.
// A category picked that differs from the usual one is remembered for this item.
export async function addListItem({ name, amount = '', brand = '', note = '', aisle = '' }) {
  name = capitalize(String(name || '').trim().replace(/\s+/g, ' '));
  if (!name) return;
  amount = String(amount).trim();
  brand = String(brand).trim();
  note = String(note).trim();
  const key = ingredientKey(name);
  const parsed = amountMeasure(amount);
  // Remember it, with the amount and details typed, for next time.
  await remember([{ name, amount, brand, note }]);
  const prefs = getPrefs();
  const usual = guessAisle(key, prefs.aisleOverrides, parsed?.unit);
  if (aisle && aisle !== usual) await savePrefs({ aisleOverrides: { ...prefs.aisleOverrides, [key]: aisle } });
  const list = getList();
  const existing = list.items.find((i) => !i.checked && i.key === key);
  if (existing) {
    if (parsed && existing.measure) {
      existing.measure = mergeMeasures(existing.measure, parsed.m);
      existing.amount = formatMeasure(existing.measure);
    } else if (amount) {
      existing.measure = null;
      existing.amount = [existing.amount, amount].filter(Boolean).join(' + ');
    }
    if (existing.parts) existing.parts = mergeParts(existing.parts, { _manual: { title: '', m: parsed?.m || emptyMeasure() } });
    if (brand) existing.brand = brand;
    if (note) existing.note = note;
    if (aisle) existing.aisle = aisle;
    existing.later = false;
  } else {
    list.items.push({
      id: uid(), key, name, amount: parsed ? formatMeasure(parsed.m) : amount, measure: parsed?.m || null,
      aisle: aisle || usual, brand, note, later: false, checked: false, recipes: [],
      parts: { _manual: { title: '', m: parsed?.m || emptyMeasure() } },
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

