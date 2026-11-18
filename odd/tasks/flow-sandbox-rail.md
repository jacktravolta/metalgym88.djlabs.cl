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
- [ ] **T3 — Report a canceled payment honestly.** `PaymentService::getVoucher()`
  reads Flow's status for a pending order and maps 3 → REJECTED, 4 → CANCELED.
- [ ] **T4 — Complete one sandbox payment end to end.** Sandbox order → sandbox
  checkout → approved → credits in the balance (webhook path).
- [ ] **T5 — Publish the front change.**

## Acceptance criteria

- [ ] Every CLP amount the wallet offers can open the Flow payment page.
- [ ] The wallet offers no amount the gateway rejects.
- [ ] A canceled Flow payment never shows a "registered recharge" message and
      never credits the wallet.
- [ ] A canceled Flow payment tells the person what happened and what they can
      do next, in the platform's calm, non-blaming tone.
- [ ] No production credential is left in the live config while the sandbox is
      under test.

## Applicable checks

| Check | Command | Result |
| --- | --- | --- |
| Front unit tests | `npx vitest run src/lib/platform/wallet.test.js src/lib/locales.test.js` | 51 passed |
| Front build | `npm run build` | built in 1.79s |
| Sandbox order | `POST /payments/orders` (amount_clp 350) | HTTP 200, `sandbox.flow.cl/app/web/pay.php?token=…` |
| API voucher test | `php tests/<cancel-voucher>_test.php` | pending (T3) |
| Sandbox payment | sandbox checkout with the test card | pending (T4) |

## Route

Delegated direct. The front change is mechanical and already understood
(three edits in two files), so it stays inline; the API voucher fix touches
the service plus its test, so it goes to one bounded writer.

## Progress log

| When | What | Evidence |
| --- | --- | --- |
| 2026-11-17 | T1 done | `flow.base_url = https://sandbox.flow.cl/api`, sandbox secret length 40, production pair saved to `/home/test/.config/metalgym88-e2e/flow-production.env` (600) |
| 2026-11-17 | Root cause of "Invalid Signature" | The provider signs in **hex** (`hash_hmac` without `$binary`), not base64. A control signed with the production pair returns HTTP 200 + token; the transcribed sandbox secret was missing one character (`…bccbf72d461…`). |
| 2026-11-17 | T2 done | Front commit below; `npx vitest run` 51 passed, `npm run build` ok |
| 2026-11-18 | Front commit | _pending_ |

## Next step

T3 — the API writer fixes `getVoucher()` and adds its test.
