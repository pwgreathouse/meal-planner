// Cloudflare Worker: fetches recipe pages for the app (recipe sites don't allow browsers to read them directly).
// Later this same worker will hold the Claude API key for screenshot reading and suggestions.
//
// Settings (Cloudflare dashboard → Worker → Settings → Variables):
//   APP_TOKEN       a long random code; paste the same code into the app under More → Link import helper
//   ALLOWED_ORIGIN  https://pwgreathouse.github.io

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-App-Token',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: cors });
    }

    const url = new URL(request.url);
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
