// Claude-powered helpers for the Meals app: read a recipe (text or photo), suggest meals, estimate nutrition.
// The API key lives only here, as the ANTHROPIC_API_KEY secret.
import Anthropic from '@anthropic-ai/sdk';

const MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
const DEFAULT_MODEL = 'claude-opus-5-5';

const CATEGORIES = ['Breakfast', 'Lunch', 'Dinner', 'Soups & Stews', 'Salads', 'Sides', 'Snacks', 'Desserts', 'Breads & Baking', 'Drinks', 'Sauces & Dressings', 'Other'];

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// One request with structured JSON output. Server-side fallbacks re-run a declined request on another model;
// Haiku has no server-side fallback, so the parameter is left off for it.
async function ask(env, { model, system, content, schema, effort = 'low', tools, maxTokens = 16000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new AiError('The AI key is not set up on the helper', 503);
  // Trim stray whitespace or line breaks picked up when the key was pasted.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY.trim() });
  model = MODELS.has(model) ? model : DEFAULT_MODEL;
  const withFallback = model !== 'claude-haiku-5-5';
  const messages = [{ role: 'user', content }];

  let response;
  // Server tools (web search) can pause a long turn; continue it a few times.
  for (let i = 0; i < 4; i++) {
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort, format: { type: 'json_schema', schema } },
        ...(tools ? { tools } : {}),
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AiError('The AI key was rejected. Check it in the Claude Console.', 502);
      if (err instanceof Anthropic.RateLimitError) throw new AiError('Too many AI requests at once. Try again in a minute.', 429);
      if (err instanceof Anthropic.BadRequestError && /credit/i.test(err.message)) throw new AiError('Your Claude credit has run out. Add funds in the Claude Console.', 402);
      if (err instanceof Anthropic.APIError) throw new AiError(`AI service error (${err.status}): ${err.message}`, 502);
      throw err;
    }
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  // Server-tool errors arrive as result blocks, not exceptions: an error result's content is an object, not a list.
  const searchErrors = response.content
    .filter((b) => b.type === 'web_search_tool_result' && b.content && !Array.isArray(b.content))
    .map((b) => b.content.error_code);

  if (response.stop_reason === 'refusal') throw new AiError('The AI declined this request.', 422);
  if (response.stop_reason === 'max_tokens') throw new AiError('The AI response was cut off. Try a shorter input.', 502);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { data: JSON.parse(text), usage: response.usage, model: response.model, ...(searchErrors.length ? { searchErrors } : {}) };
  } catch {
    throw new AiError('The AI returned something unreadable. Try again.', 502);
  }
}

// ---------- Read a recipe from text or a photo ----------

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_recipe', 'title', 'servings', 'prep_minutes', 'cook_minutes', 'category', 'tags', 'ingredients', 'steps', 'notes'],
  properties: {
    is_recipe: { type: 'boolean' },
    title: { type: 'string' },
    servings: { type: 'integer', description: '0 if not stated or inferable' },
    prep_minutes: { type: 'integer', description: '0 if unknown' },
    cook_minutes: { type: 'integer', description: '0 if unknown' },
    category: { type: 'string', enum: CATEGORIES },
    tags: { type: 'array', items: { type: 'string' } },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

const PARSE_SYSTEM = `You turn messy recipe sources (notes, pasted web pages, OCR'd screenshots, photos of cookbook pages or handwritten cards) into a clean recipe for a home meal-planning app.

Rules:
- Ingredients: one per entry, written the way a cookbook would: quantity, unit, ingredient, then any prep after a comma. Example: "1 (14.5 oz) can diced tomatoes, drained". Use plain numbers and fractions like 1 1/2. Keep section headings as their own entry ending in a colon, e.g. "For the sauce:".
- Steps: one instruction per entry, in order, without numbering. Keep the cook's wording; fix only obvious OCR or typing errors.
- Never invent ingredients, amounts or steps that aren't in the source. If something is unreadable, leave it out and say so in notes.
- notes: tips, variations and personal comments from the source (e.g. "doubled the garlic"). Empty string if none.
- tags: up to 5 short lowercase tags that help searching (cuisine, main protein, "quick", "make-ahead", "freezer-friendly", "kid-friendly", diet). No tag that just repeats the category.
- If the source is not a recipe at all, set is_recipe to false and leave the other fields empty.`;

export async function parseRecipe(env, body) {
  const content = [];
  // One or more photos of the same recipe (e.g. both pages of a cookbook spread).
  const images = (body.images || []).slice(0, 4);
  for (const img of images) {
    const media = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(img.mediaType) ? img.mediaType : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: img.data } });
  }
  const text = String(body.text || '').slice(0, 60000);
  if (!images.length && !text) throw new AiError('Nothing to read', 400);
  content.push({
    type: 'text',
    text: text
      ? `Recipe source:\n\n${text}`
      : images.length > 1 ? 'Read the recipe in these images (they are parts of the same recipe).' : 'Read the recipe in this image.',
  });
  return ask(env, { model: body.model, system: PARSE_SYSTEM, content, schema: RECIPE_SCHEMA, effort: 'low' });
}

// ---------- Suggest meals from the pantry ----------

