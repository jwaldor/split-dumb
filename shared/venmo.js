// Venmo link building. Pure — no `window`/`navigator` — so the server (and its
// MCP tools) can hand out the same prefilled pay links the UI does.

// Strip a leading @ and surrounding whitespace from a Venmo handle.
export function normalizeVenmo(v) {
  return String(v || '').replace(/^@/, '').trim()
}

function payParams({ amount, note }) {
  return new URLSearchParams({
    txn: 'pay',
    amount: (Number(amount) || 0).toFixed(2),
    note: note || 'SplitDumb',
  })
}

// Web "pay" link — works everywhere, but on mobile it opens in the browser.
export function venmoPayLink({ handle, amount, note }) {
  const h = normalizeVenmo(handle)
  const params = payParams({ amount, note })
  if (h) params.set('recipients', h)
  return `https://account.venmo.com/pay?${params.toString()}`
}

// App deep link — opens the Venmo app directly (prefilled) if it's installed.
export function venmoAppLink({ handle, amount, note }) {
  const h = normalizeVenmo(handle)
  const params = payParams({ amount, note })
  if (h) params.set('recipients', h)
  return `venmo://paycharge?${params.toString()}`
}

export function venmoProfileLink(handle) {
  const h = normalizeVenmo(handle)
  return h ? `https://venmo.com/u/${encodeURIComponent(h)}` : null
}
