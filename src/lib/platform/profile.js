// Account profile and platform alert preferences against the djlabs platform.
//
// Two things live here, and both belong to the PLATFORM account — not to the
// gym's own local data:
//   · who the person is (name and phone; the email is read-only on purpose), and
//   · which channels the platform may use to reach them (NotMail / NotWsp).
//
// The transport is platformCall (lib/platform/auth.js), so the silent refresh
// and the email re-verification pause behave exactly like the rest of the
// account calls. The heart slug rides on the URLs the platform scopes.
//
// The platform answers with the usual success envelope ({ success, data }). The
// transport already unwraps it, but the client also accepts the raw envelope
// ({ data: { user } } / { data: { prefs } }) and the flat payload
// ({ user } / { prefs }), so a change in the unwrapping never silently empties
// a form. Errors are NOT translated here: the platform already answers in
// Spanish with a message that says what to fix, and that message travels up
// untouched.
import { platformCall } from './auth.js'
import { withHeartQuery } from './config.js'

// The channels the account card can switch. The platform owns the list (the
// in-app inbox, NotInterna, is never switchable); naming the two switchable
// channels here keeps a stray key from ever reaching the server.
export const SWITCHABLE_CHANNELS = ['NotMail', 'NotWsp']

const asObject = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null

// Pulls the user out of { user }, { data: { user } } or a bare user payload.
function pickUser(data) {
  const outer = asObject(data)
  if (!outer) return null
  const direct = asObject(outer.user)
  if (direct) return direct
  const inner = asObject(outer.data)
  const nested = inner ? asObject(inner.user) : null
  if (nested) return nested
  // A payload that IS the user (no wrapper) is accepted too, the same way
  // auth.me() reads it.
  return (outer.id || outer.email) ? outer : null
}

// Pulls the preferences out of { prefs }, { data: { prefs } }; null when the
// answer carries nothing usable.
function pickPrefs(data) {
  const outer = asObject(data)
  if (!outer) return null
  const direct = asObject(outer.prefs)
  if (direct) return direct
  const inner = asObject(outer.data)
  const nested = inner ? asObject(inner.prefs) : null
  return nested
}

// A channel with no stored row reads as ENABLED on the platform — that is the
// server's own default (absence = opted in), not a guess made here.
export function isChannelEnabled(prefs, channel) {
  const p = asObject(prefs) || {}
  return p[channel] !== false
}

// WhatsApp needs a number to reach anyone: without one the platform has no
// way to deliver, so the switch stays off (and off is the only honest state).
export function canUseWhatsApp(user) {
  const u = asObject(user) || {}
  return String(u.phone || '').trim() !== ''
}

// PUT /profile — name (required, 2..100 characters) and phone (optional; an
// empty string removes the stored number). The platform validates both and
// answers in Spanish, so the client sends what was typed and lets the server
// be the judge.
export async function updateProfile({ name, phone } = {}) {
  const body = { name: name == null ? '' : name }
  // An empty string is meaningful (it clears the phone); only "not given at
  // all" leaves the stored value alone.
  if (phone !== undefined) body.phone = phone
  const data = await platformCall('/profile', { method: 'PUT', body: JSON.stringify(body) })
  return pickUser(data)
}

// GET /profile/notifications — the current switches. A channel with no stored
// row reads as ENABLED, so an empty object is a valid answer and not a
// failure.
export async function fetchNotificationPrefs() {
  const data = await platformCall(withHeartQuery('/profile/notifications'), {})
  return pickPrefs(data) || {}
}

// PUT /profile/notifications — saves one channel and returns the switches the
// server holds afterwards. Only switchable channels travel, and the server
// refuses a body with none of them.
export async function updateNotificationPrefs(patch = {}) {
  const source = asObject(patch) || {}
  const body = {}
  for (const channel of SWITCHABLE_CHANNELS) {
    if (Object.prototype.hasOwnProperty.call(source, channel)) body[channel] = !!source[channel]
  }
  const data = await platformCall('/profile/notifications', { method: 'PUT', body: JSON.stringify(body) })
  return pickPrefs(data) || {}
}
