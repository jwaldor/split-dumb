# SplitDumb

Dead-simple, account-free bill splitting. Snap a receipt, share a QR, everyone
claims their items (fully or partially) and Venmos the host.

## How it works

1. Open the site, type your **Venmo handle** (saved to this device's localStorage).
2. **Start a tab** — you get a short URL + QR code.
3. **Add a receipt** — take a photo *or upload a file* — GPT-5.4-mini (via
   OpenRouter) reads it into line items + tax/tip. One receipt per tab; if the
   photo's no good it tells you why so you can retry. Then use **Edit / add
   items** to fix OCR mistakes or add anything by hand.
4. Add a **tip** if the receipt didn't include one — it's split proportionally.
5. Anyone scans the QR, enters their name, and **claims items** — quick fractions
   (¼, ⅓, ½, Rest) or any custom %, capped at what's still unclaimed. Tax & tip
   are split by what each person ordered.
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

The Railway service is connected to this GitHub repo, so **pushing to `main`
auto-deploys** — no manual step. Railway uses `railway.json` (`npm run build` →
`npm start`).

First-time setup (already done for the live service):
- Connect the service to the repo (Settings → Source), branch `main`.
- Set env vars: `OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL`,
  `PUBLIC_BASE_URL`, and `NIXPACKS_NODE_VERSION=22` (native `better-sqlite3`
  needs Node 22).
- Add a **Volume** mounted at `/data` and set `DATABASE_PATH=/data/splitdumb.db`
  so tabs survive redeploys.

## Stack

React + Vite + Tailwind · Express + better-sqlite3 · OpenRouter vision OCR.
See `CLAUDE.md` for architecture notes and the money math.
