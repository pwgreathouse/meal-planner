// Simple pantry: a plain list of what's on hand. item: { id, key, name, amount }.
// Things in the pantry are skipped when meals are added to the shopping list.
import * as db from './db.js';
import { uid, capitalize } from './util.js';
import { ingredientKey, parseIngredient } from './ingredients.js';
import { formatAmount, formatQty, unitLabel } from './units.js';

export const pantryItems = () => db.all('pantry');

// Older pantry items stored numbers; show them as text.
export function amountText(p) {
  if (typeof p.amount === 'string') return p.amount;
  if (p.qty == null) return '';
  return formatAmount(p.qty, p.unit) + (p.size ? ` (${formatQty(p.size.qty)} ${unitLabel(p.size.unit, p.size.qty)})` : '');
}

// "2 cans black beans" -> name "Black beans", amount "2 cans". Adding something already there just updates it.
export async function addToPantry(text) {
  const ing = parseIngredient(text.trim());
  const hasAmount = ing?.qty != null && ing.name;
  const name = capitalize(hasAmount ? ing.name : text.trim());
  const amount = hasAmount ? text.trim().slice(0, text.trim().toLowerCase().lastIndexOf(ing.name.toLowerCase())).trim() : '';
  const key = ingredientKey(name);
  const existing = pantryItems().find((p) => (p.key || ingredientKey(p.name)) === key);
  if (existing) {
    Object.assign(existing, { key, name, amount: amount || amountText(existing) });
    return db.put('pantry', existing);
  }
  return db.put('pantry', { id: uid(), key, name, amount, addedAt: Date.now() });
}

export async function updatePantryItem(p, { name, amount }) {
  Object.assign(p, { name, amount, key: ingredientKey(name) });
  delete p.qty;
  delete p.unit;
  delete p.size;
  await db.put('pantry', p);
}
