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
export const PANEL_URL = 'index.html#/home'

/** The href of the landing section that renders the inline login form. */
export const loginSectionHref = () => `#${LOGIN_SECTION_ID}`

/**
 * Where the "Entrar al panel" label goes: the panel itself once the session
 * is here, the login section while it is not (the label never lies about
 * where a click ends).
 */
export const panelHref = loggedIn => (loggedIn ? PANEL_URL : loginSectionHref())
