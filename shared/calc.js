// Who-owes-what math for a tab. Shared by the browser (`src/lib/calc.js`) and
// the server (REST responses + the MCP tools), so both agree to the cent.
//
// Each claim is a fraction (0..1) of an item's price. A participant's subtotal
// is the sum of (item price × their fraction). Tax, tip and extra costs (card
// fees, service charges, delivery…) are split proportionally to each
// participant's share of the *receipt* subtotal, so unclaimed items are
// effectively eaten by the creator.

export function computeTotals(tab) {
  const items = tab.items || []
  const participants = tab.participants || []
  const claims = tab.claims || []
  const tax = Number(tab.tax) || 0
  const tip = Number(tab.tip) || 0
  const fees = Number(tab.fees) || 0
  const extras = tax + tip + fees

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

  // Aggregate from the raw (unrounded) shares, not from each person's rounded
  // subtotal — otherwise an exact 3-way split reports a phantom $0.01 unclaimed
  // and the UI shows a warning about a tab that's fully covered.
  const rawClaimed = items.reduce(
    (s, it) => s + Math.min(1, coverage[it.id] || 0) * (Number(it.price) || 0),
    0,
  )
  const claimedSubtotal = rawClaimed
  const unclaimedSubtotal = round(receiptSubtotal - rawClaimed)
  const receiptTotal = round(receiptSubtotal + extras)
  const assignedTotal =
    rawClaimed + (receiptSubtotal > 0 ? (rawClaimed / receiptSubtotal) * extras : 0)

  return {
    perParticipant,
    coverage, // itemId -> fraction claimed
    receiptSubtotal: round(receiptSubtotal),
    receiptTotal,
    tax: round(tax),
    tip: round(tip),
    fees: round(fees),
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
