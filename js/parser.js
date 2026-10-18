// Rule-based recipe parsing: free-form text (notes, pasted pages) and schema.org JSON-LD from recipe sites.
// This is the no-AI path; an AI parser can replace parseRecipeText later behind the same draft shape.
import { parseIngredient } from './ingredients.js';
import { parseQuantity } from './units.js';
import { normalizeText } from './util.js';

const URL_RE = /https?:\/\/[^\s<>"')]+/i;
const ING_HEAD = /^(?:ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|you will need|shopping list)\b\s*:?\s*$/i;
const STEP_HEAD = /^(?:directions?|instructions?|method|steps?|preparation|prep|how to make(?: it)?|procedure|to make)\b\s*:?\s*$/i;
const NOTE_HEAD = /^(?:notes?|tips?|cook(?:'|’)?s? notes?|recipe notes?|variations?)\b\s*:?\s*$/i;
const SERVES_RE = /\b(?:serves|servings?|yield|yields|makes|portions?)\b\s*:?\s*(?:about\s*)?(\d+)/i;
const TIME_RE = /\b(prep|cook|total|bake)\s*(?:time)?\s*:?\s*((?:\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b\s*)+)/gi;

export function emptyDraft() {
  return {
    title: '', category: '', tags: [], servings: null, prepMin: null, cookMin: null,
    ingredients: [], steps: [], notes: '', sourceUrl: '', image: '',
  };
}

function toMinutes(text) {
  let min = 0;
  const h = text.match(/(\d+)\s*(?:hours?|hrs?|h)\b/i);
  const m = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (h) min += +h[1] * 60;
  if (m) min += +m[1];
  return min || null;
}

function looksLikeIngredient(line) {
  if (line.length > 90) return false;
  const q = parseQuantity(line);
  if (q && q.rest.trim()) {
    // "2 cups flour" or "3 eggs" but not "2. Preheat the oven…"
    if (/^\s*[.)]/.test(q.rest)) return false;
    return true;
  }
  return /^[-*•▢☐□◦]\s/.test(line) && line.split(' ').length <= 10;
}

const stripStepNumber = (l) => l.replace(/^(?:step\s*\d+\s*[:.)-]?|\d+\s*[.)]|[-*•])\s*/i, '').trim();

export function parseRecipeText(text) {
  const draft = emptyDraft();
  const raw = String(text || '').replace(/\r/g, '');
  const url = raw.match(URL_RE);
  if (url) draft.sourceUrl = url[0].replace(/[.,]$/, '');

  const lines = raw.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.length) return draft;

  // Title: first line that isn't a link or a section heading.
  let titleIdx = lines.findIndex((l) => l && !URL_RE.test(l.replace(/^\W+/, '')) && !ING_HEAD.test(l) && !STEP_HEAD.test(l));
  if (titleIdx >= 0 && lines[titleIdx].length <= 100 && !looksLikeIngredient(lines[titleIdx])) {
    draft.title = lines[titleIdx].replace(/^(?:recipe\s*[:\-–]\s*)/i, '').replace(/[#*_]+/g, '').trim();
  } else {
    titleIdx = -1;
  }

  // Servings and times only come from short "meta" lines, never from inside a step.
  const isMeta = (l) =>
    l.length < 70 &&
    (/^(?:serves|servings?|yields?|makes|portions?)\b\s*:?\s*(?:about\s*)?\d/i.test(l) ||
      /^(?:prep|cook|total|bake|active)\s*(?:time)?\s*:?\s*\d/i.test(l));
  for (const l of lines.filter(isMeta)) {
    const serves = l.match(SERVES_RE);
    if (serves && !draft.servings) draft.servings = +serves[1];
    for (const m of l.matchAll(TIME_RE)) {
      const kind = m[1].toLowerCase();
      const min = toMinutes(m[2]);
      if (kind === 'prep') draft.prepMin = min;
      else if (kind === 'cook' || kind === 'bake') draft.cookMin = min;
      else if (kind === 'total' && !draft.cookMin) draft.cookMin = min;
    }
  }

  const body = lines.slice(titleIdx + 1);
  const isUrlOnly = (l) => URL_RE.test(l) && l.replace(URL_RE, '').trim().length < 3;

  const hasHeads = body.some((l) => ING_HEAD.test(l)) || body.some((l) => STEP_HEAD.test(l));
  const ingLines = [], stepLines = [], noteLines = [];

  if (hasHeads) {
    // Before the first heading: with no "Ingredients" heading anywhere, ingredient-looking lines
    // (e.g. a bulleted list followed by "Directions") are the ingredients.
    const hasIngHead = body.some((l) => ING_HEAD.test(l));
    let section = 'intro';
    for (const l of body) {
      if (!l) continue;
      if (ING_HEAD.test(l)) { section = 'ing'; continue; }
      if (STEP_HEAD.test(l)) { section = 'steps'; continue; }
      if (NOTE_HEAD.test(l)) { section = 'notes'; continue; }
      if (isUrlOnly(l) || isMeta(l)) continue;
      if (section === 'intro') (!hasIngHead && looksLikeIngredient(l) ? ingLines : noteLines).push(l);
      else (section === 'ing' ? ingLines : section === 'steps' ? stepLines : noteLines).push(l);
    }
  } else {
    // No headings: the first run of ingredient-looking lines is the ingredient list.
    let phase = 'before';
    for (const l of body) {
      if (!l) {
        if (phase === 'ing' && ingLines.length) phase = 'after';
        continue;
      }
      if (isUrlOnly(l) || isMeta(l)) continue;
      const ingLike = looksLikeIngredient(l) || (phase === 'ing' && l.length < 50 && /:$/.test(l));
      if (phase !== 'after' && ingLike) {
        phase = 'ing';
        ingLines.push(l);
      } else if (phase === 'ing' && l.length < 45 && !/[.!?]$/.test(l)) {
        // Short line inside the list without a quantity, e.g. "salt and pepper".
        ingLines.push(l);
      } else if (phase === 'before' && l.length < 160 && !/^\d+[.)]/.test(l)) {
        noteLines.push(l);
      } else {
        phase = 'after';
        stepLines.push(l);
      }
    }
  }

  draft.ingredients = ingLines.map(parseIngredient).filter(Boolean);
  draft.steps = mergeWrappedSteps(stepLines.map(stripStepNumber).filter(Boolean));
  draft.notes = noteLines.join('\n');
  draft.category = guessCategory(draft);
  return draft;
}

