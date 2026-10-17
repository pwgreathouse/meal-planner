// Pantry logic: what's on hand, in what amounts, and the math to add purchases and subtract cooking.
// An item is { id, key, name, qty, unit, size, location, expires, addedAt, source }.
// qty null means "have some, amount unknown".
import * as db from './db.js';
import { uid, today, addDays, capitalize } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { unitDim, toBase, friendlyVolume, friendlyWeight, formatAmount, unitLabel, formatQty } from './units.js';
import { guessAisle } from './aisles.js';
import { getPrefs } from './prefs.js';

export const LOCATIONS = ['Fridge', 'Freezer', 'Pantry'];
const EPS = 1e-6;

export const pantryItems = () => db.all('pantry');
export const itemsFor = (key) => pantryItems().filter((p) => p.key === key);

// The ways an amount can be measured: [dimension, amount in base units].
// "2 cans (14 oz)" counts as 2 cans and as 28 oz, so it can cover a recipe asking for either.
export function measures(qty, unit, size) {
  if (qty == null) return [];
  const d = unitDim(unit);
  if (d === 'volume' || d === 'weight') return [[d, toBase(qty, unit)]];
  const out = [[`count:${unit || ''}`, qty]];
  if (size) {
    const sd = unitDim(size.unit);
    if (sd === 'volume' || sd === 'weight') out.push([sd, qty * toBase(size.qty, size.unit)]);
  }
  return out;
}
export const itemMeasures = (p) => measures(p.qty, p.unit, p.size);

// How much of an ingredient is on hand in one dimension (base units).
export function available(key, dim) {
  let total = 0, unknown = false;
  const items = itemsFor(key);
  for (const p of items) {
    if (p.qty == null) { unknown = true; continue; }
    const m = itemMeasures(p).find(([d]) => d === dim);
    if (m) total += m[1];
  }
  return { total, unknown, any: items.length > 0 };
}

export function formatBase(dim, value, preferred) {
  if (dim === 'volume') { const f = friendlyVolume(value, preferred || 'cup'); return formatAmount(f.value, f.unit); }
  if (dim === 'weight') { const f = friendlyWeight(value, preferred || 'oz'); return formatAmount(f.value, f.unit); }
  return formatAmount(value, dim.slice(6));
}

export function formatItemAmount(p) {
  if (p.qty == null) return 'some';
  // A partly used quart reads better as cups.
  if (['gallon', 'quart', 'pint'].includes(p.unit) && p.qty < 1) return formatBase('volume', toBase(p.qty, p.unit), 'cup');
  if (p.unit === 'lb' && p.qty < 1) return formatBase('weight', toBase(p.qty, p.unit), 'oz');
  let s = formatAmount(p.qty, p.unit);
  if (p.size) s += ` (${formatQty(p.size.qty)} ${unitLabel(p.size.unit, p.size.qty)} each)`;
  return s;
}

const SHELF_DAYS = { Produce: 7, 'Meat & Seafood': 3, 'Dairy & Eggs': 14, 'Bakery & Bread': 6 };

// Where something usually lives and a rough use-by date.
export function defaultsFor(name, unit) {
  const key = ingredientKey(name);
  const aisle = guessAisle(key, getPrefs().aisleOverrides, unit);
  const location = aisle === 'Frozen' ? 'Freezer' : ['Produce', 'Meat & Seafood', 'Dairy & Eggs'].includes(aisle) ? 'Fridge' : 'Pantry';
  const days = location === 'Freezer' ? 90 : SHELF_DAYS[aisle];
  return { location, expires: days ? addDays(today(), days) : '' };
}

// "1 qt" or "2 cans (14 oz)" -> { qty, unit, size }. Only the first part of "2 cups + 1 lb" is used.
export function parseAmount(amountText, name) {
  const first = String(amountText || '').split('+')[0].trim();
  if (!first) return { qty: null, unit: null, size: null };
  const ing = parseIngredient(`${first} ${name}`);
  return { qty: ing.qty ?? null, unit: ing.unit ?? null, size: ing.size ?? null };
}

