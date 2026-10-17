// Turns ingredient lines into structured data, and back into display text.
import { parseQuantity, matchUnit, formatQty, unitLabel } from './units.js';
import { normalizeText } from './util.js';

const BULLET_RE = /^\s*(?:[-*•·▪▢☐□◦‣⁃✓✔○●]|\[\s?[xX]?\s?\]|\d+[.)](?=\s))\s*/;
const TRAILING_NOTE_RE = /,?\s*\b(to taste|for (?:serving|garnish|topping|frying|the pan)|as needed|optional|or more|divided|plus more.*)$/i;

// "1 (14 oz) can diced tomatoes, drained" ->
//   { qty: 1, unit: 'can', size: { qty: 14, unit: 'oz' }, name: 'diced tomatoes', note: 'drained' }
export function parseIngredient(raw) {
  const line = String(raw || '')
    .replace(BULLET_RE, '')
    .replace(/\s*\(\s*\$\s*[\d.]+\*?\s*\)/g, '') // per-ingredient prices, e.g. "($0.20)"
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return null;

  if (/:$/.test(line) && line.length < 60 && !parseQuantity(line)) {
    return { raw: line, header: true, name: line.replace(/:$/, '') };
  }

  let s = line;
  let qty = null, max = null, unit = null, size = null;

  const q = parseQuantity(s);
  if (q) {
    qty = q.value;
    max = q.max;
    s = q.rest.trim();
  }

  // Package size: "(14 oz)", "(14-ounce)" or "14-ounce" right after the count.
  const paren = s.match(/^\(([^)]*)\)\s*/);
  const hyph = !paren && qty != null && s.match(/^(\d+(?:\.\d+)?)[-\s](ounce|oz|pound|lb|gram|g|ml|liter|l)\b\s*/i);
  if (paren) {
    const inner = parseQuantity(paren[1]);
    const u = inner && matchUnit(inner.rest.replace(/^-/, ''));
    if (u) size = { qty: inner.value, unit: u.key };
    s = s.slice(paren[0].length);
  } else if (hyph) {
    const u = matchUnit(hyph[2]);
    if (u) size = { qty: parseFloat(hyph[1]), unit: u.key };
    s = s.slice(hyph[0].length);
  }

  const u = matchUnit(s);
  if (u && (qty != null || u.key !== 'cup')) {
    unit = u.key;
    s = u.rest;
  }
  let note = '';
  // A metric equivalent right after the unit: "1 tsp (3g) baking soda".
  const lead = s.match(/^\(([^)]*)\)\s*/);
  if (lead) {
    note = lead[1];
    s = s.slice(lead[0].length);
  }
  s = s.replace(/^of\s+/i, '');

  const tn = s.match(TRAILING_NOTE_RE);
  if (tn) {
    note = [note, tn[1]].filter(Boolean).join(', ');
    s = s.slice(0, tn.index).trim();
  }
  const parens = s.match(/\s*\(([^)]*)\)\s*$/);
  if (parens) {
    note = [parens[1], note].filter(Boolean).join(', ');
    s = s.slice(0, parens.index).trim();
  }
  const comma = s.indexOf(',');
  if (comma > 0) {
    note = [s.slice(comma + 1).trim(), note].filter(Boolean).join(', ');
    s = s.slice(0, comma).trim();
  }

  return { raw: line, qty, max, unit, size, name: s || line, note };
}

export const parseIngredients = (text) =>
  String(text || '')
    .split(/\n/)
    .map(parseIngredient)
    .filter(Boolean);

export function formatIngredient(ing, factor = 1) {
  if (ing.header) return { header: true, name: ing.name };
  let amount = '';
  if (ing.qty != null) {
    const v = ing.qty * factor;
    const mx = ing.max != null ? ing.max * factor : null;
    amount = formatQty(v) + (mx != null ? `–${formatQty(mx)}` : '');
    if (ing.size) amount += ` (${formatQty(ing.size.qty)} ${unitLabel(ing.size.unit, ing.size.qty)})`;
    if (ing.unit) amount += ` ${unitLabel(ing.unit, mx ?? v)}`;
  } else if (ing.unit) {
    amount = `a ${unitLabel(ing.unit, 1)} of`; // "handful blueberries" -> "a handful of blueberries"
  }
  return { amount, name: ing.name, note: ing.note || '' };
}

export function ingredientText(ing, factor = 1) {
  const f = formatIngredient(ing, factor);
  if (f.header) return `${f.name}:`;
  return [f.amount, f.name].filter(Boolean).join(' ') + (f.note ? `, ${f.note}` : '');
}

// Prep words that don't change what you buy.
const PREP_WORDS = new Set(
  ('chopped diced minced sliced cubed grated shredded julienned peeled seeded deseeded halved quartered ' +
    'trimmed rinsed drained softened melted packed lightly firmly heaping level fresh freshly finely thinly ' +
    'roughly coarsely large medium small about approximately thick thin cut into pieces inch inches room ' +
    'temperature cold warm hot cooked uncooked raw whole crushed torn beaten lukewarm good quality')
    .split(' ')
);
const KEEP_PLURAL = new Set(['molasses', 'hummus', 'asparagus', 'couscous', 'swiss', 'grits', 'chips', 'oats', 'greens', 'brussels', 'sprouts', 'noodles', 'lentils', 'beans', 'peas', 'flakes']);

function singular(w) {
  if (KEEP_PLURAL.has(w) || w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (['leaves', 'halves', 'loaves'].includes(w)) return w.slice(0, -3) + 'f';
  if (/(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

// Key used to combine the same ingredient across recipes.
export function ingredientKey(name) {
  const words = normalizeText(String(name || '').replace(/\([^)]*\)/g, ''))
    .split(' ')
    .filter((w) => w && !PREP_WORDS.has(w) && !/^\d+$/.test(w));
  if (!words.length) return normalizeText(name);
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}
