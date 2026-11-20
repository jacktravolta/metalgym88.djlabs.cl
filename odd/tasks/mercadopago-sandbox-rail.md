# Mercado Pago sandbox rail — operator runbook

Scope: the Mercado Pago card rail (Checkout API via Payments API + Card Payment Brick) on
`metalgym88.djlabs.cl` + `api.djlabs.cl`. This is the operator checklist for taking the
rail from "code merged" to "credits arriving in the wallet". Everything below was verified
against the live gateway on 2026-11-18.

## 1. The credential model (verified — read this first)

| Credential pair | Belongs to | Reads the API | Creates payments |
|---|---|---|---|
| Pair `APP_USR-3645…` (app `3645296097463772`, user `3853434071`, `TESTUSER…`) | a **separate test-user account** | yes | **no** — 401 `Unauthorized use of live credentials` (cause code 7) on every `POST /v1/payments`, offline methods included |
| Pair `APP_USR-6339…` (app `6339923755616508`, user `1152415668`, site `MLC`) | the **production seller account** | yes | **yes** — real payments are created |

The 401 is **not** a Mercado Pago limitation for Checkout API in Chile: the official guide
for Checkout API (Payments API) says a test purchase must use *the test credentials of the
production user* ("las credenciales de prueba de su usuario de producción"). The pair we
tried belongs to a different account (a `TESTUSER` account), so the API refuses it for
live-style payment creation.

**The missing piece is therefore a third pair**: in the panel of the production app
(`6339923755616508`), switch the environment selector to **Prueba**, complete the pending
task **"Configurar ambiente de desarrollo"**, and copy that app's test **Public Key** and
**Access Token**. That pair runs with `live_mode: false` and the APRO/OTHE/CALL scenarios
work as documented.

There is no `api.sandbox.mercadopago.com` anymore: one host, `api.mercadopago.com`, and
the credential selects the mode. The `TESTUSER` pair is still useful for reading (payment
lookups, the account profile).

The one `approved` payment visible in the development account is **not** a card payment: it
is Mercado Pago funding the test user's own wallet (`payment_method_id: account_money`,
`description: fund_test_user_fund`). Do not read it as proof that the sandbox works.

The production account is a proven seller: 109 payments with real `approved` / `accredited`
card transactions. Cards work there.

## 2. Why the simulated card is rejected

With production credentials, the test card comes back `rejected` / `cc_rejected_high_risk` —
for every holder name (`APRO`, `OTHE`, `CALL` alike), with plausible buyer emails, with
different amounts and with or without `issuer_id`. Two causes remain, both outside the
backend:

1. the card token was minted **server-side** through `POST /v1/card_tokens` instead of by
   the Brick in a browser (no browser/device context reaches the risk engine);
2. the request came from a datacenter IP.

**Therefore the journey runs through the Brick in a browser.** A shell probe with a
server-minted token is not a valid rehearsal of the production path.

## 3. Preconditions

- [ ] Backend deployed with the MP adapter, the route `POST /payments/webhook/mercadopago`
      and the rail configured **for this product**:
      `payments.rails_by_heart = ['metalgym88' => ['CLP' => 'mercadopago', 'USD' => 'paypal']]`,
      with `payments.default_currency = 'CLP'`. The installation-wide default stays `flow`;
      setting `payments.provider = 'mercadopago'` makes every heart's CLP default to
      Mercado Pago instead. ATSCV keeps the offline rail.
- [ ] Front deployed with the Brick, the CSP allowance for the Mercado Pago SDK and the
      legal consent checkbox.
- [ ] `payments.mercadopago.public_key` + `access_token` set in the server config
      (never in the repo, never in the browser bundle).
- [x] `payments.mercadopago.webhook_secret` (production) and
      `payments.mercadopago.webhook_secret_test` (development) provided by the owner and
      loaded into the gitignored runtime config. Each webhook route reads its own key; the
      test route must never validate with the production secret. With an empty secret the
      webhook fails closed on purpose: 401, no credit, loud log.
- [ ] The **test** credential pair of the production app (`6339923755616508`, environment
      selector "Prueba") copied as text, so the sandbox scenarios can be rehearsed without
      touching real money.
- [ ] Webhook registered in the panel with the URL
      `https://api.djlabs.cl/payments/webhook/mercadopago` and the payment events
      (`payment.updated`, `payment.created`).

## 3.1 Where to test — the exact URLs

**Production is not testable yet.** Probed on 2026-11-19 (UTC-3):

