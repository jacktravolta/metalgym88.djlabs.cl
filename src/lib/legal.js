// Where the legal documents live.
//
// The Terms and the Privacy Policy belong to THIS product, so they live in this
// repository (public/legal/) and are served by the same static host as the app.
// They are NOT served by the platform host: `apiUrl('/terminos')` used to point
// at a document that the platform answers with the landing page of another
// product, which is worse than no link at all.
//
// The app is published in two shapes — at the root of a domain (Cloudflare
// Pages) and under a path prefix (GitHub Pages) — so every internal link is
// built from import.meta.env.BASE_URL and resolves in both.
//
// Nothing here talks to the platform and nothing here loads a script: these are
// plain static documents, which is exactly what the site's CSP allows.
export const legalUrl = name => `${import.meta.env.BASE_URL}legal/${name}.html`

export const TERMS_URL = legalUrl('terminos')
export const PRIVACY_URL = legalUrl('privacidad')