const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'source', 'recipe_id', 'url', 'why', 'uses', 'missing'],
        properties: {
          title: { type: 'string' },
          source: { type: 'string', enum: ['saved', 'web'] },
          recipe_id: { type: 'string', description: 'id of the saved recipe, or empty for web' },
          url: { type: 'string', description: 'recipe page URL for web ideas, or empty' },
          why: { type: 'string', description: 'one short sentence' },
          uses: { type: 'array', items: { type: 'string' }, description: 'pantry items it uses up' },
          missing: { type: 'array', items: { type: 'string' }, description: 'what would need buying' },
        },
      },
    },
  },
};

const SUGGEST_SYSTEM = `You help a home cook plan meals that use up what they already have, especially anything expiring soon.
Suggest practical, family-friendly meals. Prefer their saved recipes when they fit well; refer to a saved recipe by its exact id.
For web ideas, search for real recipes on reputable recipe sites. Every web idea must be one specific recipe page you found in the search results:
use that page's exact title and copy its full URL into "url" (starting with https://). If you didn't find a page for an idea, don't include it.
Never make up a URL.
Keep "why" to one short sentence. Order ideas best first.`;

export async function suggestMeals(env, body) {
  const pantry = (body.pantry || []).slice(0, 200).map((p) => `- ${p.name}${p.amount ? ` (${p.amount})` : ''}${p.expires ? `, use by ${p.expires}` : ''}`).join('\n');
  const recipes = (body.recipes || []).slice(0, 300).map((r) => `- [${r.id}] ${r.title}: ${(r.ingredients || []).join(', ')}`).join('\n');
  const want = Math.min(Math.max(+body.count || 6, 1), 10);
  const web = body.web !== false;
  const prompt = `Today is ${body.today || 'unknown'}.${body.meal ? ` Looking for: ${body.meal}.` : ''}${body.notes ? ` Notes: ${body.notes}.` : ''}

Pantry:
${pantry || '(empty)'}

Always on hand: ${(body.basics || []).join(', ') || 'salt, pepper, oil'}

Saved recipes:
${recipes || '(none)'}

Give up to ${want} ideas${web ? ', mixing saved recipes and new recipes found on the web' : ' from the saved recipes only'}.`;
  const result = await ask(env, {
    model: body.model,
    system: SUGGEST_SYSTEM,
    content: [{ type: 'text', text: prompt }],
    schema: SUGGEST_SCHEMA,
    effort: 'medium',
    tools: web ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }] : undefined,
  });
  // Only keep web ideas that point at a real page, and saved ideas that point at a real recipe.
  const ids = new Set((body.recipes || []).map((r) => r.id));
  result.data.ideas = (result.data.ideas || []).filter((i) =>
    i.source === 'saved' ? ids.has(i.recipe_id) : /^https?:\/\/\S+\.\S+/.test(i.url || '')
  );
  return result;
}

// ---------- Find a recipe online from a title ----------

const FIND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'url', 'title', 'site', 'confidence'],
  properties: {
    found: { type: 'boolean' },
    url: { type: 'string', description: 'exact recipe page URL from the search results, or empty' },
    title: { type: 'string' },
    site: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const FIND_SYSTEM = `A home cook saved a recipe note that lost its link or content. From the note's title (and any scraps of text), find the original published recipe page.
Titles often include the source after "|" or "-" (a site, blog or cookbook author) or a person's name in parentheses; a person's first name alone (e.g. "| Mar", "(from Lesley)") usually means a family recipe that won't be online.
Search the web. Return the exact URL of the single best-matching recipe page from your search results. Never make up a URL.
Use confidence "high" only for a clear match (same title and source); "medium" for the same dish from a likely source; otherwise set found to false.`;

export async function findRecipe(env, body) {
  const title = String(body.title || '').slice(0, 300);
  if (!title) throw new AiError('No title to search for', 400);
  const result = await ask(env, {
    model: body.model,
    system: FIND_SYSTEM,
    content: [{ type: 'text', text: `Note title: ${title}${body.text ? `\nNote text:\n${String(body.text).slice(0, 2000)}` : ''}` }],
    schema: FIND_SCHEMA,
    effort: 'low',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
  });
  const d = result.data;
  if (!d.found || !/^https?:\/\/\S+\.\S+/.test(d.url || '') || d.confidence === 'low') result.data = { ...d, found: false, url: '' };
  return result;
}

// ---------- Estimate nutrition ----------

const NUTRITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['per_serving', 'confidence', 'notes'],
  properties: {
    per_serving: {
      type: 'object',
      additionalProperties: false,
      required: ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'],
      properties: {
        calories: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
        fiber_g: { type: 'number' }, sugar_g: { type: 'number' }, sodium_mg: { type: 'number' },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string', description: 'assumptions made, one or two short sentences' },
  },
};

const NUTRITION_SYSTEM = `You estimate nutrition for home recipes using standard USDA-style values for each ingredient.
Total the whole recipe, then divide by the number of servings. Make sensible assumptions for vague items (e.g. "1 onion" = medium) and list the important ones in notes.
"To taste" seasonings count as negligible except salt, which counts toward sodium at a modest amount. Round sensibly.`;

export async function estimateNutrition(env, body) {
  const lines = (body.ingredients || []).slice(0, 80).join('\n');
  if (!lines) throw new AiError('No ingredients to analyze', 400);
  return ask(env, {
    model: body.model,
    system: NUTRITION_SYSTEM,
    content: [{ type: 'text', text: `Recipe: ${body.title || 'Untitled'}\nServings: ${body.servings || 4}\n\nIngredients:\n${lines}` }],
    schema: NUTRITION_SCHEMA,
    effort: 'low',
  });
}