| Probe | Observed | Meaning |
|---|---|---|
| live bundle `assets/index-*.js` | **0** occurrences of `mercadopago` / `MercadoPago` / `cardPayment` | the Brick is **not deployed** |
| `POST https://api.djlabs.cl/payments/webhook/mercadopago` | **404** | the adapter is **not deployed** |
| `POST https://api.djlabs.cl/payments/webhook/mercadopago/test` | **404** | same |
| `POST https://api.djlabs.cl/payments/orders/card` | **401** | the route exists but still belongs to the PayPal rail |

`metalgym88.djlabs.cl` and `metaigym88.djlabs.cl` resolve to the same site.

Once both halves are deployed, these are the test points:

| What | Where |
|---|---|
| Pay from here | `https://metalgym88.djlabs.cl/#/home` → the credits chip or **See my wallet**. The wallet is a **sheet, not a route**: `#/wallet` hits the catch-all and falls back to `#/home` |
| The quote that feeds the Brick | `GET https://api.djlabs.cl/payments/quote` (authenticated; carries `mercadopago.public_key` and the IVA-inclusive price) |
| Card order capture | `POST https://api.djlabs.cl/payments/orders/card` + `Idempotency-Key` |
| Webhook — production | `POST https://api.djlabs.cl/payments/webhook/mercadopago` — accepts only `live_mode === true` |
| Webhook — rehearsal | `POST https://api.djlabs.cl/payments/webhook/mercadopago/test` — accepts only `live_mode === false`, validates with `webhook_secret_test` |
| Ground truth for any payment | `https://api.mercadopago.com/v1/payments/{id}` (Bearer token, server-side only) |

### Deploying both halves

Front, from this worktree on `feat/mercadopago-gateway`:

```bash
npm test && npm run build     # 537/537, build green
# upload dist/ over the front docroot — the same procedure used for the PayPal rail
```

Backend, from `api-independent` on `feat/mercadopago-gateway`, following
`deploy/README.md` §3:

```bash
sudo rsync -a --exclude '.git' /path/to/api-independent/ /var/www/api.djlabs.cl/
sudo chown -R www-data:www-data /var/www/api.djlabs.cl

# /etc/api.djlabs.cl.env — the Mercado Pago block
MERCADO_PAGO_ENABLED=1
MERCADO_PAGO_ENVIRONMENT=production        # 'test' on a rehearsal box
MERCADO_PAGO_PUBLIC_KEY=APP_USR-...
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
MERCADO_PAGO_WEBHOOK_SECRET=<production key>
MERCADO_PAGO_WEBHOOK_SECRET_TEST=<development key>

# regenerate the config from the template, then reload the pool
sudo -u www-data bash -c 'set -a; source /etc/api.djlabs.cl.env; set +a; \
  php deploy/bin/generate-config.php --strict'
sudo systemctl restart php8.3-fpm
```

The `rails_by_heart` line from §3 is the one that decides *this* product's rail:
without it the installation default (`flow`) wins even with the adapter deployed.

## 4. The journey

1. Open the wallet on `metalgym88.djlabs.cl`. The card rail must be **preselected** and the
   amount must show IVA included.
2. Tick Terms + Privacy. The order must not be created without the consent.
3. Pay with the test card:

   | Card | Holder | Document | Outcome expected |
   |---|---|---|---|
   | `5416 7526 0258 2580` | `APRO` | `123456789` | `approved` → credits once |
   | `5416 7526 0258 2580` | `OTHE` | `123456789` | `rejected` → no credit, retry allowed |
   | `5416 7526 0258 2580` | `CALL` | `123456789` | `authorized` → **no credit** until a webhook confirms `approved` |
   | `4998 4704 7065 8262` | `APRO` | `123456789` | `approved` (Visa) |

   Expiry `11/30`, CVV `123`.
4. Check the wallet balance: the credit appears **exactly once**.
5. Check the gateway: `GET /v1/payments/{id}` shows `status`, `status_detail`, `live_mode`
   and `currency_id` (`CLP`).
6. Check the webhook log: the notification arrives, the signature validates, the order is
   marked paid and no second credit happens.
7. Repeat the payment with the same `Idempotency-Key`: the gateway returns the same
   payment id and the balance does not move.

### If the gateway still refuses the simulated card

Do not fight it. Run **one real transaction** with the owner's card for the minimum amount
(1000 CLP), confirm the credit end to end (including the webhook), and refund it from the
Mercado Pago panel. That transaction also counts toward the "Calidad de la integración"
measurement, which is currently at 0/100 and blocks the go-live checklist on MP's side.

