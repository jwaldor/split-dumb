// Build a Venmo "pay" link, prefilled with amount + note.
// On phones with the app installed this opens the app; otherwise the web flow.

export function venmoPayLink({ handle, amount, note }) {
  const h = String(handle || '').replace(/^@/, '').trim()
  const params = new URLSearchParams({
    txn: 'pay',
    amount: (Number(amount) || 0).toFixed(2),
    note: note || 'SplitDumb',
  })
  if (h) params.set('recipients', h)
  return `https://account.venmo.com/pay?${params.toString()}`
}

export function venmoProfileLink(handle) {
  const h = String(handle || '').replace(/^@/, '').trim()
  return h ? `https://venmo.com/u/${encodeURIComponent(h)}` : null
}
