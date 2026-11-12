# Feature: CDP E2E suite + legal pages owned by the front

**Status:** in progress (T1–T4 closed on the branch; the deployment is the owner's call)
**Created:** 2026-11-11
**Repo:** metalgym88.djlabs.cl (branch base: `origin/main` @ `e492d14`)
**Public domain under test:** https://metaigym88.djlabs.cl/

## Objective

1. Build a Chrome DevTools Protocol (CDP) end-to-end suite that exercises the real
   public product and proves, with evidence, the following journeys:
   contact email, registration, login, access recovery, credit top-up, and navigation
   through the openGym product surface.
2. Own the legal pages from the front repository: Terms & Conditions and Privacy Policy
   must live in this repo and be opened from the app's index, not from the API host.

## Problem

- The front links its legal pages to the platform host
  (`apiUrl('/terminos')`, `apiUrl('/privacidad')` in `src/views/Landing.jsx` and
  `src/components/AuthForms.jsx`). On `https://api.djlabs.cl/terminos` and
  `.../privacidad` the server answers **the same 186 739-byte HTML document**
  (sha256 `b800ad12…`, title "Asistente Jurídico Digital"): the landing page of a
  *different* djlabs product. The platform ships no legal document for the
  metalgym88 heart, so a metalgym88 user clicking "Términos y Condiciones" lands on
  another product's marketing page.
- There is no automated end-to-end coverage of the public deployment. Regressions on
  the live domain are only found by hand.

## Scope

**In scope**

- CDP harness (Chrome + raw DevTools Protocol over WebSocket, no new runtime dep)
  living in this repo, runnable against any public origin.
- E2E scenarios: contact email, registration, login, access recovery (passwordless
  re-link), credit top-up, product navigation.
- `public/legal/terminos.html` and `public/legal/privacidad.html` in this repo.
- Landing and auth forms link the local pages through `import.meta.env.BASE_URL`
  so the app works both at the domain root and under the GitHub Pages prefix.
- Tests and docs alongside the behavior.

**Out of scope**

- The platform API (php backend on `api.djlabs.cl`) — this repo is the front only.
- Publishing/deploying. Push, PR and merge stay the user's decision; the live domain
  is served by Cloudflare Pages, which builds the repo on `main`.

## Constraints

- No new npm runtime dependency: CDP is driven over the WebSocket built into Node 22.
- The app is **passwordless** (magic link). There is no password to reset:
  "password recovery" is the access-link recovery path (re-send / re-issue link).
- Credit top-up runs through Flow; the final payment leg needs a real payment method.
  The suite proves order creation and the redirect, and stops at the gateway.
- Legal text must be specific to metalgym88 (gym tracker), not copy another product's.
- Privacy posture of the product: offline-first (localStorage is the source of truth),
  the AI assistant needs connectivity and consumes platform credits.
- The legal pages load **no script and no external resource**: the site's CSP
  (`script-src` with two fixed sha256 hashes, `style-src 'unsafe-inline'`,
  `img-src 'self' data: blob: https:`) allows exactly that, and `index.html` /
  `_headers` are NOT touched, so no hash had to be recomputed.
- The pages follow the operating system's light/dark preference
  (`prefers-color-scheme`): a static page cannot read the app's stored theme
  (`gym_state_v1` in localStorage) without an inline script, and the CSP allows none.

## Tasks

| ID | Task | Route | Status |
|----|------|-------|--------|
| T1 | CDP client harness (Chrome launch, WS transport, page helpers, assertions, report) | delegated writer | done |
| T2 | E2E scenarios against https://metaigym88.djlabs.cl/ + captured evidence | delegated writer | done |
| T3 | Legal pages in `public/legal/` + local links from index/landing/auth forms | delegated writer | done |
| T4 | Verification: vitest suite, production build, CDP re-run, link readback | inline + per-action workers | done (see evidence) |

### T1 — CDP harness

- Launch `/usr/bin/google-chrome` headless with `--remote-debugging-port`.
- Minimal CDP client over the Node 22 built-in `WebSocket` (no dependency added).
- Helpers: navigate, wait for text/selector, click, type, read console + network,
  screenshot, read text content.
- Deterministic runner that prints a per-scenario PASS/FAIL table and writes a
  machine-readable report.

### T2 — Scenarios

- S1 contact email → POST reached, friendly confirmation shown.
- S2 registration → magic link issued, account created after verifying the link.
- S3 login → session established, wallet/balance visible.
- S4 access recovery → new link issued from the recovery entry point.
- S5 credit top-up → limits loaded, order created, gateway redirect reached.
- S6 navigation → landing, exercise catalogue, workout, profile/wallet.
- S7 legal pages → what the Terms/Privacy links really answer.

### T3 — Legal pages

- `public/legal/terminos.html`, `public/legal/privacidad.html` (Spanish, product-specific).
- Links rewritten to `import.meta.env.BASE_URL` paths; no `apiUrl()` for legal pages.
- Legal pages reachable by direct URL on the deployed host.

#### T3 — what the code says (the source of every claim)

The legal text was written only after reading what the product actually does. Each
claim below is backed by the file that proves it.

| Claim in the pages | Backed by |
| --- | --- |
| Offline-first: localStorage is the source of truth, the mirror is a copy | `src/store/useStore.js` (`persist` → `localStorage.setItem(STATE_KEY)`, `pushState` comment "localStorage stays the source of truth"), `src/store/sync.js` header |
| The state syncs per user through `GET`/`PUT /opengym/data` | `src/store/sync.js` (`SYNC_DATA_PATH = '/opengym/data'`), `src/store/useStore.js` (`pullState`/`pushState`), `backend-module/API.md` |
| The sync is heart-scoped and never mixes products | `src/lib/platform/config.js` (`HEART = 'metalgym88'`, `withHeart`), `backend-module/app/Heart/Opengym/DocumentStore.php` (one file per user id) |
| The assistant needs a connection and is the only metered feature | `src/components/Assistant.jsx` (`OFFLINE_LINE`), `src/lib/platform/assistant.js` (`isOffline`, `ASSISTANT_PATH`) |
| The coach receives the question and a bounded summary of the screen | `src/lib/coach-context.js` (`MAX_COACH_LINES = 40`, `MAX_COACH_LINE_CHARS = 200`), `src/lib/platform/assistant.js` (`askAssistant` body) |
| The server adds a reduced view of the stored record | `backend-module/app/Heart/Opengym/Assistant.php` (`reduceContext`, `max_context_chars`) |
| Question/answer content is never logged (ids, lengths, cost only) | `backend-module/app/Heart/Opengym/Assistant.php` (`AppLog::info` fields), `backend-module/API.md` (privacy row) |
| The assistant does not diagnose and does not promise results | `backend-module/app/Heart/Opengym/Assistant.php` (`systemPrompt`, rules 3 and 4) |
| A failed answer is not charged; the debit is idempotent per operation | `backend-module/app/Heart/Opengym/Assistant.php` (balance check → 402, debit after the answer, `gym_ai:<uuid>`), `backend-module/API.md` (502 = no charge) |
| The welcome bonus is 100 credits, once, on a new account | `src/views/Landing.jsx` ("Te acreditamos 100 créditos de bienvenida"), `src/lib/platform/auth.js` (heart-scoped welcome bonus) |
| Only the assistant is metered; plan, library, history and stats are free | `src/views/Landing.jsx` (`FEATURES`, "Billetera en créditos"), `src/components/Wallet.jsx` ("Everything else in the app … stays free") |
| The cost is shown only when the platform serves it | `src/components/Assistant.jsx` ("The cost is shown when you confirm"), `src/lib/platform/wallet.js` (`fetchTariffs`) |
| Recharges go through a gateway in another tab and the app watches the order | `src/lib/platform/wallet.js` (`openPaymentTab`, `goToPayment`, `checkReturnedTopUp`) |
| A top-up carries an idempotency key: a retry never charges twice | `src/lib/platform/wallet.js` (`createOrder`, `Idempotency-Key` header and its comment) |
| The balance never goes negative | `backend-module/app/Heart/Opengym/Assistant.php` (balance checked before the debit; 402 without a charge) |
| The wallet movements are visible in the app | `src/lib/platform/wallet.js` (`MOVEMENT_LABELS`, `fetchMovements`) |
| Access is by one-time magic link; the password path exists for older accounts | `src/lib/platform/auth.js` (`requestMagicLink`), `src/components/AuthForms.jsx` (`PasswordForm` → `POST /auth/login`), `src/views/Landing.jsx` (`STEPS`) |
| The session token lives in memory; the refresh cookie is httpOnly | `src/lib/platform/http.js` (module header, `setAccessToken`, `credentials: 'include'`) |
| The profile holds name, optional phone, read-only email and an optional photo | `src/lib/platform/profile.js` (`updateProfile`), `src/lib/platform/avatar.js` (max 256 px, EXIF stripped) |
| Sign-out everywhere exists and keeps the account | `src/store/useStore.js` (`signOutAll`), `src/views/Settings.jsx` |
| The server validates the session on every read/write of the record | `backend-module/API.md` ("Only the authenticated user's document is ever read"), `backend-module/app/Heart/Opengym/OpengymModule.php` (`AuthMiddleware::requireUser`) |
| The pages keep the site's CSP: no script, no external resource | `index.html` (CSP meta tag), `_headers` |

**Claims that are NOT backed by code** (they are the owner's stated policy, taken
from the feature brief, and they are written as commitments, not as facts read from
the source):

- "1 crédito ≈ $1 CLP" as pure commercial transparency. The tariff is real
  (`backend-module/migrations/00XX_opengym_init.sql`: `gym_ai_chat`, 5 credits) and
  the packs are real (`PACKS` in `src/views/Landing.jsx`: 1 000/2 000/5 000/10 000
  CLP), but the 1:1 reference is a stated convention, not a computed rate.
- "No vendemos tus datos" and the SII 6-year retention of the payment backups.
- The exercise of the data rights (access, rectification, deletion) — the front has
  no account-deletion endpoint today; the request is handled by email.
- The identification of the legal entity (razón social, RUT, domicilio). It is not in
  this repository and it was **not invented**: `public/legal/privacidad.html` carries
  an HTML comment marking the spot for the owner to complete before publishing.
- **Passkeys are NOT mentioned** in the Terms: they were removed with the old
  self-hosted API (`src/lib/api.js`: "the passkey flows went with the old self-API
  entirely") and the platform build has no passkey route. Claiming them would have
  been false advertising.

### T4 — Verification

- `npm test` (vitest) green.
- `npm run build` green; built HTML keeps the CSP meta tag and its script hashes valid.
- CDP suite re-run; every scenario's real outcome recorded (pass/fail/blocked with reason).
- CSP `script-src` hashes recomputed if `index.html` inline scripts change.

## Acceptance criteria

- Every requested journey has an executed CDP result with evidence, or an explicit
  blocked reason (never a fabricated pass).
- Legal pages served from the front repo's own origin; links no longer point at
  `api.djlabs.cl` for Terms/Privacy.
- Links resolve correctly under both `/` and `/metalgym88.djlabs.cl/` base paths.
- Test suite and docs live next to the behavior they describe.

## Verification evidence

(updated as tasks close)

### T1/T2 — the CDP suite against the live deployment

- Command: `npm run test:e2e` (`node scripts/e2e/run.js`).
- Report: `artifacts/e2e/report.md` + `artifacts/e2e/report.json` (git-ignored).
- Observed result on 2026-11-12 against `https://metaigym88.djlabs.cl`:
  **0 PASS · 8 FAIL · 0 BLOCKED**.
- The dominant cause is the platform's CORS configuration: the preflight
  `OPTIONS https://api.djlabs.cl/<route>` answers **HTTP 404 with no
  `Access-Control-Allow-Origin`**, so the browser refuses the call
  (`net::ERR_FAILED`) before it leaves the page. That blocks S1–S6 (contact,
  register, verify, login, recovery, top-up, navigation). The platform's CORS
  allowlist must include the metalgym88 origin (`backend-module/INSTALL.md` §5).
- **S7 (legal pages) is the defect this feature set out to fix**: both links
  answered the same 186 739-byte document (sha256 `b800ad12…`, title "Asistente
  Jurídico Digital"), served by `api.djlabs.cl` — not a metalgym88 legal page.

### T3/T4 — the legal pages in this repo

- `npm test` → **21 files / 365 tests passed** (was 20/361; the new
  `src/lib/legal.test.js` adds 4).
- `npm run build` → green. `dist/legal/terminos.html` (18 643 B) and
  `dist/legal/privacidad.html` (16 775 B) exist; the built bundle contains
  `` `./legal/${name}.html` `` and **zero** occurrences of
  `api.djlabs.cl/terminos` / `api.djlabs.cl/privacidad`.
- Link readback in real Chrome (the repo's own CDP harness), serving `dist/` under
  each mount:

| Mount | Link (attribute) | Resolved | HTTP | Document |
| --- | --- | --- | --- | --- |
| `/` | `./legal/terminos.html` | `http://host/legal/terminos.html` | 200 | "Términos y Condiciones — metalgym88" |
| `/` | `./legal/privacidad.html` | `http://host/legal/privacidad.html` | 200 | "Política de Privacidad — metalgym88" |
| `/metalgym88.djlabs.cl/` | `./legal/terminos.html` | `http://host/metalgym88.djlabs.cl/legal/terminos.html` | 200 | same document |
| `/metalgym88.djlabs.cl/` | `./legal/privacidad.html` | `http://host/metalgym88.djlabs.cl/legal/privacidad.html` | 200 | same document |

  The three link sites were each read in the browser: the landing's signup
  checkbox, the landing's footer, and the auth form's "Leerlos" link. All three
  resolve to `./legal/…`; the resolution is what `<base href>` decides, and the
  built shell carries `<base href="/">` by default and
  `<base href="/metalgym88.djlabs.cl/">` under `BASE_PATH=/metalgym88.djlabs.cl/`.
- `dist/` was rebuilt with the **default** `BASE_PATH` at the end of the task, so
  the bundle is not left in prefix mode.
- `index.html`, `_headers` and `public/_headers` were **not touched**: the pages
  load no script, so the CSP script hashes stay valid.

### Commits (this branch)

| Work unit | Message | Files |
| --- | --- | --- |
| T1 + T2 | `test(e2e): CDP suite against the public deployment` | `scripts/e2e/**`, `.gitignore` (`artifacts/`), `package.json` (`test:e2e`) |
| T3 + T4 | `feat(legal): own the Terms and Privacy pages in the front` | `public/legal/**`, `src/lib/legal.js`, `src/lib/legal.test.js`, `src/views/Landing.jsx`, `src/components/AuthForms.jsx`, this document |

The commit hashes are recorded in Engram under the topic
`odd/cdp-e2e-and-legal-pages/tasks` (project `metalgym88.djlabs.cl`).

## Final E2E run against the live deployment

Run after the platform side was repaired (CORS allowlist for
`https://metaigym88.djlabs.cl`, emblem route, magic-link host). Evidence:
`npm run test:e2e` → report in `artifacts/e2e/report.md`.

| ID | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| S1 | Contact | PASS | `POST /contact` reached `api.djlabs.cl` with `heart=metalgym88` (HTTP 200) and the UI confirmed it |
| S2 | Registration | PASS | `POST /auth/magic-link` (HTTP 200), Terms accepted, the UI asked to check the inbox |
| S2b | Verification | PASS | the mailed link answered HTTP 200 and `GET /auth/me` returned 200 (session alive) |
| S3 | Login | PASS | sign-in link issued, session 200, balance reads "100 créditos disponibles" |
| S4 | Access recovery | PASS | no password to reset (the product is passwordless); the recovery door re-issued the link (HTTP 200) |
| S5 | Credit top-up | BLOCKED | limits loaded (1000–10000 CLP) and the order was created (HTTP 200), but the platform answered `provider=fake` and the redirect stayed on `api.djlabs.cl` — the real Flow gateway was never reached and no payment leg was attempted |
| S6 | Navigation | FAIL | every view rendered (landing, home, catalogue, plan, workout, progress, history, settings, wallet) but the walk logged 3 failed resources: `POST /api/activity` → **405** |
| S7 | Legal pages | FAIL | both links still answer the same 186–190 KB document served by `api.djlabs.cl` ("Asistente Jurídico Digital") — the live bundle predates this branch |

### S6 root cause — the legacy self-API

`POST /api/activity` was a leftover of the openGym fork's self-hosted backend
(`src/lib/api.js`: "legacy self-hosted API"). The metalgym88 front is a static
bundle: its own origin answers **405** to every `/api/*` POST. The platform has
no equivalent endpoint, so the calls could only ever fail. Removed in this
work unit:

- `src/views/Workout.jsx` — the live-presence heartbeat (periodic ping,
  `sendBeacon` "left" signal, and the `active:false` call).
- `src/store/useUI.js` — the server-side "rest over" push
  (`/api/push/rest-timer`, `/api/push/rest-timer/cancel`). The rest timer is
  local (countdown + Capacitor local notifications in `src/lib/mobile.js`).

Both were best-effort (`.catch(() => {})`), so the product never broke — it
just logged errors and wasted requests. Verification: `npm test` 365 passed,
`npm run build` green, and the built bundle contains **0** occurrences of
`/api/activity` and `/api/push/rest-timer`.

### Still dead in the front (reported, not touched — they need a product decision)

- `src/lib/push.js` — `/api/push/public-key`, `/subscribe`, `/unsubscribe`,
  `/api/push/test`: enabling Web Push from Settings cannot work.
- `src/views/Admin.jsx` — six `/api/admin/*` calls: the admin dashboard loads
  nothing. It is reachable only for `user.admin`.

### S5 root cause — the payment provider is a stub

`POST /payments/orders` answers `provider=fake`: the install answers with the
fake provider instead of Flow, so no order reaches a real gateway. Wiring the
real provider is the owner's decision (credentials and go-live checklist).

### S7 root cause — the live bundle predates this branch

Cloudflare Pages builds `main`; the legal pages land only when this branch is
merged. Until then the live links keep pointing at the API.

## Next step

1. Push and merge this branch (`feat/cdp-e2e-and-legal-pages`) into `main`:
   Cloudflare Pages then publishes `public/legal/terminos.html` and
   `public/legal/privacidad.html`, and S6 + S7 turn green on the next
   `npm run test:e2e`.
2. Push the API branch `feat/panel-modulos` (3 commits) — the production fix
   lives only in the local working tree until it is pushed.
3. Complete the responsible party's identification in
   `public/legal/privacidad.html` (marked with an HTML comment) and review the
   four commitments the code cannot back (§ "claims not backed by code").
4. Decide the payment provider (`provider=fake` → Flow) and whether Web Push
   and the admin dashboard are implemented on the platform or removed from the
   front.