## 5. Triage

| Symptom | Cause | Action |
|---|---|---|
| `401 Unauthorized use of live credentials` on `POST /v1/payments` | the credential belongs to a `TESTUSER` account, not to the production user | use the production pair, or the production app's own "Prueba" pair (same account, test environment) |
| `400 invalid_token` | wrong access token | copy it as text from the panel, never from a screenshot |
| `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (`blocked_by: PolicyAgent`) | account-level policy | check the panel for pending account requirements |
| `rejected` / `cc_rejected_high_risk` | the risk engine judged the simulated card or the request context | run the journey through the Brick in a browser; then fall back to one real card |
| `400 bad_request` "The name of the following parameters is wrong" | an invalid root parameter | `context` and `site_id` are **not** valid in the payment body |
| webhook `401` | missing/empty secret, wrong manifest or a tampered body | verify the secret in the config and the manifest template against the official reference |
| webhook `200` but no credit | the payment is not `approved`, or the id does not resolve to one of our orders | read the payment status from the gateway; only `approved` credits |
| duplicate credit | two providers credited the same order | the credit path must be idempotent on the provider-scoped payment id — report it, do not patch by hand |

## 6. Go-live checklist

- [ ] Every journey above passed in the browser, with the real Brick.
- [ ] The webhook secret is set and a real notification was validated end to end.
- [ ] The public key in the browser comes from the quote (`quote.mercadopago.public_key`)
      and the access token / secret never leave the server.
- [ ] No card number, CVV or expiry is stored, logged or persisted. Only the opaque token
      reaches the server.
- [ ] The IVA-inclusive price and the Terms + Privacy consent are visible before paying,
      on every rail.
- [ ] Mercado Pago's integration quality measurement is no longer "pendiente".
- [ ] The production credentials are rotated if they were ever exposed outside the server
      config.

## 7. Appendix — verified API contract

`POST https://api.mercadopago.com/v1/payments`

Headers: `Authorization: Bearer <access_token>`, `Content-Type: application/json`,
`X-Idempotency-Key: <unique per attempt>`.

Body: `token` (Brick token), `transaction_amount` (CLP), `description`, `installments`,
`payment_method_id`, `issuer_id` (optional), `payer{email, identification{type:"RUT",
number}}`, `external_reference` (our order id). `context` and `site_id` are not valid.

Response: `id`, `status`, `status_detail`, `live_mode` (`true` with production
credentials), `currency_id` (`CLP`), `transaction_amount`, `installments`,
`payment_method_id`, `date_approved`, `external_reference`. `payer.email` comes back
`null` even when it was sent — keep the email we sent.

`GET /v1/payments/{id}` returns the same shape.

Only `approved` credits. `authorized`, `in_process`, `pending`, `rejected`, `refunded`,
`cancelled` and `charged_back` never credit.

## 8. Progress

| Unit | Route | Evidence | Commit |
|---|---|---|---|
| Front — Mercado Pago card rail (Brick, gateway selector, IVA-inclusive total, Terms + Privacy consent, CSP allowance, legal pages naming the three providers) | delegated writer, committed here | `npx vitest run src/lib/platform/wallet.test.js` → 73/73; `npx vitest run` → 537/537 (36 files); `npm run build` → built in 2.06s | `786b7b8` (`feat(wallet): offer Mercado Pago as the card rail in the checkout`) |
| Backend — MP adapter, webhook, card endpoint, legal primitives | delegated writer, in flight in `api-independent-worktrees/mercadopago-gateway` | pending | — |
| Engram mirror (`odd/mercadopago-third-gateway/tasks`) | — | pending: the Engram server has refused writes since 2026-11-18 | — |

## 9. Next step

The backend adapter is the last piece of code. After it lands, the remaining work is
operational, not development: the webhook secret, the test credential pair of the
production app, and the journey in section 4 run through the Brick in a browser.

## 10. Live purchase continuation — 2026-11-19

### Objective

Complete the visible 1,000 CLP credit-purchase journey on the already-active Mercado Pago production rail through CDP, with exactly one credit movement and without exposing card data.

### Current evidence

