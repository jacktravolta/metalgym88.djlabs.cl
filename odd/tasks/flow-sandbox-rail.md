# Flow sandbox rail: a gateway that opens and an honest cancel message

The Flow (CLP) rail now points at Flow's sandbox, only offers amounts the gateway
actually accepts, and reports a canceled payment as canceled instead of as a
registered recharge.

## Problem

| Symptom | Cause |
| --- | --- |
| The 100 CLP pack never opened the payment page | 100 CLP is below Flow's own minimum (350 CLP), so the order was rejected before the gateway was reached |
| The wallet offered any CLP amount | A free "Other amount (CLP)" field let the person pick an amount the gateway cannot take |
| "Your recharge is registered" after canceling | The voucher kept the local PENDING state and never asked Flow what really happened |
| The rail pointed at production | `https://www.flow.cl/api` was live even though no real payment had ever been tested |

## Why

A payment page that never opens is the worst possible outcome: the person is
asked for money and gets nothing in return. And a recharge that is reported as
"registered" when it was canceled teaches people not to believe the wallet —
which is exactly the trust this product is built on.

## Scope

### In

- Flow rail on sandbox (`https://sandbox.flow.cl/api`) with the sandbox
  credentials; production credentials preserved outside the repo (mode 600) so
  the switch back is one file edit.
- `payments.limits.min_clp = 350` in the live config, and the front's CLP pack
  list starts at 350 CLP.
- The free "Other amount (CLP)" field and its dead locale key are gone.
- The voucher asks Flow for the real status of a pending order, so a canceled
  or rejected payment reads as such — and is never credited from that path.
- One end-to-end sandbox payment with the sandbox test card.

### Out

- Live PayPal credentials and ACDC approval.
- Flow's webhook wiring: `urlConfirmation` travels with each order, so no
  dashboard change is needed.
- Rotating the Flow sandbox secret pasted in chat (owner action; sandbox only).

## Tasks

- [x] **T1 — Switch the Flow rail to sandbox.** Config points at
  `https://sandbox.flow.cl/api` with the sandbox credentials; the production
  pair is backed up outside the repo.
- [x] **T2 — Offer only payable amounts.** `min_clp = 350`; the CLP packs start
  at 350 CLP; the free amount field is removed from the wallet and the locale.
- [x] **T3 — Report a canceled payment honestly.** `PaymentService::getVoucher()`
  reads Flow's status for a pending order and maps 3 → REJECTED, 4 → CANCELED.
- [x] **T4 — Complete one sandbox payment end to end.** Sandbox order → sandbox
  checkout → approved → credits in the balance (webhook path).
- [x] **T5 — Publish the front change.**
- [x] **T6 — PayPal cancel returns to the app.** The PayPal `cancel_url` points
  at the heart's wallet with `pago=cancelled`, and the front honors that state.

## Acceptance criteria

- [x] Every CLP amount the wallet offers can open the Flow payment page.
- [x] The wallet offers no amount the gateway rejects.
- [x] A canceled Flow payment never shows a "registered recharge" message and
      never credits the wallet.
- [x] A canceled Flow payment tells the person what happened and what they can
      do next, in the platform's calm, non-blaming tone.
- [x] No production credential is left in the live config while the sandbox is
      under test.

## Applicable checks

| Check | Command | Result |
| --- | --- | --- |
| Front unit tests | `npx vitest run src/lib/platform/wallet.test.js src/lib/locales.test.js` | 51 passed |
| Front full suite | `npx vitest run` | 36 files, 521 tests passed |
| Front build | `npm run build` | built in 2.32s |
| Sandbox order | `POST /payments/orders` (amount_clp 350) | HTTP 200, `sandbox.flow.cl/app/web/pay.php?token=…` |
| Sandbox payment | headless Chrome on the sandbox checkout | `pago=approved&orden=…&monto=350` back on the front |
| Credit path | `GET /credits/balance?heart=metalgym88` | **450** (100 welcome + 350 purchased), movement `PURCHASE_CREDIT` 350 |
| API voucher test | `php tests/payment_voucher_flow_status_test.php` | exit 0 — 11 assertions, 0 failures |
| PayPal cancel (browser) | headless Chrome on the sandbox approval page | lands on `metaigym88.djlabs.cl/?orden=…&pago=cancelled#/wallet` |
| PayPal provider test | `php tests/paypal_provider_test.php` | exit 0 — 37 assertions, 0 failures |


