// Item catalog: every item ever added (list, pantry, recipe ingredients) is remembered here,
// so it can be picked again later. One synced record: { id: 'catalog', items: { [key]: entry } }.
// entry: { key, name, amount, brand, note, count, last }  (amount, brand, note = the last ones used on the list, if any)
import * as db from './db.js';
import { capitalize, normalizeText } from './util.js';
import { ingredientKey } from './ingredients.js';
import { getPrefs, placeAisle } from './prefs.js';
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
  return placeAisle(guessAisle(entry.key, getPrefs().aisleOverrides));
}

// Records items being used. amount is kept only when given (e.g. "1 gallon" typed on the list).
export async function remember(list) {
  const doc = load();
  const now = Date.now();
  let changed = false;
  for (const { name, amount, brand, note } of list) {
    const clean = String(name || '').trim();
    const key = ingredientKey(clean);
    if (!key) continue;
    const e = doc.items[key] || { key, name: capitalize(clean), amount: '', count: 0, last: 0 };
    e.count++;
    e.last = now;
    if (amount) e.amount = amount;
    if (brand) e.brand = brand;
    if (note) e.note = note;
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

// Every item name anywhere in the app: remembered items, plus any recipe ingredient, pantry item or list item
// not remembered yet. Remembered ones keep their usual amount, brand and note.
function everyItem() {
  const byKey = new Map(catalogEntries().map((e) => [e.key, e]));
  const add = (name) => {
    const clean = String(name || '').trim();
    const key = ingredientKey(clean);
    if (key && !byKey.has(key)) byKey.set(key, { key, name: capitalize(clean), amount: '', count: 0, last: 0 });
  };
  for (const r of db.all('recipes')) for (const i of r.ingredients || []) if (!i.header) add(i.name);
  for (const p of db.all('pantry')) add(p.name);
  for (const i of db.get('shopping', 'list')?.items || []) add(i.name);
  return [...byKey.values()];
}

// Amount words typed before an item ("2 cans", "1 1/2 lb") are skipped when searching.
const AMOUNT_WORD = /^([\d./½¼¾⅓⅔⅛-]+|cups?|cans?|lbs?|pounds?|oz|ounces?|bags?|box(es)?|packages?|pkgs?|gallons?|gal|quarts?|qts?|pints?|tbsp|tsp|bunch(es)?|dozen|jars?|bottles?|bunches|heads?|cloves?|slices?)$/i;

// The amount at the start of what was typed: "2 cans black be" -> "2 cans".
export function leadingAmount(text) {
  const words = String(text || '').trim().split(/\s+/);
  const n = words.findIndex((w) => !AMOUNT_WORD.test(w));
  return (n < 0 ? words : words.slice(0, n)).join(' ');
}

// Small typo allowance: edits needed to turn a into b (stops early past the limit).
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// How well one typed word fits a name's words: starts a word 3, inside a word 2, a near miss ("brocoli") 1.
function wordScore(t, words) {
  if (words.some((w) => w.startsWith(t))) return 3;
  if (words.some((w) => w.includes(t))) return 2;
  const max = t.length >= 7 ? 2 : t.length >= 3 ? 1 : 0;
  // Compare with the start of each word a letter shorter or longer too, since a typo can drop or add one.
  const near = (w) => [t.length - 1, t.length, t.length + 1].some((n) => editDistance(t, w.slice(0, n), max) <= max);
  if (max && words.some(near)) return 1;
  return 0;
}

// Best matches for what's being typed, from every item in the app. Each typed word has to fit (closely is fine);
// names that start with it come first, then the ones used most.
export function searchCatalog(q, limit = 6) {
  const tokens = normalizeText(q).split(' ').filter(Boolean);
  while (tokens.length > 1 && AMOUNT_WORD.test(tokens[0])) tokens.shift(); // "2 cans black be" searches "black be"
  if (!tokens.length) return [];
  const whole = tokens.join(' ');
  return everyItem()
    .map((e) => {
      const name = normalizeText(e.name);
      const words = name.split(' ');
      let score = 0;
      for (const t of tokens) {
        const s = wordScore(t, words);
        if (!s) return { e, score: 0 };
        score += s;
      }
      if (name.startsWith(whole)) score += 2;
      return { e, score };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || b.e.count - a.e.count || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name))
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