// Joins lines that were soft-wrapped mid-sentence back into one step.
function mergeWrappedSteps(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && !/[.!?:)]$/.test(prev) && /^[a-z]/.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}

// ---------- JSON-LD (most recipe websites) ----------

function decode(s) {
  if (!s) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${String(s)}`, 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

function isoDuration(d) {
  const m = String(d || '').match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i);
  if (!m) return null;
  const min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return min || null;
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipeNode(n);
      if (r) return r;
    }
    return null;
  }
  const type = node['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node;
  return findRecipeNode(node['@graph']) || findRecipeNode(node.mainEntity);
}

function instructionsToSteps(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') return decode(ins).split(/(?<=\.)\s+(?=[A-Z])|\n+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(ins)) {
    return ins.flatMap((i) => {
      if (typeof i === 'string') return [decode(i)];
      if (i['@type'] === 'HowToSection') {
        const steps = instructionsToSteps(i.itemListElement);
        return i.name ? [`${decode(i.name)}:`, ...steps] : steps;
      }
      return [decode(i.text || i.name || '')];
    }).filter(Boolean);
  }
  return instructionsToSteps(ins.itemListElement || ins.text);
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export function parseRecipeHtml(html, url = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    const draft = emptyDraft();
    draft.title = decode(r.name);
    draft.sourceUrl = url;
    draft.ingredients = asList(r.recipeIngredient || r.ingredients).map((i) => parseIngredient(decode(i))).filter(Boolean);
    draft.steps = instructionsToSteps(r.recipeInstructions);
    const y = asList(r.recipeYield).map(String).find((v) => /\d/.test(v));
    if (y) draft.servings = parseInt(y.match(/\d+/)[0], 10);
    draft.prepMin = isoDuration(r.prepTime);
    draft.cookMin = isoDuration(r.cookTime) || (isoDuration(r.totalTime) && (isoDuration(r.totalTime) - (draft.prepMin || 0)) || null);
    const img = asList(r.image)[0];
    draft.image = typeof img === 'string' ? img : img?.url || '';
    draft.notes = decode(r.description);
    const kw = typeof r.keywords === 'string' ? r.keywords.split(',') : asList(r.keywords);
    const cuisine = asList(r.recipeCuisine);
    draft.tags = [...new Set([...cuisine, ...kw].map((t) => decode(t).toLowerCase()).filter((t) => t && t.length < 25))].slice(0, 8);
    if (r.nutrition) draft.nutritionRaw = r.nutrition;
    draft.category = mapSiteCategory(asList(r.recipeCategory).map(decode)) || guessCategory(draft);
    return draft;
  }
  // No structured data: fall back to the page's visible text.
  doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript').forEach((n) => n.remove());
  const main = doc.querySelector('article, main, [class*="recipe"]') || doc.body;
  const text = (main?.innerText || main?.textContent || '').replace(/\n{3,}/g, '\n\n');
  const draft = parseRecipeText(`${doc.title || ''}\n${text}`);
  draft.sourceUrl = url;
  return draft;
}

// ---------- Categories, bulk splitting, duplicates ----------

function mapSiteCategory(cats) {
  const c = cats.join(' ').toLowerCase();
  if (/breakfast|brunch/.test(c)) return 'Breakfast';
  if (/dessert/.test(c)) return 'Desserts';
  if (/soup|stew/.test(c)) return 'Soups & Stews';
  if (/salad/.test(c)) return 'Salads';
  if (/side/.test(c)) return 'Sides';
  if (/snack|appetizer/.test(c)) return 'Snacks';
  if (/drink|beverage|cocktail/.test(c)) return 'Drinks';
  if (/bread|baking/.test(c)) return 'Breads & Baking';
  if (/sauce|dressing|condiment/.test(c)) return 'Sauces & Dressings';
  if (/lunch/.test(c)) return 'Lunch';
  if (/dinner|main|entree/.test(c)) return 'Dinner';
  return '';
}

const CATEGORY_RULES = [
  ['Breakfast', /\b(breakfast|pancake|waffle|oatmeal|overnight oats|granola|frittata|omelet|omelette|egg bites?|egg muffins?|french toast|scramble|smoothie|muffins?|hash|quiche|breakfast burrito)\b/],
  ['Desserts', /\b(cookies?|cake|cupcakes?|brownies?|pie|cobbler|crisp|pudding|ice cream|cheesecake|fudge|tart|dessert|blondies?)\b/],
  ['Soups & Stews', /\b(soup|stew|chili|chowder|bisque|gumbo|pho|ramen)\b/],
  ['Salads', /\b(salad|slaw)\b/],
  ['Drinks', /\b(smoothie|lemonade|cocktail|latte|punch|tea|drink)\b/],
  ['Sauces & Dressings', /\b(sauce|dressing|vinaigrette|marinade|pesto|salsa|dip|aioli|gravy)\b/],
  ['Breads & Baking', /\b(bread|rolls|biscuits?|scones?|focaccia|bagels?|dough|loaf)\b/],
  ['Sides', /\b(roasted (?:vegetables|potatoes|broccoli|carrots)|mashed|side|rice pilaf|coleslaw)\b/],
  ['Snacks', /\b(snack|energy bites?|bars?|trail mix|hummus|popcorn)\b/],
  ['Lunch', /\b(sandwich|wrap|lunch|bowl|panini)\b/],
];

export function guessCategory(draft) {
  const t = (draft.title || '').toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return draft.ingredients?.length ? 'Dinner' : 'Other';
}

// The Apple Notes Shortcut separates notes with a line like "===== NEXT RECIPE =====".
export function splitBulk(text) {
  // The separator may sit on its own line or run into the text around it (Shortcuts' Combine Text can't add line breaks).
  const parts = String(text || '').split(/={3,}\s*NEXT\s+RECIPE\s*={3,}|^\s*={3,}[^\n]*={3,}\s*$/im);
  return parts.map((p) => p.trim()).filter((p) => p.length > 2);
}

export function isJustUrl(text) {
  const t = String(text || '').trim();
  const m = t.match(URL_RE);
  return m && t.replace(m[0], '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length <= 6 ? m[0] : null;
}

function titleWords(t) {
  return new Set(normalizeText(t).split(' ').filter((w) => w.length > 2 && !['the', 'and', 'with', 'best', 'easy', 'recipe'].includes(w)));
}

export function findDuplicate(draft, recipes) {
  const a = titleWords(draft.title);
  for (const r of recipes) {
    if (draft.sourceUrl && r.sourceUrl && draft.sourceUrl === r.sourceUrl) return r;
    if (normalizeText(r.title) === normalizeText(draft.title) && draft.title) return r;
    const b = titleWords(r.title);
    if (a.size >= 2 && b.size >= 2) {
      const inter = [...a].filter((w) => b.has(w)).length;
      if (inter / Math.max(a.size, b.size) >= 0.8) return r;
    }
  }
  return null;
}
