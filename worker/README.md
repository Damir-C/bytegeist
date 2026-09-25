# bytegeist-anthropic-proxy

Cloudflare Worker that proxies chat requests from the Bytegeist page
(`https://damir-c.github.io/bytegeist/`) to the Anthropic Messages API. The
Anthropic API key lives only in the Worker's environment secret — it is
never sent by, or readable from, the client.

## Request contract

```
POST /
Content-Type: application/json

{ "messages": [ { "role": "user", "content": "..." } ], "system": "..." }
```

`system` is optional. `model` and `max_tokens` are fixed by the Worker
(`ANTHROPIC_MODEL` / `ANTHROPIC_MAX_TOKENS` in `wrangler.toml`) — the client
can't override them. The response is Anthropic's Messages API response,
forwarded through as-is (same status code and body).

Only requests whose `Origin` header equals `ALLOWED_ORIGIN` get a CORS
response that a browser will let the calling page read. This is a CORS
allowlist, not authentication — a non-browser client can still send an
arbitrary `Origin` header and reach the Worker directly. If that matters for
your use, add a shared-secret header check in `src/index.js`.

## Deploy (Cloudflare dashboard)

1. **Install wrangler and log in**, from `worker/`:
   ```
   npm install
   npx wrangler login
   ```
   This opens a browser to authorize wrangler against your Cloudflare
   account — no dashboard steps needed for this part.

2. **Set the API key secret** (prompts for the value, does not take it as a
   CLI argument, so it never lands in shell history):
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste your Anthropic API key (from console.anthropic.com) when prompted.

   Equivalent dashboard path, if you'd rather not use the CLI: **Cloudflare
   dashboard → Workers & Pages → (after step 3's first deploy) select
   `bytegeist-anthropic-proxy` → Settings → Variables and Secrets → Add →**
   name `ANTHROPIC_API_KEY`, type **Secret**, paste the value → **Save and
   deploy**.

3. **Deploy the Worker:**
   ```
   npx wrangler deploy
   ```
   Wrangler prints the Worker's URL, something like
   `https://bytegeist-anthropic-proxy.<your-subdomain>.workers.dev`. That's
   the endpoint the page should call.

4. **Nothing else to configure in the dashboard** — `ALLOWED_ORIGIN`,
   `ANTHROPIC_MODEL`, and `ANTHROPIC_MAX_TOKENS` are plain (non-secret)
   vars and are already set from `wrangler.toml` on deploy. Change them by
   editing `wrangler.toml` and redeploying, not in the dashboard, so the
   repo stays the source of truth.

## Local dev

```
npx wrangler dev
```
Wrangler will ask you to authenticate or lets you supply `ANTHROPIC_API_KEY`
via a local `.dev.vars` file (gitignored) for testing without touching the
real secret.
