# Feature: PayPal sandbox card rail, proved end to end by the CDP suite

## Objective

Prove, with automated evidence on the live deployment, that the USD rail pays
with a card inside our own window (no PayPal account), in **sandbox** mode:

- the wallet shows the USD packs and the PayPal card fields mount,
- the card token is sent to `POST /payments/orders/card` with an
  `Idempotency-Key`, and the raw card data never leaves the browser,
- the order comes back `APPROVED` with the expected credits,
- the ledger shows the `PURCHASE_CREDIT` movement and the balance grew by the
  credited amount.

## Problem

The card rail is implemented and live, but nothing has ever paid with a card
end to end. The obstacles to automating that proof:

- The sandbox rail is gated by `payments.paypal.sandbox_test_users`, matched
  by **exact email** (no domain or wildcard). The CDP harness creates a random
  disposable inbox on every run, so its user is never allowlisted: the quote
  returns USD `available: false` and the card order answers `409
  PAYMENT_RAIL_UNAVAILABLE`.
- PayPal's card fields live in a **cross-origin iframe** owned by PayPal. The
  harness can only fill inputs in the main document (`page.fill`), and it
  discards the child target sessions it receives from `Target.attachedToTarget`.
- The suite has no payment-mutation gate for PayPal, and its redaction rules
  do not cover `card_token`.

## Why

The owner is about to enable the live rail. Before that, the sandbox rail has
to be proven with a real card payment, so "it works" is not a belief but a
recorded run.

## Scope

### In

- A pinned, pre-created mailbox for the suite (`E2E_MAIL_ADDRESS` /
  `E2E_MAIL_PASSWORD`), so the harness identity is stable and can be
  allowlisted.
- The pinned mailbox address added to `payments.paypal.sandbox_test_users` in
  the API's live config (sandbox only).
- Frame-scoped CDP helpers (child target sessions, `DOM.querySelector`,
  `DOM.focus`, `Input.insertText`) to type into PayPal's own frames.
- Scenario **S9 — PayPal sandbox card**: sign in, open the wallet, assert the
  quote (sandbox, USD available, variants), pay with the sandbox test card,
  assert the approved order, then assert the ledger and the balance.
- A dedicated opt-in flag `E2E_ALLOW_PAYPAL_SANDBOX=1` and a `card_token`
  redaction rule.
- The suite README documents the scenario, the flag and the sandbox-only
  boundary.

### Out

- Live PayPal credentials, the live environment and the webhook id.
- Any change to the API's payment logic, routes or provider code.
- Standard Checkout (hosted PayPal page) and the 3DS challenge handling: a
  `PAYMENT_PENDING` (202) is reported as `BLOCKED`, never retried.
- Screenshots of a filled card form (never).

## Constraints

- Sandbox only. The scenario refuses to run unless the quote reports
  `paypal.environment === "sandbox"`.
- No secret ever reaches a report, a log or the repository: no client secret,
  no card number, no CVV, no `card_token`.
- The card data is typed by the browser into PayPal's frames; only PayPal's
  single-use token is sent to our API.
- The API owns the price and the credits: the scenario reads the variant from
  the quote and never invents an amount.
- Technical artifacts (code, comments, docs) in English.

## Tasks

- [x] **T1 — Pinned mailbox.** The suite can authenticate a pre-created
      mailbox instead of creating a random one on every run.
- [x] **T2 — Sandbox allowlist.** The pinned address is an exact entry in the
      API's live `payments.paypal.sandbox_test_users`.
- [x] **T3 — Frame-scoped input.** The harness keeps the child target sessions
      and can type into a cross-origin iframe's field.
- [x] **T4 — S9 scenario.** The full journey, gated by
      `E2E_ALLOW_PAYPAL_SANDBOX=1`, with safe evidence only.
- [x] **T5 — Safety and docs.** `card_token` redaction plus the README
      section.
- [ ] **T6 — Proof.** The scenario runs green against the live deployment and
      the artifacts (report + screenshot) are committed as evidence. **BLOCKED
      by PayPal:** the sandbox SDK reports that card payments are not eligible.

## Acceptance criteria

- `E2E_ALLOW_PAYPAL_SANDBOX=1 node scripts/e2e/run.js --only=S9` ends `PASS`
  against `https://metaigym88.djlabs.cl` with: the order id, the provider order
  id, the credited amount, the balance delta and the ledger movement type.
