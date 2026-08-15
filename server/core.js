// Every mutation a tab supports, in one place.
//
// Both the REST routes (`index.js`, used by the web UI) and the MCP tools
// (`mcp.js`, used by Claude/ChatGPT) call into here, so the two front doors
// can't drift apart on rules like "items freeze once someone pays" or "you can
// only claim what's still unclaimed".
//
// Functions throw ApiError(status, message); callers map that onto an HTTP
// status or an MCP error message.

import { nanoid } from 'nanoid'
import { db, q } from './db.js'
import { computeTotals, round } from '../shared/calc.js'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export const normalizeVenmo = (v) => String(v || '').replace(/^@/, '').trim()

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// ---- reads -----------------------------------------------------------------

// The public shape of a tab. The creator token is never included.
export function assembleTab(id) {
  const tab = q.getTab.get(id)
  if (!tab) return null
  const { creator_token, ...safe } = tab
  return {
    ...safe,
    items: q.getItems.all(id),
    participants: q.getParticipants.all(id),
    claims: q.getClaims.all(id),
  }
}

export function requireTab(id) {
  const tab = q.getTab.get(id)
  if (!tab) throw new ApiError(404, `No tab with id "${id}".`)
  return tab
}

// Creator ops need the secret token handed out at creation time.
export function requireCreator(tab, token) {
  if (!token || token !== tab.creator_token) {
    throw new ApiError(403, 'Only the tab creator can do that — pass the tab\'s creatorToken.')
  }
  return tab
}

// Once anyone has marked themselves paid, items are frozen — editing them would
// change what an already-paid person owes.
export function requireItemsUnlocked(tab) {
  if (q.countPaid.get(tab.id).n > 0) {
    throw new ApiError(409, 'Someone already marked themselves paid — items are locked.')
  }
}

export function itemsLocked(tabId) {
  return q.countPaid.get(tabId).n > 0
}

// ---- tabs ------------------------------------------------------------------

export function createTab({ creatorVenmo, merchant, currency, tax, tip, fees }) {
  const handle = normalizeVenmo(creatorVenmo)
  if (!handle) throw new ApiError(400, 'creatorVenmo is required (the host\'s Venmo handle).')

  const id = nanoid(8)
  const creatorToken = nanoid(24)
  q.insertTab.run({
    id,
    creator_token: creatorToken,
    creator_venmo: handle,
    merchant: merchant ? String(merchant).trim() || null : null,
    currency: currency ? String(currency).trim().toUpperCase() : 'USD',
    tax: num(tax),
    tip: num(tip),
    fees: num(fees),
    created_at: Date.now(),
  })
  return { id, creatorToken }
}

// Patch any subset of the tab's own fields. Anything omitted is left alone.
export function updateTab(tab, patch = {}) {
  const has = (k) => patch[k] != null

  if (has('tax') || has('tip') || has('fees')) {
    q.updateTabExtras.run({
      id: tab.id,
      tax: has('tax') ? num(patch.tax) : tab.tax,
      tip: has('tip') ? num(patch.tip) : tab.tip,
      fees: has('fees') ? num(patch.fees) : tab.fees,
    })
  }

  if (has('merchant') || has('currency') || has('creatorVenmo')) {
    const venmo = has('creatorVenmo') ? normalizeVenmo(patch.creatorVenmo) : tab.creator_venmo
    if (!venmo) throw new ApiError(400, 'creatorVenmo cannot be blank.')
    q.setMeta.run({
      id: tab.id,
      merchant: has('merchant') ? String(patch.merchant ?? '').trim() || null : tab.merchant,
      currency: has('currency')
        ? String(patch.currency).trim().toUpperCase() || tab.currency
        : tab.currency,
      creator_venmo: venmo,
    })
  }

  return assembleTab(tab.id)
}

export function deleteTab(tab) {
  q.deleteTab.run(tab.id)
  return { deleted: tab.id }
}

// Set the tip as a percentage of the pre-tax subtotal (what the UI's %
// buttons do).
export function tipFromPercent(tab, percent) {
  const subtotal = q.getItems.all(tab.id).reduce((s, it) => s + (Number(it.price) || 0), 0)
  return round((subtotal * num(percent)) / 100)
}

// ---- items -----------------------------------------------------------------

