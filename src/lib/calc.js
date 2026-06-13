// Who-owes-what math for a tab.
//
// Each claim is a fraction (0..1) of an item's price. A participant's subtotal
// is the sum of (item price × their fraction). Tax + tip are split
// proportionally to each participant's share of the *receipt* subtotal, so
// unclaimed items are effectively eaten by the creator.

export function computeTotals(tab) {
  const items = tab.items || []
  const participants = tab.participants || []
  const claims = tab.claims || []
  const tax = Number(tab.tax) || 0
  const tip = Number(tab.tip) || 0
  const extras = tax + tip

  const priceOf = {}
  for (const it of items) priceOf[it.id] = Number(it.price) || 0
  const receiptSubtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0)

  // coverage per item (sum of all fractions claimed on it)
  const coverage = {}
  // subtotal per participant
  const subtotal = {}
  for (const p of participants) subtotal[p.id] = 0

  for (const c of claims) {
    const share = Number(c.share) || 0
    coverage[c.item_id] = (coverage[c.item_id] || 0) + share
    if (subtotal[c.participant_id] != null) {
      subtotal[c.participant_id] += share * (priceOf[c.item_id] || 0)
    }
  }

  const perParticipant = participants.map((p) => {
    const sub = subtotal[p.id] || 0
    const extrasShare = receiptSubtotal > 0 ? (sub / receiptSubtotal) * extras : 0
    return {
      ...p,
      subtotal: round(sub),
      extras: round(extrasShare),
      total: round(sub + extrasShare),
    }
  })

  const claimedSubtotal = perParticipant.reduce((s, p) => s + p.subtotal, 0)
  const unclaimedSubtotal = round(receiptSubtotal - claimedSubtotal)
  const receiptTotal = round(receiptSubtotal + extras)
  const assignedTotal = perParticipant.reduce((s, p) => s + p.total, 0)

  return {
    perParticipant,
    coverage, // itemId -> fraction claimed
    receiptSubtotal: round(receiptSubtotal),
    receiptTotal,
    extras: round(extras),
    claimedSubtotal: round(claimedSubtotal),
    unclaimedSubtotal,
    unassignedTotal: round(receiptTotal - assignedTotal),
  }
}

export function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function money(n, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n) || 0)
  } catch {
    return `$${round(n).toFixed(2)}`
  }
}
