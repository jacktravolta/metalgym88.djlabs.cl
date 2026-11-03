// Backend helpers for the legacy self-hosted API (state sync, admin, activity pings)
// and the user-agent facts the UI still branches on.
//
// The WebAuthn/passkey helpers that used to live here were removed with T2: accounts and
// sessions now come from the djlabs platform (src/lib/platform/ — password + magic link +
// silent refresh), and the passkey flows went with the old self-API entirely.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}