export function addItems(tab, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Pass a non-empty "items" array.')
  }
  requireItemsUnlocked(tab)

  const startPos = q.countItems.get(tab.id).n
  const created = []
  db.transaction(() => {
    items.forEach((it, i) => {
      const id = nanoid(10)
      const name = String(it?.name ?? '').trim() || 'Item'
      const price = round(num(it?.price))
      const qty = Math.max(1, Math.floor(num(it?.quantity) || 1))
      // A quantity>1 line becomes one row at the line total, matching how the
      // receipt reads — splitting it into N rows would let people claim
      // "one of the three coffees" but complicates the display for no gain.
      q.insertItem.run({ id, tab_id: tab.id, name, price: round(price * qty), position: startPos + i })
      created.push({ id, name, price: round(price * qty) })
    })
  })()
  return created
}

export function updateItem(tab, itemId, { name, price }) {
  requireItemsUnlocked(tab)
  const item = q.getItem.get(itemId, tab.id)
  if (!item) throw new ApiError(404, `No item "${itemId}" on this tab.`)
  q.updateItem.run({
    id: itemId,
    tab_id: tab.id,
    name: name != null ? String(name).trim() || 'Item' : item.name,
    price: price != null ? round(num(price)) : item.price,
  })
  return assembleTab(tab.id)
}

export function removeItem(tab, itemId) {
  requireItemsUnlocked(tab)
  const item = q.getItem.get(itemId, tab.id)
  if (!item) throw new ApiError(404, `No item "${itemId}" on this tab.`)
  q.deleteItem.run(itemId, tab.id) // claims cascade
  return assembleTab(tab.id)
}

// Wipe the item list (and every claim on it) so a badly-entered receipt can be
// re-entered from scratch.
export function clearItems(tab) {
  requireItemsUnlocked(tab)
  q.deleteItems.run(tab.id)
  return assembleTab(tab.id)
}

// ---- participants ----------------------------------------------------------

export function addParticipant(tab, { name, venmo }) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new ApiError(400, 'Participant name is required.')
  const id = nanoid(10)
  q.insertParticipant.run({
    id,
    tab_id: tab.id,
    name: clean,
    venmo: venmo ? normalizeVenmo(venmo) || null : null,
    created_at: Date.now(),
  })
  return { id, name: clean }
}

export function updateParticipant(tab, participantId, { name, venmo }) {
  const p = resolveParticipant(tab, participantId)
  q.updateParticipant.run({
    id: p.id,
    tab_id: tab.id,
    name: name != null ? String(name).trim() || p.name : p.name,
    venmo: venmo !== undefined ? (venmo ? normalizeVenmo(venmo) || null : null) : p.venmo,
  })
  return assembleTab(tab.id)
}

export function removeParticipant(tab, participantId) {
  const p = resolveParticipant(tab, participantId)
  q.deleteParticipant.run(p.id, tab.id) // claims cascade
  return assembleTab(tab.id)
}

// Accept either a participant id or their (case-insensitive) name, so an MCP
// client can say "Priya" without first looking up an id.
export function resolveParticipant(tab, idOrName) {
  const key = String(idOrName ?? '').trim()
  if (!key) throw new ApiError(400, 'A participant id or name is required.')
  const byId = q.getParticipant.get(key, tab.id)
  if (byId) return byId
  const byName = q.findParticipantByName.get(tab.id, key)
  if (byName) return byName
  throw new ApiError(404, `No participant "${key}" on this tab.`)
}

export function setPaid(tab, participantId, paid) {
  const p = resolveParticipant(tab, participantId)
  q.setPaid.run({ id: p.id, tab_id: tab.id, paid: paid ? 1 : 0 })
  return assembleTab(tab.id)
}

export function setConfirmed(tab, participantId, confirmed) {
  const p = resolveParticipant(tab, participantId)
  q.setConfirmed.run({ id: p.id, tab_id: tab.id, confirmed: confirmed ? 1 : 0 })
  return assembleTab(tab.id)
}

// ---- claims ----------------------------------------------------------------

