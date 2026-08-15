import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { db, q } from './db.js'
import { nanoid } from 'nanoid'
import { readReceipt } from './ocr.js'
import { mountMcp } from './mcp.js'
import * as core from './core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', true) // Railway runs behind a proxy; needed for real req.ip
app.use(express.json({ limit: '20mb' }))

const PORT = process.env.PORT || 3001

// ---- helpers ---------------------------------------------------------------

// Business rules live in core.js so the REST API and the MCP tools behave
// identically; these routes are a thin HTTP shell over it.

// Run a handler, turning core's ApiError into the matching HTTP status.
const route = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    if (err instanceof core.ApiError) return res.status(err.status).json({ error: err.message })
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
  })
}

// Load the tab named in the route, or 404.
const tabOf = (req) => core.requireTab(req.params.id)

// Load the tab and check the caller holds its creator token.
const creatorTabOf = (req) => core.requireCreator(tabOf(req), req.get('x-creator-token'))

// ---- rate limiting (in-memory) --------------------------------------------
// Protects the paid OCR endpoint from abuse. In-memory is fine for a single
// Railway instance; it resets on redeploy and isn't shared across replicas.

const SCAN_LIMITS = [
  { by: (req) => `ip:${req.ip}`, max: 40, windowMs: 15 * 60 * 1000 }, // per device
  { by: (req) => `tab:${req.params.id}`, max: 25, windowMs: 15 * 60 * 1000 }, // per tab
]
const hits = new Map()

function rateLimit(key, max, windowMs) {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) return false
  recent.push(now)
  hits.set(key, recent)
  return true
}

function scanRateLimit(req, res, next) {
  for (const { by, max, windowMs } of SCAN_LIMITS) {
    if (!rateLimit(by(req), max, windowMs)) {
      return res.status(429).json({ error: 'Too many scans — give it a minute and try again.' })
    }
  }
  next()
}

// ---- tabs ------------------------------------------------------------------

// Create an empty tab. The web UI never sends items here — they come from
// scanning a receipt. (MCP clients seed items at creation instead; see mcp.js.)
app.post('/api/tabs', route((req, res) => {
  const { id, creatorToken } = core.createTab({ creatorVenmo: req.body?.creatorVenmo })
  res.json({ id, creatorToken })
}))

app.get('/api/tabs/:id', route((req, res) => {
  res.json(core.assembleTab(tabOf(req).id))
}))

// Scan a receipt INTO this tab. Creator-only + rate-limited. The OCR'd items
// are appended, and any tax/tip the receipt lists is added to the tab's totals.
//
// This is the web UI's path only. It is deliberately NOT exposed over MCP —
// an MCP client is a vision model itself and should read the photo directly,
// which keeps the paid OpenRouter key unreachable from connectors.
app.post('/api/tabs/:id/scan', scanRateLimit, route(async (req, res) => {
  const tab = creatorTabOf(req)

  const { image } = req.body || {}
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Send an "image" data URL (data:image/...;base64,...).' })
  }
  // One receipt per tab — once items exist, refine them by hand instead.
  if (q.countItems.get(tab.id).n > 0) {
    return res.status(409).json({ error: 'This tab already has a receipt. Edit the items instead.' })
  }

  const result = await readReceipt(image)

  const startPos = q.countItems.get(tab.id).n
  db.transaction(() => {
    result.items.forEach((it, i) => {
      q.insertItem.run({
        id: nanoid(10),
        tab_id: tab.id,
        name: it.name,
        price: it.price,
        position: startPos + i,
      })
    })
    q.updateTabExtras.run({
      id: tab.id,
      tax: (Number(tab.tax) || 0) + (Number(result.tax) || 0),
      tip: (Number(tab.tip) || 0) + (Number(result.tip) || 0),
      fees: Number(tab.fees) || 0,
    })
    // Fill in merchant/currency from the first scan that has them.
    q.setMeta.run({
      id: tab.id,
      merchant: tab.merchant || result.merchant || null,
      currency: tab.merchant ? tab.currency : result.currency || tab.currency || 'USD',
      creator_venmo: tab.creator_venmo,
    })
  })()

  res.json({ ok: result.ok, issue: result.issue, tab: core.assembleTab(tab.id) })
}))

// Creator edits tax / tip / extra costs (card fees, service charge, delivery).
app.patch('/api/tabs/:id', route((req, res) => {
  res.json(core.updateTab(creatorTabOf(req), req.body || {}))
}))

// Creator adds an item by hand (to fix what the scan missed).
app.post('/api/tabs/:id/items', route((req, res) => {
  const tab = creatorTabOf(req)
  core.addItems(tab, [{ name: req.body?.name, price: req.body?.price }])
  res.json(core.assembleTab(tab.id))
}))

// Creator edits an item's name/price (to fix an OCR mistake).
app.patch('/api/tabs/:id/items/:itemId', route((req, res) => {
  res.json(core.updateItem(creatorTabOf(req), req.params.itemId, req.body || {}))
}))

// Creator removes a (mis-scanned) item. Claims on it cascade-delete via FK.
app.delete('/api/tabs/:id/items/:itemId', route((req, res) => {
  res.json(core.removeItem(creatorTabOf(req), req.params.itemId))
}))

// ---- participants ----------------------------------------------------------

app.post('/api/tabs/:id/participants', route((req, res) => {
  const { id } = core.addParticipant(tabOf(req), req.body || {})
  res.json({ id })
}))

// Participant marks themselves paid / un-paid.
app.post('/api/tabs/:id/participants/:pid/paid', route((req, res) => {
  core.setPaid(tabOf(req), req.params.pid, !!req.body?.paid)
  res.json({ ok: true, paid: req.body?.paid ? 1 : 0 })
}))

// Creator confirms a payment actually landed.
app.post('/api/tabs/:id/participants/:pid/confirm', route((req, res) => {
  core.setConfirmed(creatorTabOf(req), req.params.pid, !!req.body?.confirmed)
  res.json({ ok: true, confirmed: req.body?.confirmed ? 1 : 0 })
}))

// ---- claims ----------------------------------------------------------------

// Upsert a participant's fractional claim on an item. share <= 0 removes it.
// You can only claim the portion of an item that's still unclaimed, so total
// coverage can never exceed 100% (no double-billing).
app.put('/api/tabs/:id/claims', route((req, res) => {
  const tab = tabOf(req)
  const { participantId, itemId, share } = req.body || {}
  try {
    core.setClaim(tab, { participantId, itemId, share })
  } catch (err) {
    // "Already fully claimed" is a no-op from the UI's point of view — it just
    // re-renders with the current coverage.
    if (!(err instanceof core.ApiError && err.status === 409)) throw err
  }
  res.json(core.assembleTab(tab.id))
}))

// ---- MCP -------------------------------------------------------------------

// The whole app as tools, for Claude / ChatGPT / any MCP client.
mountMcp(app, '/mcp')

// ---- static frontend (production) -----------------------------------------

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' })
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`SplitDumb server listening on :${PORT}`)
  console.log(`MCP endpoint at :${PORT}/mcp`)
})
