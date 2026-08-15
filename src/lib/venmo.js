// Browser-side Venmo helpers. The link building itself lives in shared/ so the
// server's MCP tools hand out identical pay links.
import { venmoAppLink, venmoPayLink } from '../../shared/venmo.js'

export { normalizeVenmo, venmoPayLink, venmoAppLink, venmoProfileLink } from '../../shared/venmo.js'

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
