// Landing for the email sign-in link (magic link).
//
// The platform sends the person to <front>/auth/verify?token=…&heart=… . This
// front is a hash-router SPA, so that path is not a route of the app: the boot
// reads the token off the URL (readLanding), redeems it through the platform's
// JSON contract (GET /auth/verify with Accept: application/json — the browser
// redirect is NOT used, it only moves the token to this front) and then wipes
// the URL, so the token never stays in the address bar nor in the history.
//
// The token is single-use: the platform answers 200 once and an error every
// time after. Nothing here retries on its own — the landing offers the retry.
import { platformCall, adopt } from './auth.js'
import { withHeartQuery, HEART } from './config.js'
import { appRootPath } from './app-root.js'

// The only path that carries a sign-in token. The platform appends it to the
// front origin, so the front must recognise it and nothing else.
const LANDING_PATH = '/auth/verify'

// One query parameter, matched case-insensitively (the platform writes
// ?token=…, but a link forwarded through a mail client may arrive as ?Token=…).
function queryParam(search, name) {
  const wanted = name.toLowerCase()
  try {
    for (const [k, v] of new URLSearchParams(search || '')) {
      if (k.toLowerCase() === wanted) {
        const value = String(v).trim()
        if (value) return value
      }
    }
  } catch { /* a broken query is simply a missing token */ }
  return null
}

// The landing behind the current URL, or null when this is not one.
// `location` is a Location-like object ({ pathname, search }) — a URL string is
// accepted too, so the check stays pure and testable.
export function readLanding(location) {
  if (!location) return null
  let pathname = ''
  let search = ''
  if (typeof location === 'string') {
    try {
      const url = new URL(location, 'http://localhost')
      pathname = url.pathname
      search = url.search
    } catch { return null }
  } else {
    pathname = String(location.pathname || '')
    search = String(location.search || '')
  }
  // A location-like object may carry the fragment inside the query string: the
  // token must not swallow it.
  search = search.split('#')[0]
  // Only the verify path counts — and the trailing slash / the case of the
  // path are tolerated.
  const path = pathname.replace(/\/+$/, '').toLowerCase()
  if (!path.endsWith(LANDING_PATH)) return null
  const token = queryParam(search, 'token')
  if (!token) return null
  // The heart travels with the link; without one the link belongs to this
  // product.
  const heart = queryParam(search, 'heart') || HEART
  // The platform marks a re-verification notice with kind=reverify: that token
  // opens the welcome-bonus gate, it does not sign anybody in. Without the
  // marker the link is the sign-in one.
  const kind = String(queryParam(search, 'kind') || '').toLowerCase() === 'reverify'
    ? 'reverify'
    : 'magic-link'
  return { kind, token, heart }
}

// Redeems the token: the platform verifies it, leaves the session cookies
// (httpOnly) and answers with the access token, the refresh token and the user.
// The access token is adopted exactly like a password sign-in does, so the app's
// boot finds the session right after.
//
// The HTTP call is injectable (`deps.request`) so the test never depends on the
// network.
export async function consumeMagicLink(token, deps = {}) {
  if (!token) throw new Error('magic-link token missing')
  const request = deps.request || ((path, opts) => platformCall(path, opts))
  const data = await request(
    withHeartQuery('/auth/verify?token=' + encodeURIComponent(token)),
    { headers: { Accept: 'application/json' } }
  )
  return adopt(data)
}

// Confirms the email again for an account the platform paused (the welcome-
// bonus threshold: the account must prove the address is still its own before
// it can spend more). The token comes from the notice the platform mailed.
// This only opens the gate — the session stays exactly as it is.
export async function confirmReverification(token, deps = {}) {
  if (!token) throw new Error('re-verification token missing')
  const request = deps.request || ((path, opts) => platformCall(path, opts))
  const data = await request('/auth/reverify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  return data
}

// Scrubs the token out of the address bar: the history entry is REPLACED, so
// the link is not kept in the history and the token never travels as a Referer.
// The app root is the base of the path: on a static host that serves the app
// under a prefix, '/' would take the visitor out of the app.
export function clearLandingUrl() {
  try {
    window.history.replaceState(null, '', appRootPath() + '#/home')
  } catch { /* no history (tests, exotic webviews): nothing to clean */ }
}
