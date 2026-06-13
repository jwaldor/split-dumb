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
  ocr: (image) => req('POST', '/api/ocr', { image }),

  createTab: (payload) => req('POST', '/api/tabs', payload),
  getTab: (id) => req('GET', `/api/tabs/${id}`),
  updateExtras: (id, { tax, tip }, creatorToken) =>
    req('PATCH', `/api/tabs/${id}`, { tax, tip }, { 'x-creator-token': creatorToken }),

  addParticipant: (id, payload) => req('POST', `/api/tabs/${id}/participants`, payload),
  setClaim: (id, payload) => req('PUT', `/api/tabs/${id}/claims`, payload),
  setPaid: (id, pid, paid) => req('POST', `/api/tabs/${id}/participants/${pid}/paid`, { paid }),
  confirm: (id, pid, confirmed, creatorToken) =>
    req('POST', `/api/tabs/${id}/participants/${pid}/confirm`, { confirmed }, { 'x-creator-token': creatorToken }),
}

// ---- localStorage helpers --------------------------------------------------

const VENMO_KEY = 'splitdumb:venmo'
export const getMyVenmo = () => localStorage.getItem(VENMO_KEY) || ''
export const setMyVenmo = (v) => localStorage.setItem(VENMO_KEY, String(v).replace(/^@/, '').trim())

export const getCreatorToken = (tabId) => localStorage.getItem(`splitdumb:tab:${tabId}:creator`) || ''
export const setCreatorToken = (tabId, token) =>
  localStorage.setItem(`splitdumb:tab:${tabId}:creator`, token)

export const getMyParticipantId = (tabId) => localStorage.getItem(`splitdumb:tab:${tabId}:me`) || ''
export const setMyParticipantId = (tabId, pid) =>
  localStorage.setItem(`splitdumb:tab:${tabId}:me`, pid)
