# DEPLOY — metalgym88.djlabs.cl

> Status: **packaged, NOT applied.** Every apply step (server config, nginx,
> backend module on api.djlabs.cl) is the owner's explicit decision. This doc
> records HOW; it does not authorize anything.

## 1. Build the PWA

```bash
cd metalgym88.djlabs.cl
npm ci && npm run build          # strict base branch only; keep tests green first
# → dist/ holds the static app
```

## 2. Point the bridge at the platform (deploy knob)

`index.html` carries `<script>window.__API_BASE__ = '';</script>`:

- `''` (default): the library default applies — `https://api.djlabs.cl`.
- Any other value: that install. For the gym heart with its own install, set
  it to that install's origin before serving, e.g.
  `window.__API_BASE__ = 'https://<gym-install-origin>';`

The heart slug itself is a product constant (`metalgym88`, in
`src/lib/platform/config.js`) — every heart-scoped call travels with it.

## 3. Serve the static host

Use `deploy-config/nginx-metalgym88.conf.example` (SPA fallback, immutable
asset caching, no-cache for `index.html`/`sw.js` so updates ship instantly,
HTTPS only). Copy `dist/` to the conf's `root`.

## 4. API-side requirements (while the backend module is packaged-only)

- The platform's `cors.origins` exact allowlist must include
  `https://metalgym88.djlabs.cl`.
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
"About"/terms page before going live on the subdomain.

## 6. Release note for the owner

Applying the backend module + tariffs to the live `api.djlabs.cl` also needs
the adjusted smoke test in `backend-module/INSTALL.md` section 7 (AI:
200 → balance drop, 402 → no debit, 501 → no charge, 502 → no charge) —
run it once after apply, against a test user, before announcing the feature.
