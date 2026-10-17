// Cloudflare Worker for the Meals app:
//   GET  /fetch?url=…   fetches a recipe page (recipe sites don't allow browsers to read them directly)
//   POST /ai/parse      reads a recipe from text or a photo (Claude)
//   POST /ai/suggest    suggests meals that use up the pantry (Claude + web search)
//   POST /ai/nutrition  estimates nutrition per serving (Claude)
//
// Settings (wrangler.toml / secrets):
//   APP_TOKEN          secret access code; the app sends it as X-App-Token
//   ANTHROPIC_API_KEY  secret Claude API key
//   ALLOWED_ORIGIN     the app's address(es), comma separated
import { parseRecipe, suggestMeals, estimateNutrition, AiError } from './ai.js';

const AI_ROUTES = { '/ai/parse': parseRecipe, '/ai/suggest': suggestMeals, '/ai/nutrition': estimateNutrition };

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'X-App-Token, Content-Type',
      'Vary': 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const given = (request.headers.get('X-App-Token') || '').trim().toUpperCase();
    if (env.APP_TOKEN && given !== env.APP_TOKEN.trim().toUpperCase()) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/ai/status') {
      // Shape check only: the standard prefix and length, never the key itself.
      const k = (env.ANTHROPIC_API_KEY || '').trim();
      return json({ ai: !!k, looksLikeKey: /^sk-ant-[a-z]+/.test(k) && k.length > 40, length: k.length });
    }

    const handler = AI_ROUTES[url.pathname];
    if (handler) {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Bad JSON' }, 400);
      }
      try {
        return json(await handler(env, body));
      } catch (err) {
        if (err instanceof AiError) return json({ error: err.message }, err.status);
        return json({ error: 'Unexpected helper error' }, 500);
      }
    }

    if (url.pathname !== '/fetch') return new Response('Not found', { status: 404, headers: cors });

    let target;
    try {
      target = new URL(url.searchParams.get('url'));
      if (!/^https?:$/.test(target.protocol)) throw new Error();
    } catch {
      return new Response('Bad url', { status: 400, headers: cors });
    }

    const res = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = (await res.text()).slice(0, 4_000_000);
    return new Response(html, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
