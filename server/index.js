import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { nanoid } from 'nanoid'
import { db, q } from './db.js'
import { readReceipt } from './ocr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', true) // Railway runs behind a proxy; needed for real req.ip
app.use(express.json({ limit: '20mb' }))

const PORT = process.env.PORT || 3001

// ---- helpers ---------------------------------------------------------------

function assembleTab(id) {
  const tab = q.getTab.get(id)
  if (!tab) return null
  const { creator_token, ...safe } = tab // never leak the creator token
  return {
    ...safe,
    items: q.getItems.all(id),
    participants: q.getParticipants.all(id),
    claims: q.getClaims.all(id),
  }
}

// Look up the tab named in the route; send a 404 and return null if missing.
function loadTab(req, res) {
  const tab = q.getTab.get(req.params.id)
  if (!tab) {
    res.status(404).json({ error: 'Tab not found.' })
    return null
  }
  return tab
}

const normalizeVenmo = (v) => String(v || '').replace(/^@/, '').trim()

function requireCreator(req, res, tab) {
  const token = req.get('x-creator-token')
  if (!token || token !== tab.creator_token) {
    res.status(403).json({ error: 'Only the tab creator can do that.' })
    return false
  }
  return true
}

const asyncH = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Server error' })
})

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

// Create an empty tab. Items are NOT accepted here — they can only come from
// scanning a receipt (POST /api/tabs/:id/scan).
app.post('/api/tabs', asyncH((req, res) => {
  const { creatorVenmo } = req.body || {}
  if (!creatorVenmo || typeof creatorVenmo !== 'string') {
    return res.status(400).json({ error: 'creatorVenmo is required.' })
  }
  const handle = normalizeVenmo(creatorVenmo)
  if (!handle) {
    return res.status(400).json({ error: 'Enter a valid Venmo handle.' })
  }
  const id = nanoid(8)
  const creatorToken = nanoid(24)
  q.insertTab.run({
    id,
    creator_token: creatorToken,
    creator_venmo: handle,
    merchant: null,
    currency: 'USD',
    tax: 0,
    tip: 0,
    created_at: Date.now(),
  })
  res.json({ id, creatorToken })
}))

app.get('/api/tabs/:id', asyncH((req, res) => {
  const tab = assembleTab(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  res.json(tab)
}))

// Scan a receipt INTO this tab. Creator-only + rate-limited. The OCR'd items
// are appended, and any tax/tip the receipt lists is added to the tab's totals.
app.post('/api/tabs/:id/scan', scanRateLimit, asyncH(async (req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  if (!requireCreator(req, res, tab)) return

  const { image } = req.body || {}
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Send an "image" data URL (data:image/...;base64,...).' })
  }

  const result = await readReceipt(image)

  const startPos = q.countItems.get(tab.id).n
  const apply = db.transaction(() => {
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
    })
    // Fill in merchant/currency from the first scan that has them.
    q.setMeta.run({
      id: tab.id,
      merchant: tab.merchant || result.merchant || null,
      currency: tab.merchant ? tab.currency : result.currency || tab.currency || 'USD',
    })
  })
  apply()

  res.json({ ok: result.ok, issue: result.issue, tab: assembleTab(tab.id) })
}))

// Creator edits tax/tip (e.g. adding a tip the receipt photo didn't show).
app.patch('/api/tabs/:id', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  if (!requireCreator(req, res, tab)) return
  const tax = req.body?.tax != null ? Number(req.body.tax) || 0 : tab.tax
  const tip = req.body?.tip != null ? Number(req.body.tip) || 0 : tab.tip
  q.updateTabExtras.run({ id: tab.id, tax, tip })
  res.json(assembleTab(tab.id))
}))

// Creator removes a (mis-scanned) item. Claims on it cascade-delete via FK.
app.delete('/api/tabs/:id/items/:itemId', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  if (!requireCreator(req, res, tab)) return
  q.deleteItem.run(req.params.itemId, tab.id)
  res.json(assembleTab(tab.id))
}))

// ---- participants ----------------------------------------------------------

app.post('/api/tabs/:id/participants', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  const { name, venmo } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' })
  const id = nanoid(10)
  q.insertParticipant.run({
    id,
    tab_id: tab.id,
    name: String(name).trim(),
    venmo: venmo ? normalizeVenmo(venmo) || null : null,
    created_at: Date.now(),
  })
  res.json({ id })
}))

// Participant marks themselves paid / un-paid.
app.post('/api/tabs/:id/participants/:pid/paid', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  const participant = q.getParticipant.get(req.params.pid, tab.id)
  if (!participant) return res.status(404).json({ error: 'Participant not found.' })
  const paid = req.body?.paid ? 1 : 0
  q.setPaid.run({ id: participant.id, tab_id: tab.id, paid })
  res.json({ ok: true, paid })
}))

// Creator confirms a payment actually landed.
app.post('/api/tabs/:id/participants/:pid/confirm', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  if (!requireCreator(req, res, tab)) return
  const participant = q.getParticipant.get(req.params.pid, tab.id)
  if (!participant) return res.status(404).json({ error: 'Participant not found.' })
  const confirmed = req.body?.confirmed ? 1 : 0
  q.setConfirmed.run({ id: participant.id, tab_id: tab.id, confirmed })
  res.json({ ok: true, confirmed })
}))

// ---- claims ----------------------------------------------------------------

// Upsert a participant's fractional claim on an item. share <= 0 removes it.
app.put('/api/tabs/:id/claims', asyncH((req, res) => {
  const tab = loadTab(req, res)
  if (!tab) return
  const { participantId, itemId, share } = req.body || {}
  const participant = q.getParticipant.get(participantId, tab.id)
  if (!participant) return res.status(400).json({ error: 'Unknown participant.' })
  const s = Number(share)
  if (!Number.isFinite(s)) return res.status(400).json({ error: 'share must be a number.' })

  if (s <= 0) {
    q.deleteClaim.run(itemId, participantId)
  } else {
    // You can only claim the portion of an item that's still unclaimed, so
    // total coverage can never exceed 100% (no double-billing).
    const others = q.sumOtherShares.get(itemId, participantId).s
    const available = Math.max(0, 1 - others)
    const finalShare = Math.min(s, available)
    if (finalShare <= 0) {
      q.deleteClaim.run(itemId, participantId)
    } else {
      q.upsertClaim.run({
        id: nanoid(10),
        tab_id: tab.id,
        item_id: itemId,
        participant_id: participantId,
        share: finalShare,
      })
    }
  }
  res.json(assembleTab(tab.id))
}))

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
})
