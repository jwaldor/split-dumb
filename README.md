# SplitDumb

Dead-simple, account-free bill splitting. Snap a receipt, share a QR, everyone
claims their items (fully or partially) and Venmos the host.

## How it works

1. Open the site, type your **Venmo handle** (saved to this device's localStorage).
2. **Scan a receipt** — GPT-5.4-mini (via OpenRouter) reads it into line items +
   tax/tip. If the photo's no good, it tells you why. You can also add items by hand.
3. Add a **tip** if the receipt didn't include one — it's split proportionally.
4. You get a **tab with a short URL + QR code**.
5. Anyone scans, enters their name, and **claims items** — quick fractions (¼, ⅓,
   ½, All) or any custom %. Tax & tip are split by what each person ordered.
6. Each person taps a **prefilled Venmo link** to pay the host, then marks paid.
7. The **host confirms** each payment actually landed.

No accounts. The host holds a secret token (in their browser) that lets them
confirm payments and edit tax/tip.

## Run locally

```bash
npm install
cp .env.example .env        # add your OPENROUTER_API_KEY
npm run dev                 # client on :5173, API on :3001 (proxied)
```

Open http://localhost:5173.

Production-style run:

```bash
npm run build && npm start  # serves the built app + API on :3001
```

## Deploy on Railway

- Create a service from this repo. Railway uses `railway.json`
  (`npm run build` → `npm start`).
- Set env vars: `OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL`,
  `PUBLIC_BASE_URL`.
- Add a **Volume** and set `DATABASE_PATH` to a path on it (e.g.
  `/data/splitdumb.db`) so tabs survive redeploys.

## Stack

React + Vite + Tailwind · Express + better-sqlite3 · OpenRouter vision OCR.
See `CLAUDE.md` for architecture notes and the money math.
