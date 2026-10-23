// Pantry inventory: what's on hand, with optional amounts.
// item: { id, key, name, amount, qty, unit, size, addedAt }
//   amount is what the user sees and types ("2 cups", "1 (14.5 oz) can", "half a bag");
//   qty/unit/size are read from it when it's a measurable amount. qty null means "have it, amount unknown".
import * as db from './db.js';
import { uid, capitalize } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { unitDim, toBase, fromBase, friendlyVolume, friendlyWeight, formatAmount, unitLabel, formatQty } from './units.js';

const EPS = 1e-6;

export const pantryItems = () => db.all('pantry');
export const itemsFor = (key) => pantryItems().filter((p) => (p.key || ingredientKey(p.name)) === key);

// "2 cups" or "1 (14.5 oz) can" -> { qty, unit, size }. Anything unreadable ("half a bag") -> qty null.
export function parseAmount(text) {
  const t = String(text || '').trim();
  if (!t) return { qty: null, unit: null, size: null };
  const ing = parseIngredient(`${t} x`);
  return ing?.qty != null ? { qty: ing.qty, unit: ing.unit || null, size: ing.size || null } : { qty: null, unit: null, size: null };
}

export function formatPantryAmount(qty, unit, size) {
  if (qty == null) return '';
  // A partly used quart or pound reads better in cups or ounces.
  if (['gallon', 'quart', 'pint'].includes(unit) && qty < 1) return formatBase('volume', toBase(qty, unit), 'cup');
  if (unit === 'lb' && qty < 1) return formatBase('weight', toBase(qty, unit), 'oz');
  const sizeText = size ? ` (${formatQty(size.qty)} ${unitLabel(size.unit, size.qty)})` : '';
  return unit ? `${formatQty(qty)}${sizeText} ${unitLabel(unit, qty)}` : `${formatQty(qty)}${sizeText}`;
}

export const amountText = (p) => (typeof p.amount === 'string' ? p.amount : formatPantryAmount(p.qty, p.unit, p.size));

export function formatBase(dim, value, preferred) {
  if (dim === 'volume') { const f = friendlyVolume(value, preferred || 'cup'); return formatAmount(f.value, f.unit); }
  if (dim === 'weight') { const f = friendlyWeight(value, preferred || 'oz'); return formatAmount(f.value, f.unit); }
  return formatAmount(value, dim.slice(6));
}

// The ways an amount can be measured: [dimension, amount in base units].
// "2 cans (14 oz)" counts as 2 cans and as 28 oz, so it covers a recipe asking for either.
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
const itemMeasures = (p) => measures(p.qty, p.unit, p.size);

// How much of an ingredient is on hand in one dimension (base units).
// unknown: there's at least one entry with no amount, i.e. "have it".
export function available(key, dim) {
  let total = 0, unknown = false;
  for (const p of itemsFor(key)) {
    if (p.qty == null) { unknown = true; continue; }
    const m = itemMeasures(p).find(([d]) => d === dim);
    if (m) total += m[1];
  }
  return { total, unknown };
}

// Adds to the pantry. The same item merges: amounts add up when they're measured the same way,
// otherwise the new amount replaces the old one.
export async function addToPantry(name, amount = '') {
  name = capitalize(String(name).trim());
  const key = ingredientKey(name);
  const parsed = parseAmount(amount);
  const existing = itemsFor(key)[0];
  if (existing) {
    const a = itemMeasures(existing), b = measures(parsed.qty, parsed.unit, parsed.size);
    const shared = a.length && b.length && a.find(([d]) => b.some(([e]) => e === d));
    if (shared) {
      const dim = shared[0];
      const total = shared[1] + b.find(([d]) => d === dim)[1];
      // Keep the existing item's unit: convert the total back into it.
      if (dim === 'volume' || dim === 'weight') existing.qty = fromBase(total, existing.unit);
      else existing.qty = total / (shared[1] / existing.qty);
      existing.amount = formatPantryAmount(existing.qty, existing.unit, existing.size);
    } else if (String(amount).trim()) {
      Object.assign(existing, parsed, { amount: String(amount).trim() });
    }
    existing.key = key;
    return db.put('pantry', existing);
  }
  return db.put('pantry', { id: uid(), key, name, amount: String(amount).trim(), ...parsed, addedAt: Date.now() });
}

