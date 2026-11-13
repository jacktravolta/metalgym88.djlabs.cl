import { appRootPath } from './platform/app-root.js'

// The landing's login section contract.
//
// The login form is decoupled (AuthPanel, shared with the app's sign-in route
// and its Settings sheets) and is ALSO rendered inline in the landing. Two
// places must agree on where it lives — the header CTA and the footer link —
// and the signed-in variant of the same label must keep going to the panel
// itself. Both answers live here, so a rename can never leave a link pointing
// at a section that moved; the pure module also keeps the contract testable
// without a DOM, since the harness has no renderer for this repo.
//
// The landing is served as its own page (the app root without a hash), so
// "#login" is an ordinary in-page anchor; the panel is the hash-router app.
export const LOGIN_SECTION_ID = 'login'

/**
 * Where the panel lives: the app root's own document, plus the hash route.
 *
 * It is NOT a hand-written "index.html#/home": the app is published at the
 * root of its own subdomain AND under a path (GitHub Pages), and the app's own
 * magic-link landing already navigates to appRootPath() + '#/home'. Deriving
 * the root from that same helper is what keeps this CTA and the rest of the
 * app from disagreeing about where "the panel" is — one source of truth, not
 * two constants that only look equal.
 *
 * The document's own name is the load-bearing part. The landing IS the app
 * root document, so a URL that differs from it only by the fragment
 * ("/#/home") is a SAME-DOCUMENT navigation: the browser swaps the hash and
 * stops, the landing stays mounted and the panel never boots. The person
 * clicks "Entrar al panel" and nothing happens. Naming the document makes the
 * path differ, so the browser really loads the app — which is what a
 * "goes to the panel" promise has to mean.
 */
export const panelUrl = () => `${appRootPath()}index.html#/home`

/** The href of the landing section that renders the inline login form. */
export const loginSectionHref = () => `#${LOGIN_SECTION_ID}`

/**
 * Where the "Entrar al panel" label goes: the panel itself once the session
 * is here, the login section while it is not (the label never lies about
 * where a click ends).
 */
export const panelHref = loggedIn => (loggedIn ? panelUrl() : loginSectionHref())
