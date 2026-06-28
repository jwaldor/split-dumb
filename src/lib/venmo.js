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

// Open Venmo to pay: try the app first, fall back to the web flow only if the
// app doesn't take over. When the app opens, the page is backgrounded, which
// fires visibilitychange/pagehide — we use that to cancel the web fallback.
export function openVenmoPay({ handle, amount, note }) {
  const app = venmoAppLink({ handle, amount, note })
  const web = venmoPayLink({ handle, amount, note })

  let fired = false
  const fallback = setTimeout(() => {
    if (!fired) window.location.href = web
  }, 1200)

  const cancel = () => {
    fired = true
    clearTimeout(fallback)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', cancel)
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') cancel()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', cancel)

  window.location.href = app
}

export function venmoProfileLink(handle) {
  const h = normalizeVenmo(handle)
  return h ? `https://venmo.com/u/${encodeURIComponent(h)}` : null
}
