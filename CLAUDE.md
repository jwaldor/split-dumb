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
5. Each person sees what they owe (their items + proportional tax/tip), taps a
   prefilled Venmo link to pay, then marks themselves paid.
6. The creator confirms each payment was actually received.

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
server/
  index.js   Express app: API routes + serves /dist in prod
  db.js      SQLite schema + prepared statements
  ocr.js     OpenRouter vision call → structured receipt JSON
src/
  pages/     Home (enter venmo, start/list tabs), TabView (everything else)
  lib/       calc.js (who-owes-what math), venmo.js (pay links + normalize),
             image.js (downscale photo before OCR)
  api.js     thin fetch wrapper + localStorage helpers
```

OCR is **tied to a tab**: `POST /api/tabs/:id/scan` requires the creator token
and is rate-limited (in-memory, per-IP and per-tab) so the paid OpenRouter key
can't be drained. There is no standalone unauthenticated OCR endpoint.

## Money math (see `src/lib/calc.js`)

- Each claim is a **fraction** (0..1) of an item's price. Multiple people can
  claim the same item; their fractions should sum to ~1.
- A participant's subtotal = Σ (item price × their fraction).
- Tax + tip are split **proportionally** to each person's subtotal share of the
  receipt subtotal. Unclaimed items are eaten by the creator.

## Dev

```
npm install
cp .env.example .env   # add OPENROUTER_API_KEY
npm run dev            # vite (5173) + express (3001), /api proxied
```

`npm run build && npm start` mirrors production.
