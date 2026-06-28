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

// Is this a phone/tablet (where the Venmo app likely exists and venmo:// works)?
export function isMobile() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true
  // iPadOS 13+ masquerades as a Mac — detect by touch support.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

// Open Venmo to pay. On mobile, go straight to the app deep link with NO web
// fallback — the app is what people want, and a timed fallback fires even when
// the app *did* open (e.g. iOS's "Open in Venmo?" prompt delays the background
// event), bouncing the user to the browser. On desktop there's no app, so open
// the web flow in a new tab.
export function openVenmoPay({ handle, amount, note }) {
  if (isMobile()) {
    window.location.href = venmoAppLink({ handle, amount, note })
  } else {
    window.open(venmoPayLink({ handle, amount, note }), '_blank', 'noopener')
  }
}

export function venmoProfileLink(handle) {
  const h = normalizeVenmo(handle)
  return h ? `https://venmo.com/u/${encodeURIComponent(h)}` : null
}
