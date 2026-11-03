// Bridge to the djlabs platform account routes — the metalgym88 heart rides on every
// heart-scoped call so logins, registrations, magic links and the 100-credit welcome
// bonus all bind to this product's wallet, and GET /auth/me comes back with the balance.
// Errors surface like the rest of the app (e.status, e.message) plus e.code for
// machine-readable platform states the UI pauses on.
import { phttp, setAccessToken, clearAccessToken, onAuthExpired } from './http.js'
import { withHeart, withHeartQuery } from './config.js'

// Re-exported so callers only need the auth module for the whole session shape.
export { onAuthExpired }

// The account exists but the email still needs confirming — a distinct pause state,
// not a plain failure. The UI offers to resend the link (magic link) instead of
// pretending the sign-in worked or just dumping an error.
export const EMAIL_REVERIFY_REQUIRED = 'EMAIL_REVERIFY_REQUIRED'

function reverifyError(message) {
  const e = new Error(message || EMAIL_REVERIFY_REQUIRED)
  e.code = EMAIL_REVERIFY_REQUIRED
  return e
}

const looksReverify = e =>
  e.code === EMAIL_REVERIFY_REQUIRED ||
  (typeof e.message === 'string' && e.message.includes(EMAIL_REVERIFY_REQUIRED)) ||
  (typeof e.error === 'string' && e.error.includes(EMAIL_REVERIFY_REQUIRED))

// Wraps phttp so both transport errors and platform-coded bodies map to the pause state
// consistently, whichever way the server chooses to signal it.
async function call(path, opts) {
  try {
    const data = await phttp(path, opts)
    if (data && typeof data.code === 'string' && data.code.includes(EMAIL_REVERIFY_REQUIRED)) {
      throw reverifyError(data.message || data.error)
    }
    return data
  } catch (e) {
    if (looksReverify(e)) e.code = EMAIL_REVERIFY_REQUIRED
    throw e
  }
}

// Remember the access token the session hands out (kept in http.js's memory only).
function adopt(data) {
  const token = data && (data.token || data.access_token)
  if (token) setAccessToken(token)
  return data
}

export function login(email, password) {
  return call('/auth/login', { method: 'POST', body: JSON.stringify(withHeart({ email, password })) })
    .then(adopt)
}

export function requestMagicLink(email) {
  return call('/auth/magic-link', { method: 'POST', body: JSON.stringify(withHeart({ email })) })
}

// Registration routes the platform's welcome credit to the metalgym88 wallet via heart.
export function register(email, name) {
  return call('/auth/register', { method: 'POST', body: JSON.stringify(withHeart({ email, name })) })
    .then(adopt)
}

export async function me() {
  const data = await call(withHeartQuery('/auth/me'), {})
  const user = data.user || (data.id ? data : null)
  const balance = typeof data.balance === 'number'
    ? data.balance
    : typeof (user && user.balance) === 'number' ? user.balance : null
  return { user, balance }
}

export async function logout() {
  try {
    await call('/auth/logout', { method: 'POST', body: '{}' })
  } finally {
    clearAccessToken()
  }
}
