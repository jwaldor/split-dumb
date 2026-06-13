# SplitDumb

A dead-simple, account-free bill splitter (think Splitwise without the accounts).

## What it does

1. You enter your Venmo handle once — saved to `localStorage`.
2. You snap a photo of a receipt → it's OCR'd into line items + tax/tip.
3. A tab is created with a short shareable URL + QR code.
4. Anyone scans the QR, enters their name, and claims items (fully or partially).
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
- **Hosting:** Railway. SQLite DB lives at `DATABASE_PATH` (point this at a
  Railway volume so tabs survive redeploys).

## Layout

```
server/
  index.js   Express app: API routes + serves /dist in prod
  db.js      SQLite schema + prepared statements
  ocr.js     OpenRouter vision call → structured receipt JSON
src/
  pages/     Home, CreateTab, TabView
  lib/       calc.js (who-owes-what math), venmo.js (pay links)
  api.js     thin fetch wrapper
```

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
