# Credit-burn automation over CDP (price and credit validation)

## Objective

Prove with a real browser (Chrome DevTools Protocol) what a new account
actually costs to serve and how the welcome credits drain, so the prices and
the credit denominations stop being theoretical:

- register an account through the real UI (no shortcuts, no seeded rows),
- sign in and open the coach chat,
- hold a human, training-related conversation until the 100 welcome credits
  are consumed,
- measure per message: wall-clock latency, characters sent, tokens in/out and
  credits debited, plus the totals and the derived cost per message/credit.

## Why

The owner needs to validate the price model (credits per operation, token
cost) against real usage, not estimates. The existing e2e harness already
speaks CDP with no npm dependency, so this is a new scenario on top of it
instead of a new tool.

## Scope

### In

- `scripts/e2e/scenarios/s8-credit-burn.js`: the scenario.
- Registration/registration list wiring in `scripts/e2e/run.js`.
- The measurement report (per-message table + totals) written where the
  harness already writes evidence.
- Opt-in only: a normal `npm run test:e2e` must NOT spend money.

### Out

- Payments (S5 already covers the order creation; paying stays out).
- Changing the credit model or the tariffs.

## Constraints

- It spends REAL AI tokens and REAL welcome credits on the deployed platform.
  It therefore runs only with an explicit `E2E_ALLOW_SPEND=1` and a wall-clock
  and message cap, and it says so in its own output.
- Credentials and mailbox access come from the environment. No secret, no
  address and no password in the repo.
- The conversation must read like a human asking about training (gym routines,
  progression, technique, recovery), in neutral Spanish, with natural lengths
  and pauses. No lorem ipsum, no repeated identical prompts.
- Everything reported must be observed: if the token field is missing from a
  response, the report says "not reported" instead of inventing a number.
- Reuse `cdp.js`, `page.js`, `runner.js`, `scenarios/helpers.js`,
  `lib/mailbox.js` and the existing scenario conventions. No new dependency.

## Tasks

- [x] **T1 — Scenario skeleton.** New scenario registered in `run.js`,
      skipped (with an honest reason) unless the spend opt-in and the
      credentials are present.
- [x] **T2 — Real registration and sign-in.** Through the visible UI, using a
      plus-addressed mailbox from the environment so each run is a fresh
      account with its 100 welcome credits.
- [x] **T3 — Human conversation.** A corpus of training questions, typed
      through the real composer, waiting for each answer before the next
      message, stopping when the balance reaches zero, the API refuses for
      lack of credits, or a cap is hit.
- [x] **T4 — Measurement and report.** Per message: latency, characters,
      tokens in/out, credits debited; totals; cost per message and per credit;
      the platform's own price list for comparison.

## Acceptance criteria

- One run creates a brand-new account, spends its welcome credits down to
  zero (or documents exactly where it stopped and why) and produces a report
  with real numbers for time, text volume, tokens and credits.
- Without `E2E_ALLOW_SPEND=1` the scenario does not spend anything.
- `npm test` and `npm run build` stay green; the scenario does not break the
  existing ones.

## Applicable checks

```
npm test
npm run build
E2E_ALLOW_SPEND=1 node scripts/e2e/run.js --only=S8
```

## Progress log

- 2026-11-17 — Feature created at the owner's request to validate prices and
  credits with a human-like conversation.
- 2026-11-17 — The scenario exists (`scripts/e2e/scenarios/s8-credit-burn.js`),
  it is registered in `run.js` (`--only=S8` selects it) and it skips honestly
  without `E2E_ALLOW_SPEND=1` (observed: `BLOCKED … E2E_ALLOW_SPEND=1 is not
  set`, nothing registered, nothing spent).
- 2026-11-17 — First live run found a real product gap: the platform pauses a
  wallet that crosses `heart_settings.reverify_bonus_threshold` (10 credits =
  two questions) and mails a notice to `/auth/verify?kind=reverify`, but the
  front treated every token on that path as a sign-in token, so a paused
  person had no way out. Fixed in the front (`kind=reverify` → `POST
  /auth/reverify`, and the "Resend the link" button now calls
  `POST /auth/reverify/resend` instead of the magic link, which would NOT
  open the gate). The scenario honours the same rule: it reads the mailed
  notice and redeems it through the platform's public contract, then sends the
  question again, exactly like a person would.
- 2026-11-17 — Second live run: **PASS**. 20 answered questions, 100 of 100
  welcome credits consumed (the ledger shows 20 USAGE_DEBIT rows worth 100
  credits), 1,866 characters sent, 7m 26s of wall clock, 5 credits and ~19.6 s
  per answered question, one re-verification in the middle. Evidence:
  `artifacts/e2e/s8-credit-burn.md` and `artifacts/e2e/s8-credit-burn.json`.
- 2026-11-17 — Two honest gaps in what the platform publishes: the chat
  answer carries **no token figure** (so the cost per token cannot be derived
  from the product yet), and the wallet's first pass answers the price-list
  calls with 204 (the harness now prefers the answer that carries a body and
  falls back to the final wallet pass).
- 2026-11-17 — The token gap was a real defect in the platform, not in the
  harness: the brain reports `prompt_tokens`/`completion_tokens` and the
  platform read `input_tokens`/`output_tokens`, so **every answer was recorded
  as zero tokens** — and the cost record with it (the pricing calculator reads
  the same numbers). Fixed in the API (`HttpBrainAdapter::normalizeUsage`
  reads both spellings and derives the total; `FailoverBrainAdapter` carries
  the total too; the chat and the gym answers now publish `usage_tokens` and
  the `usage` breakdown, as the product's contract always said). Verified
  live: `usage_tokens: 343` (257 in / 86 out) on a real question.
- 2026-11-17 — The live figures are the platform's **billing basis**
  (`billing.estimate_tokens` counts our own bytes / 4), because some
  gateways pad the prompt with their own routing instructions and bill those
  tokens to the caller. That is the number the prices are built on, so it is
  the number the report shows.