## Route

Delegated direct. The front change is mechanical and already understood
(three edits in two files), so it stays inline; the API voucher fix touches
the service plus its test, so it goes to one bounded writer.

## Progress log

| When | What | Evidence |
| --- | --- | --- |
| 2026-11-17 | T1 done | `flow.base_url = https://sandbox.flow.cl/api`, sandbox secret length 40, production pair saved to `/home/test/.config/metalgym88-e2e/flow-production.env` (600) |
| 2026-11-17 | Root cause of "Invalid Signature" | The provider signs in **hex** (`hash_hmac` without `$binary`), not base64. A control signed with the production pair returns HTTP 200 + token; the transcribed sandbox secret was missing one character (`…bccbf72d461…`). |
| 2026-11-17 | T2 done | Front commit `4914ee8`; `npx vitest run` 51 passed, `npm run build` ok |
| 2026-11-18 | T3 done | API commit `fc8e7b3`: a pending Flow voucher read now asks the gateway, persists CANCELED/REJECTED, surfaces APPROVED WITHOUT crediting, and falls back to pending when the gateway is unreachable (3s bound). Hermetic test: 11 assertions, 0 failures. |
| 2026-11-18 | T4 done | A real sandbox order (`e0c94d56…`, 350 CLP) was paid with the sandbox card: the browser returned `?pago=approved&orden=…&monto=350#/wallet`, the signed webhook posted `POST /payments/webhook/flow` (200), and the wallet shows **450 credits** with the movement `PURCHASE_CREDIT 350`. |
| 2026-11-18 | T6 done | The PayPal cancel landed on `https://metaigym88.djlabs.cl/?orden=…&pago=cancelled#/wallet` — before the fix it landed on `https://api.djlabs.cl/login?order=…&token=…`. API commit `4e580a5` (return/cancel URLs resolve the heart's front, never the API origin); front commit `426f2cc` (the front reads `?pago=` and reports the canceled kind). |
| 2026-11-18 | Front published | `4914ee8` + `426f2cc` pushed to `origin/main` and to the feature branch |
| 2026-11-18 | API money-path hardening | API commit `73f59b1`: a provider token that matches MORE THAN ONE order now resolves no order (fail closed) instead of crediting an arbitrary wallet. The normal path is unchanged; the log records only how many orders matched, never the token or buyer data. Test: `tests/payment_webhook_token_ambiguity_test.php` (13 asserts). |
| 2026-11-18 | Test drift fixed | API commit `93a0604`: the recharge limits in the tests come from the configuration and the voucher test is hermetic (local mock Flow, no network, no credentials). |

## Next step

Live PayPal stays off until the sandbox merchant is eligible for card payments
(PayPal answered `card payments are not eligible`), and the production Flow
pair goes back when the owner says so.

## Known follow-ups

| Item | Owner |
| --- | --- |
| PayPal sandbox says `card payments are not eligible`: the USD card rail needs the merchant enabled for ACDC (Card Fields). The hosted fallback works and its cancel now returns to the app. | Owner (PayPal dashboard) |
| The Flow sandbox secret was pasted in chat: rotate it before the sandbox account is shared. | Owner |
| `tests/t16_voucher_test.php` and `tests/payment_flow_test.php` were drifting from the live configuration (a hardcoded 1,000 CLP minimum, and a test that hit the real gateway). Fixed in API commit `93a0604`: the limits now come from the configuration and the voucher test runs against the local mock Flow. | Done |
| Live PayPal credentials, the `WH-…` webhook id and ACDC approval for the live account. | Owner |