export async function addToPantry({ name, amount, location, expires, source = 'manual' }) {
  const key = ingredientKey(name);
  const { qty, unit, size } = parseAmount(amount, name);
  const d = defaultsFor(name, unit);
  location = location || d.location;
  expires = expires ?? d.expires;
  // Top up an existing item of the same thing, unit, package size and place.
  const same = itemsFor(key).find(
    (p) => p.location === location && (p.unit || '') === (unit || '') &&
      JSON.stringify(p.size || null) === JSON.stringify(size || null) && p.qty != null && qty != null
  );
  if (same) {
    same.qty += qty;
    if (expires && (!same.expires || expires < same.expires)) same.expires = expires;
    return db.put('pantry', same);
  }
  return db.put('pantry', {
    id: uid(), key, name: capitalize(name.trim()), qty, unit, size, location, expires: expires || '', addedAt: Date.now(), source,
  });
}

// What cooking a recipe would take out of the pantry. Nothing is changed until applyDeductions().
// Returns rows: { itemId, name, ingredient, used, after (qty left), unit, size } or { mismatch: true, ... }.
export function planDeductions(recipe, servings) {
  const factor = (servings || recipe.servings || 1) / (recipe.servings || servings || 1);
  const work = new Map(pantryItems().map((p) => [p.id, { ...p }]));
  const rows = [];
  for (const ing of recipe.ingredients || []) {
    if (ing.header || !ing.name) continue;
    const key = ingredientKey(ing.name);
    const items = [...work.values()]
      .filter((p) => p.key === key)
      .sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999')); // use the oldest first
    if (!items.length) continue;
    if (ing.qty == null) continue; // "salt to taste": leave the pantry alone
    let matched = false;
    for (const [dim, needed] of measures(ing.qty * factor, ing.unit, ing.size)) {
      const usable = items.filter((p) => p.qty != null && p.qty > EPS && itemMeasures(p).some(([d]) => d === dim));
      if (!usable.length) continue;
      matched = true;
      let need = needed;
      for (const p of usable) {
        if (need <= EPS) break;
        const have = itemMeasures(p).find(([d]) => d === dim)[1];
        const use = Math.min(have, need);
        p.qty = Math.max(0, p.qty - use / (have / p.qty));
        need -= use;
        rows.push({ itemId: p.id, name: p.name, ingredient: ing.name, used: formatBase(dim, use, ing.unit), after: p.qty, unit: p.unit, size: p.size });
      }
      if (need > EPS) rows[rows.length - 1].short = formatBase(dim, need, ing.unit);
      break;
    }
    if (!matched) {
      const p = items[0];
      rows.push({ itemId: p.id, name: p.name, ingredient: ing.name, mismatch: true, needText: formatAmount(ing.qty * factor, ing.unit), after: p.qty, unit: p.unit, size: p.size });
    }
  }
  return rows;
}

// Applies chosen rows. An item that hits zero is removed (used up).
export async function applyDeductions(rows) {
  const finalQty = new Map();
  for (const r of rows) if (!r.mismatch) finalQty.set(r.itemId, r.after);
  let removed = 0;
  for (const [id, qty] of finalQty) {
    const p = db.get('pantry', id);
    if (!p) continue;
    if (qty <= 0.02) { await db.remove('pantry', id); removed++; }
    else { p.qty = +qty.toFixed(4); await db.put('pantry', p); }
  }
  return { changed: finalQty.size, removed };
}

// Recipes ranked by how many of their ingredients are already on hand (basics like salt don't count),
// with a nudge toward recipes that use things expiring soon.
export function pantryMatches() {
  const prefs = getPrefs();
  const basics = new Set(prefs.basics.map(ingredientKey));
  const items = pantryItems();
  const keys = new Set(items.map((p) => p.key));
  const soon = addDays(today(), 3);
  const expiring = new Set(items.filter((p) => p.expires && p.expires <= soon).map((p) => p.key));
  return db.all('recipes')
    .map((r) => {
      const uniq = [...new Set((r.ingredients || []).filter((i) => !i.header && i.name).map((i) => ingredientKey(i.name)))].filter((k) => !basics.has(k));
      const have = uniq.filter((k) => keys.has(k));
      return { r, have: have.length, total: uniq.length, usesSoon: have.filter((k) => expiring.has(k)).length, missing: uniq.filter((k) => !keys.has(k)) };
    })
    .filter((x) => x.total && x.have)
    .sort((a, b) => b.usesSoon - a.usesSoon || b.have / b.total - a.have / a.total || b.have - a.have);
}
