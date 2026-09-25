// Proxies chat requests from the Bytegeist page to the Anthropic Messages
// API, so the API key never reaches the browser. The client sends only
// { messages, system } — model/max_tokens are fixed server-side (see
// wrangler.toml [vars]) so a caller can't drive up cost by overriding them.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const corsHeaders = buildCorsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    // Origin header is sent by browsers and enforced there via CORS (a
    // missing Access-Control-Allow-Origin blocks the page from reading the
    // response) — it's not proof of identity for non-browser callers, just
    // an extra check that rejects cross-site browser use up front.
    if (origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'Server misconfigured: ANTHROPIC_API_KEY not set' }, 500, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const { messages, system } = body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: '"messages" must be a non-empty array' }, 400, corsHeaders);
    }

    const anthropicPayload = {
      model: env.ANTHROPIC_MODEL,
      max_tokens: Number(env.ANTHROPIC_MAX_TOKENS),
      messages,
    };
    if (typeof system === 'string' && system.length > 0) {
      anthropicPayload.system = system;
    }

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(anthropicPayload),
      });
    } catch {
      return jsonResponse({ error: 'Failed to reach Anthropic API' }, 502, corsHeaders);
    }

    // Forward Anthropic's response (success or error) through as-is, so the
    // client sees the same status/body it would from calling Anthropic
    // directly — just with CORS headers attached.
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};

function buildCorsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function jsonResponse(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
