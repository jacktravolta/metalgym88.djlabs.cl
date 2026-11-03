// Platform endpoint configuration — the single deploy knob of the djlabs bridge.
//
// window.__API_BASE__ lets a host page point the app at a different platform install;
// everything else derives from it. HEART is fixed per product: every heart-scoped call
// must travel with this slug (?heart= on URLs, heart: in JSON bodies) so sessions, credit
// wallets and the welcome bonus all bind to metalgym88 — never to whichever product the
// shared platform install happens to be routing for.
export const HEART = 'metalgym88'

const DEFAULT_BASE = 'https://api.djlabs.cl'

// Re-read on every call (not cached) so tests — and any host that sets the knob late —
// always see the current value.
export function apiBase() {
  const b = typeof window !== 'undefined' ? window.__API_BASE__ : null
  return String(b || DEFAULT_BASE).replace(/\/+$/, '')
}

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : '/' + path
  return apiBase() + p
}

// Adds the heart slug as a URL parameter, keeping any existing query intact.
export function withHeartQuery(path) {
  const join = path.includes('?') ? '&' : '?'
  return path + join + 'heart=' + encodeURIComponent(HEART)
}

// Adds the heart slug to a JSON body object (never mutates the input).
export function withHeart(body) {
  return Object.assign({}, body, { heart: HEART })
}
