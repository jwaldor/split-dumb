// Strip a leading @ and surrounding whitespace from a Venmo handle.
export function normalizeVenmo(v) {
  return String(v || '').replace(/^@/, '').trim()
}

// Build a Venmo "pay" link, prefilled with amount + note.
// On phones with the app installed this opens the app; otherwise the web flow.

export function venmoPayLink({ handle, amount, note }) {
  const h = normalizeVenmo(handle)
  const params = new URLSearchParams({
    txn: 'pay',
    amount: (Number(amount) || 0).toFixed(2),
    note: note || 'SplitDumb',
  })
  if (h) params.set('recipients', h)
  return `https://account.venmo.com/pay?${params.toString()}`
}

export function venmoProfileLink(handle) {
  const h = normalizeVenmo(handle)
  return h ? `https://venmo.com/u/${encodeURIComponent(h)}` : null
}
