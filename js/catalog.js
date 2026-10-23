// Item catalog: every item ever added (list, pantry, recipe ingredients) is remembered here,
// so it can be picked again later. One synced record: { id: 'catalog', items: { [key]: entry } }.
// entry: { key, name, amount, count, last }  (amount = the last amount used on the list, if any)
import * as db from './db.js';
import { capitalize, normalizeText } from './util.js';
import { ingredientKey } from './ingredients.js';
import { getPrefs } from './prefs.js';
import { guessAisle } from './aisles.js';

const ID = 'catalog';

function load() {
  const doc = db.get('settings', ID);
  if (doc) return doc;
  // First use: start from everything already in the app.
  const seed = { id: ID, items: {} };
  const add = (name, amount = '') => {
    const key = ingredientKey(name);
    if (!key) return;
    const e = seed.items[key] || { key, name: capitalize(name.trim()), amount: '', count: 0, last: 0 };
    e.count++;
    if (amount && !e.amount) e.amount = amount;
    seed.items[key] = e;
  };
  for (const r of db.all('recipes')) for (const i of r.ingredients || []) if (!i.header && i.name) add(i.name);
  for (const p of db.all('pantry')) add(p.name);
  for (const i of db.get('shopping', 'list')?.items || []) add(i.name, i.measure ? '' : i.amount);
  for (const s of getPrefs().staples) add(s);
  return seed;
}

export const catalogEntries = () => Object.values(load().items);

export function aisleOf(entry) {
  return guessAisle(entry.key, getPrefs().aisleOverrides);
}

// Records items being used. amount is kept only when given (e.g. "1 gallon" typed on the list).
export async function remember(list) {
  const doc = load();
  const now = Date.now();
  let changed = false;
  for (const { name, amount } of list) {
    const clean = String(name || '').trim();
    const key = ingredientKey(clean);
    if (!key) continue;
    const e = doc.items[key] || { key, name: capitalize(clean), amount: '', count: 0, last: 0 };
    e.count++;
    e.last = now;
    if (amount) e.amount = amount;
    doc.items[key] = e;
    changed = true;
  }
  if (changed) await db.put('settings', doc);
}

export async function updateEntry(key, { name, amount }) {
  const doc = load();
  const e = doc.items[key];
  if (!e) return;
  const newKey = ingredientKey(name);
  delete doc.items[key];
  doc.items[newKey] = { ...e, key: newKey, name: capitalize(name.trim()), amount: amount.trim() };
  await db.put('settings', doc);
}

export async function forget(key) {
  const doc = load();
  delete doc.items[key];
  await db.put('settings', doc);
}

// Best matches for what's being typed: names that start with it first, then most used.
export function searchCatalog(q, limit = 6) {
  const n = normalizeText(q);
  if (!n) return [];
  return catalogEntries()
    .map((e) => {
      const name = normalizeText(e.name);
      const starts = name.startsWith(n) || name.split(' ').some((w) => w.startsWith(n));
      return { e, score: name.includes(n) ? (starts ? 2 : 1) : 0 };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || b.e.count - a.e.count || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

// Most-used items, for quick-add buttons.
export function frequentItems(n = 8, exclude = new Set()) {
  return catalogEntries()
    .filter((e) => e.count >= 2 && !exclude.has(e.key))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}
