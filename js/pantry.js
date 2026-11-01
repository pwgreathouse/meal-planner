// Pantry inventory: what's on hand, with optional amounts.
// item: { id, key, name, amount, qty, unit, size, brand, note, addedAt }
//   amount is what the user sees and types ("2 cups", "1 (14.5 oz) can", "half a bag");
//   qty/unit/size are read from it when it's a measurable amount. qty null means "have it, amount unknown".
import * as db from './db.js';
import { uid, capitalize, normalizeText } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { remember } from './catalog.js';
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

// Which pantry items stand for an ingredient. The same name first; otherwise the part before the first comma
// ("Chicken, ground" is chicken) or a close name ("Onion" for "yellow onion"). When several match
// ("Waffles, frozen, blueberry" and "Waffles, frozen, chocolate chip"), the ones whose details the recipe mentions win.
export function matchPantry(key, detail = '', items = pantryItems()) {
  const keyOf = (p) => p.key || ingredientKey(p.name);
  const exact = items.filter((p) => keyOf(p) === key);
  if (exact.length) return exact;
  const near = items.filter((p) => {
    const head = ingredientKey(String(p.name).split(',')[0]);
    return head === key || closeMatch(head, key) || closeMatch(keyOf(p), key);
  });
  if (near.length < 2) return near;
  const words = new Set(normalizeText(`${key} ${detail}`).split(' '));
  const score = (p) => normalizeText(String(p.name).split(',').slice(1).join(' ')).split(' ').filter((w) => w && words.has(w)).length;
  const best = Math.max(...near.map(score));
  return near.filter((p) => score(p) === best);
}

// Pantry "Onion" and a recipe's "yellow onion" (or the other way round): one name is the end of the other.
function closeMatch(a, b) {
  return a.endsWith(` ${b}`) || b.endsWith(` ${a}`);
}

// How much of these items is on hand in one dimension (base units).
// unknown: there's at least one entry with no amount, i.e. "have it".
function available(items, dim) {
  let total = 0, unknown = false;
  for (const p of items) {
    if (p.qty == null) { unknown = true; continue; }
    const m = itemMeasures(p).find(([d]) => d === dim);
    if (m) total += m[1];
  }
  return { total, unknown };
}

// Adds to the pantry. The same item merges: amounts add up when they're measured the same way,
// otherwise the new amount replaces the old one.
export async function addToPantry(name, amount = '', { brand = '', note = '' } = {}) {
  name = capitalize(String(name).trim());
  const key = ingredientKey(name);
  const parsed = parseAmount(amount);
  await remember([{ name }]);
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
    if (brand) existing.brand = brand;
    if (note) existing.note = note;
    return db.put('pantry', existing);
  }
  return db.put('pantry', { id: uid(), key, name, amount: String(amount).trim(), ...parsed, brand, note, addedAt: Date.now() });
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

export async function updatePantryItem(p, { name, amount, brand = p.brand || '', note = p.note || '' }) {
  Object.assign(p, { name: capitalize(name), key: ingredientKey(name), amount, brand, note, ...parseAmount(amount) });
  await db.put('pantry', p);
}

// Items counted in whole things ("3", "2 cans", "1 bag") can go up or down by one from the Pantry screen.
export const isCounted = (p) => p.qty != null && !['volume', 'weight'].includes(unitDim(p.unit));

// One more or one fewer. Reaching zero removes the item; returns the removed copy (for Undo) or null.
export async function stepCount(p, delta) {
  const qty = Math.max(0, Math.round((p.qty + delta) * 100) / 100);
  if (qty <= 0.02) return (await removePantryItems([p.id]))[0] || null;
  Object.assign(p, { qty, amount: formatPantryAmount(qty, p.unit, p.size) });
  await db.put('pantry', p);
  return null;
}

// Removes items; returns copies so they can be put back.
export async function removePantryItems(ids) {
  const copies = ids.map((id) => db.get('pantry', id)).filter(Boolean).map((p) => ({ ...p }));
  for (const p of copies) await db.remove('pantry', p.id);
  return copies;
}