- Without the flag the scenario ends `BLOCKED` and creates no order.
- No report, log or artifact contains the card number, the CVV, the expiry or
  the card token.

## Applicable checks

```
npx vitest run                       # the front suite plus the harness unit tests
node --check scripts/e2e/scenarios/s9-paypal-card-sandbox.js
node --check scripts/e2e/page.js && node --check scripts/e2e/run.js && node --check scripts/e2e/lib/mailbox.js
E2E_ALLOW_PAYPAL_SANDBOX=1 node scripts/e2e/run.js --only=S9
```

(Report the real output of each.)

## Route

Delegated direct. The change touches the harness (page/CDP plumbing), the
mailbox helper, a new scenario, the redaction rules and the README. It was
split into reviewable work-unit commits instead of one oversized commit.

## Progress log

- 2026-11-17 — Feature created after the owner authorized the sandbox test
  ("do it with sandbox; I'll tell you when to enable live"). The CSP that
  blocked PayPal's SDK and its iframe was relaxed and is live
  (`43384d8`); the sandbox credentials are already in the API's live config,
  so no new credential is needed. The harness mapping (read-only) found three
  blockers: the random inbox cannot be allowlisted, the cross-origin iframe
  cannot be typed into, and there is no payment opt-in gate.
- 2026-11-17 — Engram mirror **pending**: the Engram server is unreachable in
  this session (`mem_save` and `mem_session_summary` fail), so this file is
  the only copy until the mirror can be written.
- 2026-11-18 — T1/T3 implementation completed. The suite now authenticates the
  pinned mailbox when `E2E_MAIL_ADDRESS` and `E2E_MAIL_PASSWORD` are present
  and keeps the historical random inbox otherwise. Chrome's flattened child
  session id arrives in `Target.attachedToTarget.params.sessionId`; the
  harness now retains that session, enables page-scoped auto-attach, finds
  fields by their semantic attributes and drives them with `DOM.getDocument`,
  `DOM.querySelector`, `DOM.focus` and `Input.insertText` on the same session.
  A local two-origin CDP probe proved the four-field classification and text
  insertion path.
- 2026-11-18 — T4/T5 implementation completed. S9 is opt-in through
  `E2E_ALLOW_PAYPAL_SANDBOX=1`, refuses anything except a sandbox quote,
  selects the lowest-priced credited USD variant from that quote, checks the
  order request without publishing its body, and asserts the approved order,
  balance delta and `PURCHASE_CREDIT` movement when PayPal lets the fields
  mount. The card fixture is read from external environment variables and is
  absent from the repository. Reports now redact `card_token`, nested URL
  secrets and the provider client id; the fallback screenshot masks the
  mailbox identity.
- 2026-11-18 — Verification: both `node --check` command groups exited 0;
  the focused harness tests passed 11/11; `npx vitest run` passed 511/512 on
  its first pass and exposed the quoted-JSON `card_token` redaction gap, which
  was fixed. The final full-suite run passed 513/513.
- 2026-11-18 — Live S9 result: **BLOCKED**, not PASS. The authenticated quote
  answered HTTP 200 with PayPal `environment=sandbox`, USD available and
  credited variants, but PayPal's sandbox SDK rejected the card fields with
  `card payments are not eligible`. No card value was typed, no
  `POST /payments/orders/card` was sent and no order or credit movement was
  created. The safe report and masked screenshot remain under
  `artifacts/e2e/`; T6 stays open until the sandbox client is made eligible.
- 2026-11-18 — Final verification after the implementation work units
  (`d2a577e`, `ca822bf`, `247b860`, `aa4e1b3` and `16f3a82`): both
  `node --check` command groups exited 0; `npx vitest run` passed 36/36 test
  files and 513/513 tests; the opted-in live S9 run ended
  `0 PASS · 0 FAIL · 1 BLOCKED` after 41.8s with the same PayPal eligibility
  refusal. An exact-value scan of both reports found no mailbox credential,
  card fixture value or `card_token`, and no `POST /payments/orders/card`;
  the blocked-state screenshot masks the account name and address. No order id,
  provider order id, credit delta or `PURCHASE_CREDIT` movement exists, so T6
  remains open. The commits are local and were not pushed.
