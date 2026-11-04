// Cookie-first HTTP client for the djlabs platform.
//
// The platform session is a short-lived access JWT plus a 30-day refresh cookie (httpOnly,
// same registrable domain). The access token is kept only in this module's memory and sent
// as a Bearer header — nothing durable, no localStorage. Every call carries
// credentials:'include' so the refresh cookie rides along. Any 401 outside the refresh and
// logout endpoints triggers exactly one POST /auth/refresh and one Bearer retry of the
// original request; if the refresh itself fails the session is over on this device and the
// expiry listeners fire, so the app can flip to its signed-out state.
import { apiUrl } from './config.js'

// A 401 on these is the answer, not a hint that the session needs renewing.
const NO_REFRESH = ['/auth/refresh', '/auth/logout']

let accessToken = null
const expiredSubs = new Set()

export const getAccessToken = () => accessToken
export const setAccessToken = t => { accessToken = t }
export function clearAccessToken() { accessToken = null }

// Subscribers are called once per detected dead session, before the causing error
// propagates. Returns an unsubscribe function.
export function onAuthExpired(fn) {
  expiredSubs.add(fn)
  return () => expiredSubs.delete(fn)
}
function emitAuthExpired() {
  clearAccessToken()
  for (const fn of expiredSubs) {
    try { fn() } catch { /* a broken listener must never break the error path */ }
  }
}

// One silent refresh: POST /auth/refresh with the refresh cookie, returns the new access
// token (or null when the cookie is gone/invalid).
export async function silentRefresh() {
  const r = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  if (!r.ok) return null
  const data = await r.json().catch(() => ({}))
  accessToken = data.token || data.access_token || null
  return accessToken
}

// Error shaped like the rest of the app (e.status), plus the platform's machine-readable
// code when it gives one (e.g. EMAIL_REVERIFY_REQUIRED).
// The platform's error envelope nests both: { success:false, error:{ code, message } }.
// Read flat, the message would be the string "[object Object]" and the code would be
// lost — which would also hide the EMAIL_REVERIFY_REQUIRED pause. Flat bodies are
// still accepted (some older routes answer that way).
function platformError(r, data) {
  const env = data && typeof data === 'object' ? data : {}
  const inner = env.error && typeof env.error === 'object' ? env.error : null
  const message = (inner && typeof inner.message === 'string' && inner.message) ||
    (typeof env.error === 'string' && env.error) ||
    (typeof env.message === 'string' && env.message) ||
    'HTTP ' + r.status
  const e = new Error(message)
  e.status = r.status
  e.code = (inner && typeof inner.code === 'string' && inner.code) ||
    (typeof env.code === 'string' ? env.code : '')
  return e
}

export async function phttp(path, opts = {}) {
  const url = apiUrl(path)
  // A multipart body carries its own content type: the browser sets it WITH the
  // boundary, so setting it by hand would produce a body the server cannot read
  // (and the JSON default would silently break every upload).
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  const call = token => fetch(url, Object.assign({
    credentials: 'include',
    headers: Object.assign(
      isForm ? {} : { 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {},
      // Caller headers (e.g. the payments Idempotency-Key) ride ALONGSIDE the base
      // ones — replacing wholesale would silently drop the auth token.
      opts.headers || {}
    )
    // NOTE: spread the caller's opts MINUS headers (already merged above), so this
    // outer Object.assign cannot overwrite the merged header set.
  }, (({ headers, ...rest }) => rest)(opts)))

  let r = await call(accessToken)
  if (r.status === 401 && !NO_REFRESH.includes(path.split('?')[0])) {
    const token = await silentRefresh()
    if (token) r = await call(token)
    else emitAuthExpired()
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw platformError(r, data)
  // Platform convention: almost every JSON answer is wrapped in a success envelope
  // ({ success: true, data: { ... } }) — callers receive the INNER payload, exactly
  // like the other djlabs fronts. The gym module routes answer without an envelope
  // ({ state: ... } top-level), so unwrap only when the envelope shape is present.
  if (data && data.success === true && 'data' in data) return data.data
  return data
}