// Upsert a fractional claim. share <= 0 removes it. The share is clamped to
// what's still unclaimed so total coverage can never exceed 100%.
export function setClaim(tab, { participantId, itemId, share }) {
  const p = resolveParticipant(tab, participantId)
  const item = q.getItem.get(itemId, tab.id)
  if (!item) throw new ApiError(404, `No item "${itemId}" on this tab.`)

  const s = Number(share)
  if (!Number.isFinite(s)) throw new ApiError(400, 'share must be a number between 0 and 1.')

  if (s <= 0) {
    q.deleteClaim.run(item.id, p.id)
    return { participantId: p.id, itemId: item.id, share: 0 }
  }

  const others = q.sumOtherShares.get(item.id, p.id).s
  const available = Math.max(0, 1 - others)
  const finalShare = Math.min(s, available)
  if (finalShare <= 0) {
    q.deleteClaim.run(item.id, p.id)
    throw new ApiError(409, `"${item.name}" is already fully claimed by someone else.`)
  }
  q.upsertClaim.run({
    id: nanoid(10),
    tab_id: tab.id,
    item_id: item.id,
    participant_id: p.id,
    share: finalShare,
  })
  return { participantId: p.id, itemId: item.id, share: finalShare, clamped: finalShare < s }
}

// Give one participant a set of whole items in a single call — the common
// "Sam had the burger and the beer" case.
export function assignItems(tab, participantId, itemIds, share = 1) {
  const p = resolveParticipant(tab, participantId)
  const results = []
  for (const itemId of itemIds) {
    try {
      results.push(setClaim(tab, { participantId: p.id, itemId, share }))
    } catch (err) {
      if (err instanceof ApiError) results.push({ itemId, error: err.message })
      else throw err
    }
  }
  return results
}

// Split every item evenly across the given participants (or everyone on the
// tab). Replaces existing claims so the result is exactly an even split.
export function splitEvenly(tab, participantIds) {
  const people = participantIds?.length
    ? participantIds.map((p) => resolveParticipant(tab, p))
    : q.getParticipants.all(tab.id)
  if (people.length === 0) throw new ApiError(400, 'No participants to split between.')

  const items = q.getItems.all(tab.id)
  if (items.length === 0) throw new ApiError(400, 'This tab has no items yet.')

  const share = 1 / people.length
  db.transaction(() => {
    for (const item of items) {
      for (const c of q.getClaims.all(tab.id)) {
        if (c.item_id === item.id) q.deleteClaim.run(item.id, c.participant_id)
      }
      for (const p of people) {
        q.upsertClaim.run({
          id: nanoid(10),
          tab_id: tab.id,
          item_id: item.id,
          participant_id: p.id,
          share,
        })
      }
    }
  })()
  return assembleTab(tab.id)
}

// ---- summary ---------------------------------------------------------------

// A tab rendered for a language model: ids kept (it needs them to make further
// calls) but totals pre-computed so it never has to do the math itself.
export function summarize(tabId, { baseUrl } = {}) {
  const tab = assembleTab(tabId)
  if (!tab) throw new ApiError(404, `No tab with id "${tabId}".`)
  const calc = computeTotals(tab)
  const nameById = Object.fromEntries(tab.participants.map((p) => [p.id, p.name]))

  return {
    id: tab.id,
    url: baseUrl ? `${baseUrl}/t/${tab.id}` : undefined,
    merchant: tab.merchant,
    currency: tab.currency,
    payTo: `@${tab.creator_venmo}`,
    itemsLocked: itemsLocked(tab.id),
    tax: calc.tax,
    tip: calc.tip,
    extraCosts: calc.fees,
    subtotal: calc.receiptSubtotal,
    total: calc.receiptTotal,
    unclaimedSubtotal: calc.unclaimedSubtotal,
    items: tab.items.map((it) => ({
      id: it.id,
      name: it.name,
      price: it.price,
      claimedFraction: round(calc.coverage[it.id] || 0),
      claimedBy: tab.claims
        .filter((c) => c.item_id === it.id)
        .map((c) => ({ name: nameById[c.participant_id], share: round(c.share) })),
    })),
    people: calc.perParticipant.map((p) => ({
      id: p.id,
      name: p.name,
      itemsSubtotal: p.subtotal,
      shareOfExtras: p.extras,
      owes: p.total,
      saysPaid: !!p.paid,
      hostConfirmed: !!p.confirmed,
    })),
  }
}
