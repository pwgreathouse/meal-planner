// Quantity and unit parsing, conversion, and friendly formatting.
// Volume is converted through millilitres and weight through grams; everything else is counted.

const FRACTIONS = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅕': 1 / 5, '⅖': 2 / 5,
  '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const FC = Object.keys(FRACTIONS).join('');

const NUM = `(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d*\\.\\d+|\\d+(?:\\s*[${FC}])?|[${FC}])`;
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?(?![\\d/])`, 'i');
const WORD_NUMS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12,
};

function numValue(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) return +m[1] / +m[2];
  if ((m = s.match(new RegExp(`^(\\d+)\\s*([${FC}])$`)))) return +m[1] + FRACTIONS[m[2]];
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  return parseFloat(s);
}

// Reads a quantity from the start of a string: "1 1/2", "½", "1.5", "2-3", "a".
export function parseQuantity(str) {
  const s = str.trimStart();
  const m = s.match(QTY_RE);
  if (m) {
    const value = numValue(m[1]);
    const max = m[2] ? numValue(m[2]) : null;
    if (!isFinite(value)) return null;
    return { value, max: max != null && isFinite(max) ? max : null, rest: s.slice(m[0].length) };
  }
  const w = s.match(/^([a-z]+)\s+/i);
  if (w && WORD_NUMS[w[1].toLowerCase()] != null) {
    return { value: WORD_NUMS[w[1].toLowerCase()], max: null, rest: s.slice(w[0].length) };
  }
  return null;
}

// key: { dim, base (to ml or g), one, many, aliases }
export const UNITS = {
  tsp: { dim: 'volume', base: 4.92892, one: 'tsp', many: 'tsp', aliases: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 'tspn'] },
  tbsp: { dim: 'volume', base: 14.7868, one: 'Tbsp', many: 'Tbsp', aliases: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tbls', 'tblsp', 'tablespoon', 'tablespoons'] },
  floz: { dim: 'volume', base: 29.5735, one: 'fl oz', many: 'fl oz', aliases: ['fl oz', 'fl. oz', 'floz', 'fluid ounce', 'fluid ounces', 'fluid oz'] },
  cup: { dim: 'volume', base: 236.588, one: 'cup', many: 'cups', aliases: ['c', 'cup', 'cups'] },
  pint: { dim: 'volume', base: 473.176, one: 'pint', many: 'pints', aliases: ['pt', 'pts', 'pint', 'pints'] },
  quart: { dim: 'volume', base: 946.353, one: 'qt', many: 'qt', aliases: ['qt', 'qts', 'quart', 'quarts'] },
  gallon: { dim: 'volume', base: 3785.41, one: 'gal', many: 'gal', aliases: ['gal', 'gals', 'gallon', 'gallons'] },
  ml: { dim: 'volume', base: 1, one: 'ml', many: 'ml', aliases: ['ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  l: { dim: 'volume', base: 1000, one: 'L', many: 'L', aliases: ['l', 'liter', 'liters', 'litre', 'litres'] },
  g: { dim: 'weight', base: 1, one: 'g', many: 'g', aliases: ['g', 'gr', 'gram', 'grams', 'gm', 'gms'] },
  kg: { dim: 'weight', base: 1000, one: 'kg', many: 'kg', aliases: ['kg', 'kgs', 'kilogram', 'kilograms'] },
  oz: { dim: 'weight', base: 28.3495, one: 'oz', many: 'oz', aliases: ['oz', 'ounce', 'ounces'] },
  lb: { dim: 'weight', base: 453.592, one: 'lb', many: 'lb', aliases: ['lb', 'lbs', 'pound', 'pounds', '#'] },
  pinch: { dim: 'count', one: 'pinch', many: 'pinches', aliases: ['pinch', 'pinches'] },
  dash: { dim: 'count', one: 'dash', many: 'dashes', aliases: ['dash', 'dashes'] },
  clove: { dim: 'count', one: 'clove', many: 'cloves', aliases: ['clove', 'cloves'] },
  can: { dim: 'count', one: 'can', many: 'cans', aliases: ['can', 'cans', 'tin', 'tins'] },
  jar: { dim: 'count', one: 'jar', many: 'jars', aliases: ['jar', 'jars'] },
  package: { dim: 'count', one: 'package', many: 'packages', aliases: ['package', 'packages', 'pkg', 'pkgs', 'packet', 'packets', 'pack', 'packs', 'envelope', 'envelopes'] },
  bag: { dim: 'count', one: 'bag', many: 'bags', aliases: ['bag', 'bags'] },
  box: { dim: 'count', one: 'box', many: 'boxes', aliases: ['box', 'boxes'] },
  bottle: { dim: 'count', one: 'bottle', many: 'bottles', aliases: ['bottle', 'bottles'] },
  carton: { dim: 'count', one: 'carton', many: 'cartons', aliases: ['carton', 'cartons', 'container', 'containers', 'tub', 'tubs'] },
  bunch: { dim: 'count', one: 'bunch', many: 'bunches', aliases: ['bunch', 'bunches'] },
  head: { dim: 'count', one: 'head', many: 'heads', aliases: ['head', 'heads'] },
  sprig: { dim: 'count', one: 'sprig', many: 'sprigs', aliases: ['sprig', 'sprigs'] },
  stalk: { dim: 'count', one: 'stalk', many: 'stalks', aliases: ['stalk', 'stalks', 'rib', 'ribs'] },
  slice: { dim: 'count', one: 'slice', many: 'slices', aliases: ['slice', 'slices'] },
  stick: { dim: 'count', one: 'stick', many: 'sticks', aliases: ['stick', 'sticks'] },
  piece: { dim: 'count', one: 'piece', many: 'pieces', aliases: ['piece', 'pieces', 'pc', 'pcs'] },
  handful: { dim: 'count', one: 'handful', many: 'handfuls', aliases: ['handful', 'handfuls'] },
  loaf: { dim: 'count', one: 'loaf', many: 'loaves', aliases: ['loaf', 'loaves'] },
  block: { dim: 'count', one: 'block', many: 'blocks', aliases: ['block', 'blocks'] },
};

const ALIAS = new Map();
for (const [key, u] of Object.entries(UNITS)) for (const a of u.aliases) ALIAS.set(a, key);

// Matches a unit word at the start of a string. Returns { key, rest } or null.
export function matchUnit(str) {
  const s = str.trimStart();
  const one = s.match(/^(\S+)/);
  if (!one) return null;
  // Single-letter T / t are case-sensitive: T = tablespoon, t = teaspoon.
  const first = one[1].replace(/\.$/, '');
  if (first === 'T') return { key: 'tbsp', rest: s.slice(one[0].length).trimStart() };
  if (first === 't') return { key: 'tsp', rest: s.slice(one[0].length).trimStart() };
  const two = s.match(/^(\S+)\s+(\S+)/);
  for (const m of [two, one]) {
    if (!m) continue;
    const cand = (m[2] ? `${m[1]} ${m[2]}` : m[1]).toLowerCase().replace(/[.,]$/, '');
    const key = ALIAS.get(cand) || ALIAS.get(cand.replace(/\./g, ''));
    if (!key) continue;
    const rest = s.slice(m[0].length).trimStart();
    // A bare "c" is only a cup when an ingredient name follows it.
    if (key === 'cup' && cand === 'c' && !rest) continue;
    return { key, rest };
  }
  return null;
}

export const unitDim = (key) => (key ? UNITS[key]?.dim || 'count' : 'count');

export function unitLabel(key, value = 1) {
  const u = UNITS[key];
  if (!u) return key || '';
  return value > 1 ? u.many : u.one;
}

export function toBase(value, key) {
  const u = UNITS[key];
  return u?.base ? value * u.base : value;
}

export function fromBase(value, key) {
  const u = UNITS[key];
  return u?.base ? value / u.base : value;
}

const FRAC_STEPS = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
];

// 1.5 -> "1½", 0.333 -> "⅓", 12.4 -> "12"
export function formatQty(n) {
  if (n == null || !isFinite(n)) return '';
  if (n <= 0) return '0';
  if (n < 1 / 16) return String(+n.toFixed(2));
  if (n >= 20) return String(Math.round(n));
  let whole = Math.floor(n);
  const frac = n - whole;
  let best = FRAC_STEPS[0];
  for (const step of FRAC_STEPS) if (Math.abs(step[0] - frac) < Math.abs(best[0] - frac)) best = step;
  if (best[0] === 1) whole += 1;
  const fracChar = best[0] === 1 ? '' : best[1];
  return `${whole || ''}${fracChar}` || '0';
}

const VOLUME_LADDER = ['gallon', 'quart', 'cup', 'tbsp', 'tsp'];

// Picks a readable unit for a total volume, starting from the unit the recipes used most.
export function friendlyVolume(ml, preferred = 'cup') {
  if (['ml', 'l', 'floz'].includes(preferred)) {
    return { value: fromBase(ml, preferred), unit: preferred };
  }
  let i = Math.max(0, VOLUME_LADDER.indexOf(preferred));
  while (i < VOLUME_LADDER.length - 1 && fromBase(ml, VOLUME_LADDER[i]) < 0.25) i++;
  return { value: fromBase(ml, VOLUME_LADDER[i]), unit: VOLUME_LADDER[i] };
}

export function friendlyWeight(g, preferred = 'oz') {
  if (preferred === 'oz' && g >= 453.592) return { value: g / 453.592, unit: 'lb' };
  if (preferred === 'lb' && g < 113) return { value: g / 28.3495, unit: 'oz' };
  if (preferred === 'g' && g >= 1000) return { value: g / 1000, unit: 'kg' };
  return { value: fromBase(g, preferred), unit: preferred };
}

export function formatAmount(value, unit) {
  const q = formatQty(value);
  return unit ? `${q} ${unitLabel(unit, value)}` : q;
}
