// The profile photo.
//
// The API re-encodes every upload through GD (at most 256 px, EXIF stripped)
// and stores it as storage/avatars/{userId}.jpg. The photo is personal data:
// the API serves it only to its owner (or an admin of the panel), and the
// browser proves who it is with the session cookie the platform already sets —
// so the picture can be a plain <img src> with no token in the URL.
import { phttp } from './http.js'
import { apiUrl } from './config.js'

// The server's own limits: it rejects a bigger file or another type, and the
// app says so before the upload instead of after.
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// The photo's URL. `version` busts the browser cache after a new upload (the
// API answers the photo with a private, one-hour cache).
export function avatarUrl(userId, version) {
  if (!userId) return ''
  const base = apiUrl('/avatar/' + encodeURIComponent(userId))
  return version ? base + '?v=' + encodeURIComponent(version) : base
}

// Uploads a photo as multipart/form-data (the browser sets the boundary, so
// the content type must not be set by hand).
export async function uploadAvatar(file) {
  const form = new FormData()
  form.append('avatar', file)
  const data = await phttp('/profile/avatar', { method: 'POST', body: form })
  return (data && data.avatar) || null
}

// Removes the photo; the app falls back to the initials.
export async function removeAvatar() {
  await phttp('/profile/avatar', { method: 'DELETE' })
  return null
}