- The running API resolves `metalgym88 + CLP` to Mercado Pago production.
- The deployed front (`origin/main@5254b269`) initializes the Brick with an incomplete RUT and therefore renders the card form as unavailable.
- The targeted correction from local `main@f432411` is now isolated on `feat/mercadopago-live-purchase` from deployed front revision `5254b269`; the unrelated privacy changes remain excluded.
- The local MySQL database contains no Mercado Pago card token or card fixture.
- `E2E_PAYPAL_CARD_*` is proven only for PayPal sandbox and cannot authorize a Mercado Pago production payment.
- The pinned account has an email but no RUT; the corrected Brick requires a valid RUT before submission.

### Authorized scope

- Complete the live purchase on `metalgym88.djlabs.cl` for the visible 1,000 CLP package.
- Use the local CDP harness and credentials already stored on this machine.
- Isolate and deploy the Brick/RUT correction required to make the visible flow work.
- Do not switch the CLP rail to Flow, change the global payment default, print or persist card values, or create duplicate orders.

### Tasks

- [x] **T10 — Isolate the Brick/RUT fix.** Backport only the Mercado Pago initialization and RUT validation behavior onto a branch based on the deployed front revision; exclude unrelated privacy work.
- [x] **T11 — Verify the targeted front.** Run focused wallet tests, the full unit suite, and a production build. Record the observed results.
- [ ] **T12 — Obtain the missing live inputs.** Record explicit authorization for 1,000 CLP, Mercado Pago production, a human-approved production card, and the payer RUT. Card values must come from a local protected file, never chat or reports.
- [ ] **T13 — Deploy and smoke-test.** Deploy the targeted front revision, confirm the Brick mounts, and verify the consent, amount, IVA-inclusive price, and RUT request before any order is created.
- [ ] **T14 — Complete one CDP purchase.** Use one unique idempotency key, submit the Brick token once, wait for the verified webhook, and avoid retries after a provider status exists.
- [ ] **T15 — Prove the credit.** Verify the order, voucher, balance delta, and exactly one `PURCHASE_CREDIT` movement for 1,000 credits.

### Acceptance criteria

- [ ] The Brick mounts on the live wallet and no longer shows the unavailable state.
- [ ] The exact total, variant, provider, environment, and consent are visible before the charge.
- [ ] Exactly one production order is created for 1,000 CLP.
- [ ] The balance increases by exactly 1,000 credits once, with one matching ledger movement.
- [ ] No card number, CVV, expiry, token, cookie, or bearer token appears in logs, reports, screenshots, commits, or Engram.
- [ ] A failed or pending provider status is reported honestly and never retried as a new charge.

### Applicable checks

| Check | Command | Result |
| --- | --- | --- |
| Focused wallet tests | `npx vitest run src/lib/platform/wallet.test.js` | passed — 83/83 tests in 1 file |
| Full unit suite | `npx vitest run` | passed — 547/547 tests in 36 files |
| Production build | `npm run build` | passed — 138 modules transformed; built in 1.38s (Vite reported a chunk-size warning) |
| Runtime harness | N/A | Browser/provider execution was intentionally not attempted: no authorized payer RUT or usable Mercado Pago production card fixture is available, and this work unit forbids provider authentication and purchases. |
| Live Brick smoke test | CDP against `https://metalgym88.djlabs.cl` | pending T13 |
| Provider/order proof | `GET /payments/orders/{orderId}` and voucher | pending T15 |
| Wallet proof | balance and credit movements | pending T15 |

### Route and controls

- Route: delegated direct.
- Trigger evidence: reading that prepares the write crossed the four-file boundary and was delegated to one mapper; the isolated fix and its checks will run in one bounded writer.
- TDD mode: OFF, resolved from repository evidence: no `strict_tdd` marker exists for this project. Runner: `npx vitest run`.
- Delivery strategy: `ask-on-risk`; forecast is below the approximately 400 authored-line budget, so no split or exception is currently required.
- Review candidate: the isolated work-unit commit, not the accumulated local `main`.

### Progress log

| When | What | Evidence |
| --- | --- | --- |
| 2026-11-19 | Live-path investigation | Active rail is Mercado Pago production; deployed Brick has an incomplete-identification defect; no usable MP production card fixture or payer RUT exists locally. |
| 2026-11-19 | T10–T11 isolated front correction | Branch `feat/mercadopago-live-purchase` is based at `5254b269`; the wallet now omits incomplete identification, requires a valid RUT before submission, and has focused regression coverage. The analytics-consent/privacy files from `f432411` are absent. Focused wallet tests passed 83/83, the full suite passed 547/547, and the production build passed. |

### Next step

T10–T11 are complete locally. Obtain the explicit live inputs required by T12 before any deployment, provider authentication, order creation, or purchase attempt. T13–T15 remain incomplete.
