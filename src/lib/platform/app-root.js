// The app root: the directory that holds index.html.
//
// The app is published in two shapes: at the root of its own subdomain and
// inside a subdirectory of a static host (GitHub Pages:
// https://<user>.github.io/<repo>/). Every path the app builds — the service
// worker, the URL the visitor comes back to, the "am I on the landing?"
// question — has to start at the app root, or the visitor lands OUTSIDE the
// app (on the host's home page, or on a 404).
//
// The <base> element of the built shell already points at the app root (see
// vite.config.js), so the root is READ from the document, never guessed.

/** The document base, with a safe fallback for environments without a DOM. */
function baseHref() {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI
  if (typeof window !== 'undefined' && window.location && window.location.href) return window.location.href
  return '/'
}

/** The app root as an absolute URL, always with its trailing slash. */
export function appRootUrl() {
  try {
    return new URL('./', baseHref())
  } catch {
    return new URL('/', 'http://localhost')
  }
}

/** The app root as a path, always with its trailing slash ('/', '/repo/'). */
export function appRootPath() {
  return appRootUrl().pathname
}

/** True when the given pathname IS the app root. */
export function isAppRoot(pathname) {
  const p = String(pathname == null ? '/' : pathname)
  return (p.endsWith('/') ? p : p + '/') === appRootPath()
}
