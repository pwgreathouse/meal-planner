// Calls the AI endpoints on the helper. The Claude key lives only on the helper.
import { getPrefs } from './prefs.js';
import { parseIngredients } from './ingredients.js';
import { emptyDraft } from './parser.js';
import { normalizeText } from './util.js';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (best)', note: 'about 1¢ per recipe, 15–20¢ per suggestion run' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (balanced)', note: 'about half the cost of Opus' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (cheapest)', note: 'pennies for everything, less careful with messy sources' },
];

export const aiReady = () => {
  const p = getPrefs();
  return !!(p.fetchProxyUrl && p.fetchProxyToken);
};

async function call(path, body) {
  const p = getPrefs();
  if (!aiReady()) throw new Error('Set up the helper under More → Link import helper first');
  let res;
  try {
    res = await fetch(`${p.fetchProxyUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Token': p.fetchProxyToken },
      body: JSON.stringify({ model: p.aiModel, ...body }),
    });
  } catch {
    throw new Error('Couldn’t reach the helper. Are you online?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Helper error ${res.status}`);
  return data.data;
}

// AI recipe JSON -> the app's draft shape.
function toDraft(r, extra = {}) {
  const d = emptyDraft();
  if (!r.is_recipe) {
    const err = new Error('That doesn’t look like a recipe.');
    err.notRecipe = true;
    throw err;
  }
  return {
    ...d,
    title: r.title,
    servings: r.servings || null,
    prepMin: r.prep_minutes || null,
    cookMin: r.cook_minutes || null,
    category: r.category,
    tags: r.tags || [],
    ingredients: parseIngredients((r.ingredients || []).join('\n')),
    steps: r.steps || [],
    notes: r.notes || '',
    aiParsed: true,
    ...extra,
  };
}

export async function aiParseText(text, extra) {
  return toDraft(await call('/ai/parse', { text }), extra);
}

export async function aiParseImages(images, extra) {
  return toDraft(await call('/ai/parse', { images }), extra);
}

export async function aiSuggest({ pantry, recipes, basics, meal, notes, web = true, count = 6 }) {
  const today = new Date().toISOString().slice(0, 10);
  const data = await call('/ai/suggest', { pantry, recipes, basics, meal, notes, web, count, today });
  return data.ideas || [];
}

// Fingerprint of the ingredient list, so a stored estimate can tell when the recipe has changed.
export const ingredientsSignature = (recipe) =>
  normalizeText((recipe.ingredients || []).map((i) => i.raw || i.name).join('|') + `|${recipe.servings}`);

export async function aiNutrition(recipe) {
  const data = await call('/ai/nutrition', {
    title: recipe.title,
    servings: recipe.servings || 4,
    ingredients: (recipe.ingredients || []).filter((i) => !i.header).map((i) => i.raw || i.name),
  });
  return { perServing: data.per_serving, confidence: data.confidence, notes: data.notes, at: Date.now(), sig: ingredientsSignature(recipe) };
}

// Shrinks a photo to at most `max` px on the long side as JPEG: plenty for reading text, and cheaper to send.
export function imageToJpeg(file, max = 1568) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ data: c.toDataURL('image/jpeg', 0.85).split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Couldn’t open that image'));
    };
    img.src = url;
  });
}
