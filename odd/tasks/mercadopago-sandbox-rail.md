# Mercado Pago sandbox rail — operator runbook

Scope: the Mercado Pago card rail (Checkout API via Payments API + Card Payment Brick) on
`metalgym88.djlabs.cl` + `api.djlabs.cl`. This is the operator checklist for taking the
rail from "code merged" to "credits arriving in the wallet". Everything below was verified
against the live gateway on 2026-11-18.

## 1. The credential model (verified — read this first)

| Credential pair | Reads the API | Creates payments |
|---|---|---|
| Development pair (`APP_USR-3645…`, `TESTUSER…` account) | yes | **no** — 401 `Unauthorized use of live credentials` (cause code 7) on every `POST /v1/payments`, offline methods included |
| Production pair (`APP_USR-6339…`, account `1152415668`, site `MLC`) | yes | **yes** — real payments are created |

Mercado Pago Chile does not support test credentials for the Checkout API card flow, and
there is no `api.sandbox.mercadopago.com` anymore: one host, `api.mercadopago.com`, and the
credential selects the mode. The development pair is still useful for reading (payment
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
      and `payments.provider = 'mercadopago'`, `payments.default_currency = 'CLP'`.
- [ ] Front deployed with the Brick, the CSP allowance for the Mercado Pago SDK and the
      legal consent checkbox.
- [ ] `payments.mercadopago.public_key` + `access_token` set in the server config
      (never in the repo, never in the browser bundle).
- [ ] `payments.mercadopago.webhook_secret` set — **pending**: reveal it in the panel
      (Webhooks → reveal key). With an empty secret the webhook fails closed on purpose:
      401, no credit, loud log.
- [ ] Webhook registered in the panel with the URL
      `https://api.djlabs.cl/payments/webhook/mercadopago` and the payment events
      (`payment.updated`, `payment.created`).

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
| `401 Unauthorized use of live credentials` on `POST /v1/payments` | the development credential pair was used | use the production pair; there is no test-credential path for card payments in CL |
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