// "2 cans black beans" -> addToPantry("Black beans", "2 cans"). Plain "rice" -> have it, no amount.
export async function addTextToPantry(text) {
  const t = text.trim();
  const ing = parseIngredient(t);
  if (ing?.qty != null && ing.name) {
    const at = t.toLowerCase().lastIndexOf(ing.name.toLowerCase());
    return addToPantry(ing.name, at > 0 ? t.slice(0, at).trim() : '');
  }
  return addToPantry(t, '');
}

export async function updatePantryItem(p, { name, amount }) {
  Object.assign(p, { name: capitalize(name), key: ingredientKey(name), amount, ...parseAmount(amount) });
  await db.put('pantry', p);
}

// Takes a shopping list item's numbers ({ ml, g, counts }) and subtracts what's on hand.
// Returns { need (same shape, what's left to buy), have (text of what's on hand), covered (nothing to buy) }.
export function subtractPantry(key, m) {
  const items = itemsFor(key);
  if (!items.length) return { need: m, have: '', covered: false };
  const haveParts = [];
  const need = { ...m, counts: { ...m.counts } };
  let anyUnknown = false;
  const take = (dim, amt, preferred) => {
    const a = available(key, dim);
    anyUnknown ||= a.unknown;
    if (a.total > EPS && amt > EPS) haveParts.push(formatBase(dim, a.total, preferred));
    return Math.max(0, amt - a.total);
  };
  need.ml = take('volume', m.ml, Object.keys(m.vol || {})[0]);
  need.g = take('weight', m.g, Object.keys(m.wt || {})[0]);
  for (const [u, q] of Object.entries(m.counts)) need.counts[u] = take(`count:${u}`, q, u);
  const nothingMeasured = !m.ml && !m.g && !Object.keys(m.counts).length; // e.g. "salt to taste"
  const stillNeed = need.ml > 0.5 || need.g > 0.5 || Object.values(need.counts).some((q) => q > 0.01);
  // An entry with no amount ("have it") covers the ingredient fully.
  const covered = anyUnknown || nothingMeasured || !stillNeed;
  return { need, have: haveParts.join(' + ') || (anyUnknown ? 'some' : ''), covered };
}

// What cooking a recipe takes out of the pantry. Nothing changes until applyDeductions().
// Rows: { itemId, name, used, after (qty left), unit, size } or { mismatch: true, ... } when it can't be matched.
export function planDeductions(recipe, servings) {
  const factor = (servings || recipe.servings || 1) / (recipe.servings || servings || 1);
  const work = new Map(pantryItems().map((p) => [p.id, { ...p }]));
  const rows = [];
  for (const ing of recipe.ingredients || []) {
    if (ing.header || !ing.name || ing.qty == null) continue; // "salt to taste" leaves the pantry alone
    const key = ingredientKey(ing.name);
    const items = [...work.values()].filter((p) => (p.key || ingredientKey(p.name)) === key && p.qty != null && p.qty > EPS);
    if (!items.length) continue;
    let matched = false;
    for (const [dim, needed] of measures(ing.qty * factor, ing.unit, ing.size)) {
      const usable = items.filter((p) => itemMeasures(p).some(([d]) => d === dim));
      if (!usable.length) continue;
      matched = true;
      let need = needed;
      for (const p of usable) {
        if (need <= EPS) break;
        const have = itemMeasures(p).find(([d]) => d === dim)[1];
        const use = Math.min(have, need);
        p.qty = Math.max(0, p.qty - use / (have / p.qty));
        need -= use;
        rows.push({ itemId: p.id, name: p.name, used: formatBase(dim, use, ing.unit), after: p.qty, unit: p.unit, size: p.size });
      }
      break;
    }
    if (!matched) rows.push({ itemId: items[0].id, name: items[0].name, mismatch: true, needText: formatAmount(ing.qty * factor, ing.unit) });
  }
  return rows;
}

// Applies the chosen rows. Anything that reaches zero is removed (used up).
export async function applyDeductions(rows) {
  const finalQty = new Map();
  for (const r of rows) if (!r.mismatch) finalQty.set(r.itemId, r.after);
  let removed = 0;
  for (const [id, qty] of finalQty) {
    const p = db.get('pantry', id);
    if (!p) continue;
    if (qty <= 0.02) { await db.remove('pantry', id); removed++; }
    else {
      p.qty = +qty.toFixed(4);
      p.amount = formatPantryAmount(p.qty, p.unit, p.size);
      await db.put('pantry', p);
    }
  }
  return { changed: finalQty.size, removed };
}
