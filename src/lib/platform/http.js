// Cookie-first HTTP client for the djlabs platform.
//
// The platform session is a short-lived access JWT plus a 30-day refresh cookie (httpOnly,
// same registrable domain). The access token is kept only in this module's memory and sent
// as a Bearer header — nothing durable, no localStorage. Every call carries
// credentials:'include' so the refresh cookie rides along. Any 401 outside the refresh and
// logout endpoints triggers ONE shared POST /auth/refresh and one Bearer retry of the
// original request.
//
// The refresh is SINGLE-FLIGHT: several requests can discover the expired access token at
// the same time, but only one refresh reaches the API. The others wait for that one and
// reuse its token. This matters because the platform rate-limits refreshes per IP; a burst
// of 401s used to turn into a burst of refreshes and a 429.
//
// A failed refresh is NOT automatically the end of the session. Only a definite rejection
// (401/400 from /auth/refresh) ends it. A network error, 429 or 5xx is transient: the
// access token stays untouched, the local session stays signed in, and the app can retry
// later.
import { apiUrl } from './config.js'

// A 401 on these is the answer, not a hint that the session needs renewing.
const NO_REFRESH = ['/auth/refresh', '/auth/logout']

let accessToken = null
let authExpired = false
let refreshPromise = null
const expiredSubs = new Set()
const refreshFailedSubs = new Set()

export const getAccessToken = () => accessToken
export const setAccessToken = t => { accessToken = t; authExpired = false }
export function clearAccessToken() { accessToken = null; authExpired = false }

// Subscribers are called once per detected dead session, before the causing error
// propagates. Returns an unsubscribe function.
export function onAuthExpired(fn) {
  expiredSubs.add(fn)
  return () => expiredSubs.delete(fn)
}
function emitAuthExpired() {
  // One dead session is one notification, even when several requests were waiting on
  // the same rejected refresh.
  if (authExpired) return
  authExpired = true
  accessToken = null
  for (const fn of expiredSubs) {
    try { fn() } catch { /* a broken listener must never break the error path */ }
  }
}

// A transient refresh failure is reported separately: the session is still there, but
// the app should say what happened instead of silently pretending everything is fine.
export function onAuthRefreshFailed(fn) {
  refreshFailedSubs.add(fn)
  return () => refreshFailedSubs.delete(fn)
}
function emitAuthRefreshFailed(details) {
  for (const fn of refreshFailedSubs) {
    try { fn(details) } catch { /* a broken listener must never break the error path */ }
  }
}

// One silent refresh, shared by every caller that needs it. The result says WHY the
// refresh ended:
//   { kind: 'ok', token }
//   { kind: 'rejected', status }  — 401/400: the refresh cookie is definitely gone
//   { kind: 'transient', status, error } — network/429/5xx: try again later
async function performRefresh() {
  let r
  try {
    r = await fetch(apiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
  } catch (error) {
    const result = { kind: 'transient', status: null, error }
    emitAuthRefreshFailed(result)
    return result
  }

  if (r.status === 401 || r.status === 400) {
    // These two statuses are the platform's definite answer: the refresh cookie
    // is gone or invalid. The session is really over, so the expiry listeners
    // fire once. A 429 or a 5xx never reaches this branch.
    const result = { kind: 'rejected', status: r.status }
    emitAuthExpired()
    return result
  }
  if (!r.ok) {
    const result = { kind: 'transient', status: r.status }
    emitAuthRefreshFailed(result)
    return result
  }

  const data = await r.json().catch(() => ({}))
  const payload = data && data.data && typeof data.data === 'object' ? data.data : data
  const token = payload && (payload.token || payload.access_token) || null
  if (!token) {
    const result = { kind: 'transient', status: r.status }
    emitAuthRefreshFailed(result)
    return result
  }
  accessToken = token
  authExpired = false
  return { kind: 'ok', token }
}

// The single-flight gate. While one refresh is in flight, every other caller receives
// the SAME promise and therefore the same result/token.
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

// Compatibility helper: the token when the refresh succeeds, null otherwise. The
// structured refreshSession() result is what phttp uses to tell rejection from failure.
export async function silentRefresh() {
  const result = await refreshSession()
  return result.kind === 'ok' ? result.token : null
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
  let refreshResult = null
  if (r.status === 401 && !NO_REFRESH.includes(path.split('?')[0])) {
    refreshResult = await refreshSession()
    if (refreshResult.kind === 'ok') r = await call(refreshResult.token)
    // A definite rejection already fired the expiry listeners inside the shared
    // refresh. A transient failure leaves the original 401 as the request's error,
    // but marks it so callers can tell "the session died" from "we could not renew
    // it just now".
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = platformError(r, data)
    if (refreshResult && refreshResult.kind === 'rejected') e.authExpired = true
    if (refreshResult && refreshResult.kind === 'transient') {
      e.transient = true
      e.refreshStatus = refreshResult.status
    }
    throw e
  }
  // Platform convention: almost every JSON answer is wrapped in a success envelope
  // ({ success: true, data: { ... } }) — callers receive the INNER payload, exactly
  // like the other djlabs fronts. The gym module routes answer without an envelope
  // ({ state: ... } top-level), so unwrap only when the envelope shape is present.
  if (data && data.success === true && 'data' in data) return data.data
  return data
}
