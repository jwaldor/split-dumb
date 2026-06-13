// Thin fetch wrapper around the SplitDumb API.

async function req(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  createTab: (creatorVenmo) => req('POST', '/api/tabs', { creatorVenmo }),
  getTab: (id) => req('GET', `/api/tabs/${id}`),
  scan: (id, image, creatorToken) =>
    req('POST', `/api/tabs/${id}/scan`, { image }, { 'x-creator-token': creatorToken }),
  removeItem: (id, itemId, creatorToken) =>
    req('DELETE', `/api/tabs/${id}/items/${itemId}`, null, { 'x-creator-token': creatorToken }),
  updateExtras: (id, { tax, tip }, creatorToken) =>
    req('PATCH', `/api/tabs/${id}`, { tax, tip }, { 'x-creator-token': creatorToken }),

  addParticipant: (id, payload) => req('POST', `/api/tabs/${id}/participants`, payload),
  setClaim: (id, payload) => req('PUT', `/api/tabs/${id}/claims`, payload),
  setPaid: (id, pid, paid) => req('POST', `/api/tabs/${id}/participants/${pid}/paid`, { paid }),
  confirm: (id, pid, confirmed, creatorToken) =>
    req('POST', `/api/tabs/${id}/participants/${pid}/confirm`, { confirmed }, { 'x-creator-token': creatorToken }),
}

// ---- localStorage helpers --------------------------------------------------

import { normalizeVenmo } from './lib/venmo.js'

const VENMO_KEY = 'splitdumb:venmo'
const creatorKey = (tabId) => `splitdumb:tab:${tabId}:creator`
const meKey = (tabId) => `splitdumb:tab:${tabId}:me`

export const getMyVenmo = () => localStorage.getItem(VENMO_KEY) || ''
export const setMyVenmo = (v) => localStorage.setItem(VENMO_KEY, normalizeVenmo(v))

export const getCreatorToken = (tabId) => localStorage.getItem(creatorKey(tabId)) || ''
export const setCreatorToken = (tabId, token) => localStorage.setItem(creatorKey(tabId), token)

export const getMyParticipantId = (tabId) => localStorage.getItem(meKey(tabId)) || ''
export const setMyParticipantId = (tabId, pid) => localStorage.setItem(meKey(tabId), pid)

// Tab ids this device created (i.e. has a creator token stored for).
export function listCreatedTabIds() {
  const ids = []
  for (let i = 0; i < localStorage.length; i++) {
    const m = localStorage.key(i)?.match(/^splitdumb:tab:(.+):creator$/)
    if (m) ids.push(m[1])
  }
  return ids
}
