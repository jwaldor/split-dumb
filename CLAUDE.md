# SplitDumb

A dead-simple, account-free bill splitter (think Splitwise without the accounts).

## What it does

1. You enter your Venmo handle once — saved to `localStorage`.
2. "Start a tab" creates an empty tab (short shareable URL + QR code).
3. You add **one** receipt — **take a photo or upload a file** — and it's OCR'd
   into line items + tax/tip. One scan per tab (the server rejects a second).
   Afterward the creator refines by hand via **Edit / add items** (fix OCR
   mistakes, add what was missed, remove extras). Tax/tip editable.
4. Anyone scans the QR, enters their name, and claims items (fully or partially —
   you can only claim the portion of an item that's still unclaimed).
5. Each person sees what they owe (their items + proportional tax/tip/extras),
   taps a prefilled Venmo link to pay, then marks themselves paid.
6. The creator confirms each payment was actually received.

There's also an **MCP backend** (`/mcp`) exposing all of the above as tools, so
Claude/ChatGPT can drive a tab end to end. See "MCP + plugin" below.

No login, ever. "Identity" is just: the creator holds a secret token (in their
localStorage) that authorizes confirming/editing; participants are remembered
per-tab in their own localStorage.

## Stack

- **Frontend:** React + Vite + Tailwind (`/src`, `index.html` at root)
- **Backend:** Express + better-sqlite3 (`/server`) — one service, also serves
  the built frontend from `/dist` in production
- **OCR:** GPT-5.4-mini via OpenRouter (vision). Model is configurable with
  `OPENROUTER_MODEL` (default `openai/gpt-5.4-mini`). Mini was chosen over
  gpt-5.5 for speed — ~1.2s vs ~4s on a test receipt with identical accuracy.
  Claude vision was intentionally avoided here — too slow for snap-and-go.
- **Hosting:** Railway, auto-deploying from GitHub (`jwaldor/split-dumb`, branch
  `main`). **Push to `main` and Railway builds/deploys automatically** — no
  `railway up` needed. SQLite DB lives at `DATABASE_PATH`, on a Railway volume
  mounted at `/data` so tabs survive redeploys. Env vars + volume live on the
  service and persist across deploys.

## Layout

```
shared/
  calc.js    who-owes-what math — imported by BOTH the browser and the server
  venmo.js   pay-link building (pure, no window/navigator)
server/
  index.js   Express app: REST routes + mounts /mcp + serves /dist in prod
  core.js    every tab mutation + its rules; the single source of truth
  mcp.js     MCP server (Streamable HTTP) — the app as tools
  db.js      SQLite schema, migrations, prepared statements
  ocr.js     OpenRouter vision call → structured receipt JSON
  mcp.smoke.mjs  end-to-end MCP test (`npm run smoke`)
plugin/      Claude Code plugin: .mcp.json + skills/splitdumb/SKILL.md
src/
  pages/     Home, TabView (everything else), PluginInfo (/plugin docs page)
  lib/       calc.js + venmo.js (re-export shared/), image.js (downscale)
  api.js     thin fetch wrapper + localStorage helpers
```

**`server/core.js` holds the rules.** REST routes and MCP tools are both thin
shells over it, so the web UI and a connector can't disagree about things like
"items freeze once someone pays". Add behavior there, not in a route handler.

OCR is **tied to a tab**: `POST /api/tabs/:id/scan` requires the creator token
and is rate-limited (in-memory, per-IP and per-tab) so the paid OpenRouter key
can't be drained. There is no standalone unauthenticated OCR endpoint.

## MCP + plugin

`/mcp` speaks **Streamable HTTP, stateless** (fresh server+transport per
request — most compatible with hosted connectors, and nothing to strand on a
Railway restart). No connector-level auth: the tools inherit the app's own model
where reading a tab is public and host actions need the tab's `creatorToken`.

**OCR is deliberately not an MCP tool.** The client is already a vision model —
it reads the receipt itself and posts structured items via `add_items`. That
keeps the paid OpenRouter key unreachable from connectors and lets the user
check the extracted items before they land on a tab.

`plugin/` is a Claude Code plugin (connector + a skill teaching the workflow);
the repo root is also a plugin marketplace (`.claude-plugin/marketplace.json`).
`/plugin` on the site documents setup for both Claude and ChatGPT.

Test with `npm run smoke` (needs a server running; `MCP_URL=` to point elsewhere).

## Money math (see `shared/calc.js`)

- Each claim is a **fraction** (0..1) of an item's price. Multiple people can
  claim the same item; their fractions should sum to ~1.
- A participant's subtotal = Σ (item price × their fraction).
- Tax + tip + **`fees`** (extra costs: card surcharge, service charge, delivery)
  are split **proportionally** to each person's subtotal share of the receipt
  subtotal. Unclaimed items are eaten by the creator.
- Aggregates (`unclaimedSubtotal`) come from raw shares, not from summing
  rounded per-person subtotals — otherwise an exact 3-way split reports a
  phantom $0.01 unclaimed.

## Dev

```
npm install
cp .env.example .env   # add OPENROUTER_API_KEY
npm run dev            # vite (5173) + express (3001), /api proxied
```

`npm run build && npm start` mirrors production.
