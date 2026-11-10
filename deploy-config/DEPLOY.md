# DEPLOY — metalgym88

> Status: **published as a static front.** The app is a pure front: a static
> bundle served by GitHub Pages under a path prefix
> (`https://jacktravolta.github.io/metalgym88.djlabs.cl/`), talking to the
> unified platform at `https://api.djlabs.cl`.
>
> The server-side parts (the backend module on api.djlabs.cl) are still
> **packaged, NOT applied**: applying them is the owner's explicit decision.
> This doc records HOW; it does not authorize anything.

## 1. Build the PWA

```bash
cd metalgym88.djlabs.cl
npm ci && npm run build          # strict base branch only; keep tests green first
# → dist/ holds the static app
```

### The app root (`BASE_PATH`)

The bundle keeps **relative** asset URLs, so the same `dist/` works at the root
of a domain and inside a subdirectory. What tells the browser where the app
root is the `<base>` element the build injects, and that comes from
`BASE_PATH`:

| Build                                  | `<base href>`               | Where it is served                    |
| -------------------------------------- | --------------------------- | ------------------------------------ |
| `npm run build`                        | `/`                         | the root of a domain (subdomain)     |
| `BASE_PATH=/metalgym88.djlabs.cl/ npm run build` | `/metalgym88.djlabs.cl/` | GitHub Pages (the current deployment) |

The `<base>` matters on the deep path of the magic-link landing
(`<root>/auth/verify?token=…`): without it the relative assets would be
asked for under `<root>/auth/` and the app would boot blank.

## 2. Point the bridge at the platform (deploy knob)

`index.html` carries `<script>window.__API_BASE__ = '';</script>`:

- `''` (default): the library default applies — `https://api.djlabs.cl`.
- Any other value: that install. For the gym heart with its own install, set
  it to that install's origin before serving, e.g.
  `window.__API_BASE__ = 'https://<gym-install-origin>';`

The heart slug itself is a product constant (`metalgym88`, in
`src/lib/platform/config.js`) — every heart-scoped call travels with it.

## 3. Serve the static host

### GitHub Pages (current)

`.github/workflows/pages.yml` builds and publishes on every push to `main`:

```text
checkout → setup-node (22) → npm ci → npm run build (BASE_PATH=/metalgym88.djlabs.cl/)
          → upload dist/ as the Pages artifact → deploy-pages
```

Two details of the host are already handled by the build:

- **SPA fallback.** GitHub Pages answers 404 for every path that is not a
  file, so the build emits `404.html` — a copy of the built shell. The magic
  link lands on `/auth/verify?token=…` and Pages serves the copy, which
  boots the app and reads the URL.
- **The service worker** registers itself inside the app directory
  (`<root>/sw.js`), never at the root of the domain, so its scope is the app
  and not the whole site.

### A host of your own (nginx)

Use `deploy-config/nginx-metalgym88.conf.example` (SPA fallback, immutable
asset caching, no-cache for `index.html`/`sw.js` so updates ship instantly,
HTTPS only). Copy `dist/` to the conf's `root` and build with the matching
`BASE_PATH` (empty for the root of a domain).

## 4. API-side requirements (while the backend module is packaged-only)

- The platform's `cors.origins` exact allowlist must include the origin the
  front is served from (`https://jacktravolta.github.io`).
- The heart's `front_url` (in `heart_settings`) is the origin the platform
  sends the magic links to. It must be the front's real origin — a private
  one (`http://127.0.0.1:…`) can never work for a visitor.
- Wallet/tariff/lever routing in production is per install (`HEART_ID`) — see
  `backend-module/INSTALL.md` section 4 (1 install = 1 heart constraint).
- Until the owner applies `backend-module/` (its explicit go), the deployed
  app stays honest and offline-first: data sync and the AI coach show their
  own gentle not-available states, localStorage remains the source of truth,
  and nothing syncs or charges.

## 5. AGPL source availability

The deployed PWA is a network interacted derivative of openGym (AGPL-3.0) —
source of the running version must remain publicly available
(see NOTICE.md / LICENSE). Standard practice: publish this repository (or a
source tarball of the exact deployed commit) and link it in the app's
"About"/terms page before going live.

## 6. Release note for the owner

Applying the backend module + tariffs to the live `api.djlabs.cl` also needs
the adjusted smoke test in `backend-module/INSTALL.md` section 7 (AI:
200 → balance drop, 402 → no debit, 501 → no charge, 502 → no charge) —
run it once after apply, against a test user, before announcing the feature.
