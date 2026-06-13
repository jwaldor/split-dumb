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

// ---- OCR -------------------------------------------------------------------

app.post('/api/ocr', asyncH(async (req, res) => {
  const { image } = req.body || {}
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Send an "image" data URL (data:image/...;base64,...).' })
  }
  const result = await readReceipt(image)
  res.json(result)
}))

// ---- tabs ------------------------------------------------------------------

app.post('/api/tabs', asyncH((req, res) => {
  const { creatorVenmo, merchant, currency, items, tax, tip } = req.body || {}
  if (!creatorVenmo || typeof creatorVenmo !== 'string') {
    return res.status(400).json({ error: 'creatorVenmo is required.' })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required.' })
  }

  const id = nanoid(8)
  const creatorToken = nanoid(24)
  const now = Date.now()

  const create = db.transaction(() => {
    q.insertTab.run({
      id,
      creator_token: creatorToken,
      creator_venmo: creatorVenmo.replace(/^@/, '').trim(),
      merchant: merchant ? String(merchant) : null,
      currency: currency ? String(currency) : 'USD',
      tax: Number(tax) || 0,
      tip: Number(tip) || 0,
      created_at: now,
    })
    items.forEach((it, i) => {
      q.insertItem.run({
        id: nanoid(10),
        tab_id: id,
        name: String(it?.name ?? '').trim() || 'Item',
        price: Number(it?.price) || 0,
        position: i,
      })
    })
  })
  create()

  res.json({ id, creatorToken })
}))

app.get('/api/tabs/:id', asyncH((req, res) => {
  const tab = assembleTab(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  res.json(tab)
}))

// Creator edits tax/tip (e.g. adding a tip the receipt photo didn't show).
app.patch('/api/tabs/:id', asyncH((req, res) => {
  const tab = q.getTab.get(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  if (!requireCreator(req, res, tab)) return
  const tax = req.body?.tax != null ? Number(req.body.tax) || 0 : tab.tax
  const tip = req.body?.tip != null ? Number(req.body.tip) || 0 : tab.tip
  q.updateTabExtras.run({ id: tab.id, tax, tip })
  res.json(assembleTab(tab.id))
}))

// ---- participants ----------------------------------------------------------

app.post('/api/tabs/:id/participants', asyncH((req, res) => {
  const tab = q.getTab.get(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  const { name, venmo } = req.body || {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' })
  const id = nanoid(10)
  q.insertParticipant.run({
    id,
    tab_id: tab.id,
    name: String(name).trim(),
    venmo: venmo ? String(venmo).replace(/^@/, '').trim() : null,
    created_at: Date.now(),
  })
  res.json({ id })
}))

// Participant marks themselves paid / un-paid.
app.post('/api/tabs/:id/participants/:pid/paid', asyncH((req, res) => {
  const tab = q.getTab.get(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  const participant = q.getParticipant.get(req.params.pid, tab.id)
  if (!participant) return res.status(404).json({ error: 'Participant not found.' })
  const paid = req.body?.paid ? 1 : 0
  q.setPaid.run({ id: participant.id, tab_id: tab.id, paid })
  res.json({ ok: true, paid })
}))

// Creator confirms a payment actually landed.
app.post('/api/tabs/:id/participants/:pid/confirm', asyncH((req, res) => {
  const tab = q.getTab.get(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
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
  const tab = q.getTab.get(req.params.id)
  if (!tab) return res.status(404).json({ error: 'Tab not found.' })
  const { participantId, itemId, share } = req.body || {}
  const participant = q.getParticipant.get(participantId, tab.id)
  if (!participant) return res.status(400).json({ error: 'Unknown participant.' })
  const s = Number(share)
  if (!Number.isFinite(s)) return res.status(400).json({ error: 'share must be a number.' })

  if (s <= 0) {
    q.deleteClaim.run(itemId, participantId)
  } else {
    q.upsertClaim.run({
      id: nanoid(10),
      tab_id: tab.id,
      item_id: itemId,
      participant_id: participantId,
      share: Math.min(s, 1),
    })
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
