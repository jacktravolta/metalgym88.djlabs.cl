// Navigation helpers shared by the app and its non-component flows.
import { appRootUrl } from './platform/app-root.js'

// Lets non-component modules (sheet flows) navigate inside the hash router.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
export const nav = to => _nav(to)

// The product index: the landing document at the app root. It is deliberately
// NOT a hash route — the hash router is the signed-in panel, while the index is
// the front door that every signed-out destination can return to.
export const indexUrl = () => appRootUrl().href

// Leaves the signed-in panel for the product index. A full document navigation
// is required: the landing and the panel are two mounts of the same bundle, and
// changing only the hash would keep the panel alive underneath.
export function goToIndex(target) {
  const destination = indexUrl()
  const location = target || (typeof window !== 'undefined' ? window.location : null)
  if (!location) return destination
  if (typeof location.assign === 'function') location.assign(destination)
  else location.href = destination
  return destination
}

// The explicit sign-out path, in one testable unit: the session closes first,
// then the browser lands on the index. A rejected sign-out never navigates.
export async function signOutAndGoToIndex(signOut, target) {
  await signOut()
  return goToIndex(target)
}