export async function restorePantryItems(copies) {
  for (const p of copies) {
    await db.clearTombstone(`pantry/${p.id}`);
    await db.put('pantry', { ...p });
  }
}

// Takes a shopping list item's numbers ({ ml, g, counts }) and subtracts what's on hand.
// Returns { need (same shape, what's left to buy), have (text of what's on hand), covered (nothing to buy) }.
export function subtractPantry(key, m) {
  const items = matchPantry(key);
  if (!items.length) return { need: m, have: '', covered: false };
  const haveParts = [];
  const need = { ...m, counts: { ...m.counts } };
  let anyUnknown = false;
  const take = (dim, amt, preferred) => {
    const a = available(items, dim);
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
// Rows: { kind: 'use', itemId, name, used, after (qty left), unit, size, for } when the amount can be subtracted;
//       { kind: 'remove', itemId, name, why } for an item that was used but can't be measured
//       (no amount saved, no amount in the recipe, or stored a different way): offered as "used it up".
// `for` is the recipe's wording when the pantry item only matched closely ("Onion" for "yellow onion").
export function planDeductions(recipe, servings) {
  const factor = (servings || recipe.servings || 1) / (recipe.servings || servings || 1);
  const work = new Map(pantryItems().map((p) => [p.id, { ...p, key: p.key || ingredientKey(p.name) }]));
  const rows = [];
  const offered = new Set();
  const offer = (p, why) => {
    if (offered.has(p.id)) return;
    offered.add(p.id);
    rows.push({ kind: 'remove', itemId: p.id, name: p.name, why });
  };
  for (const ing of recipe.ingredients || []) {
    if (ing.header || !ing.name) continue;
    const key = ingredientKey(ing.name);
    const matches = matchPantry(key, ing.note || '', [...work.values()]);
    if (!matches.length) continue;
    const forName = [matches[0].key, ingredientKey(matches[0].name.split(',')[0])].includes(key) ? '' : ing.name;
    const measured = matches.filter((p) => p.qty != null && p.qty > EPS);
    let matched = false;
    if (ing.qty != null) {
      for (const [dim, needed] of measures(ing.qty * factor, ing.unit, ing.size)) {
        const usable = measured.filter((p) => itemMeasures(p).some(([d]) => d === dim));
        if (!usable.length) continue;
        matched = true;
        let need = needed;
        for (const p of usable) {
          if (need <= EPS) break;
          const have = itemMeasures(p).find(([d]) => d === dim)[1];
          const use = Math.min(have, need);
          p.qty = Math.max(0, p.qty - use / (have / p.qty));
          need -= use;
          rows.push({ kind: 'use', itemId: p.id, name: p.name, used: formatBase(dim, use, ing.unit), after: p.qty, unit: p.unit, size: p.size, for: forName });
        }
        break;
      }
    }
    if (matched) continue;
    for (const p of matches) {
      offer(p, ing.qty == null ? `recipe has no amount${forName ? ` (${ing.name})` : ''}`
        : p.qty == null ? `used ${formatAmount(ing.qty * factor, ing.unit)}${forName ? ` ${ing.name}` : ''}; no amount saved in the pantry`
        : `used ${formatAmount(ing.qty * factor, ing.unit)}${forName ? ` ${ing.name}` : ''}; stored as ${amountText(p)}`);
    }
  }
  // An item already going down by an amount doesn't also need the "used it up" offer.
  const reduced = new Set(rows.filter((r) => r.kind === 'use').map((r) => r.itemId));
  return rows.filter((r) => r.kind === 'use' || !reduced.has(r.itemId));
}

// Applies the chosen rows. Anything that reaches zero, or is marked used up, is removed.
export async function applyDeductions(rows) {
  const finalQty = new Map();
  for (const r of rows) finalQty.set(r.itemId, r.kind === 'remove' ? 0 : r.after);
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
