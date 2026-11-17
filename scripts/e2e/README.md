# metalgym88 E2E (Chrome DevTools Protocol)

An end-to-end suite that drives the **public deployment** with a real browser
and reports what actually happened — no npm dependency, no test runner, no
mocking: the suite talks to `https://metaigym88.djlabs.cl/` and to the real
platform at `https://api.djlabs.cl`.

## Run it

```bash
node scripts/e2e/run.js                 # every scenario
node scripts/e2e/run.js S1 S7           # only these scenarios
node scripts/e2e/run.js --only=S8       # the same, by flag (comma lists work: --only=S5,S8)
node scripts/e2e/probe-api.js           # one-off: what does the browser see from the platform?
```

The reports land in `artifacts/e2e/` (git-ignored):

- `report.md` — for humans: one table plus the evidence of every scenario.
- `report.json` — the same content, machine-readable.
- `screenshots/` — one PNG per proven step.

Exit code `0` means the suite ran; the verdicts live in the report. A
non-zero exit means the harness itself could not run.

## The harness

| File | What it owns |
|------|--------------|
| `cdp.js` | Chrome launch (`--headless=new`, a free debugging port, a throwaway profile) and the CDP client over the `WebSocket` Node 22 ships with. |
| `page.js` | The page helpers: navigation, condition-based waits, text-based interaction, console/network capture, screenshots, CORS diagnosis. |
| `runner.js` | The scenario loop, the PASS/FAIL/BLOCKED table and the two reports. |
| `config.js` | The fixed coordinates (origin, platform host, heart) and the visible strings the suite looks for. |
| `redact.js` | The redaction of tokens, cookies and one-shot links before anything reaches a report. |
| `lib/mailbox.js` | The disposable inbox (mail.tm, public API, no key) that reads the real magic-link email. |
| `lib/net.js` | HTTP with bounded retries and a TLS reachability probe. |
| `scenarios/` | The journeys themselves, one file per scenario. |

## How a verdict is decided

| Verdict | Meaning |
|---------|---------|
| `PASS` | The journey ran and every assertion held. |
| `FAIL` | The product did something wrong (a broken call, a wrong answer, a dead link). |
| `BLOCKED` | The suite could not finish the journey for a reason outside the product (no mail arrived, the payment gateway needs a human, a step never happened in time). |

A blocked scenario is **never** reported as a pass, and a scenario that proves
a defect returns `FAIL` with the evidence that proves it.

The suite never completes a real payment and never asks for a card: the
gateway hand-off is recorded (the URL the app hands over) and the last leg is
left to a human.

## S8 — the credit burn (opt-in, spends real credits)

S8 is the only scenario that **spends**. It registers a brand-new account
through the visible landing form, reads the real magic-link email, opens the
coach and holds a human, training-related conversation in Spanish until the
welcome credits run out. It is twice gated:

- `E2E_ALLOW_SPEND=1` must be set, or it returns `BLOCKED` with
  `skipped — E2E_ALLOW_SPEND=1 is not set` and touches nothing.
- The disposable inbox must be reachable; otherwise it says exactly why and
  stops before registering.

```bash
E2E_ALLOW_SPEND=1 node scripts/e2e/run.js --only=S8
```

Optional knobs (all bounded, nothing is unbounded by accident):

| Variable | Default | Meaning |
|----------|---------|---------|
| `E2E_BURN_MAX_MESSAGES` | `40` | Stop after this many answered questions. |
| `E2E_BURN_MAX_SECONDS` | `900` | Stop after this much wall-clock time. |
| `E2E_BURN_ANSWER_TIMEOUT_MS` | `120000` | Per-answer bound. |
| `E2E_BURN_NAME` | `Camila` | The name the first question introduces. |
| `E2E_BURN_EMAIL` | `mg88e2e` | Local part of the fresh plus-addressed inbox. |

It stops on a zero balance, a `402`, a `429`, a session expiry, an empty
answer, the message cap or the time cap, and reports exactly where and why.
The evidence lands in `artifacts/e2e/s8-credit-burn.md` (per-message table
plus totals) and `s8-credit-burn.json`. Every number is observed: tokens come
from the response when the platform reports them (**"not reported"**
otherwise), credits come from the balance deltas, and the CLP price comes from
the wallet's own `/tariffs`, `/payments/limits` and `/payments/quote`
answers — never from a constant in the scenario.

## Interaction rules

- The UI is in Spanish and its wording may change, so the selectors are built
  from **visible text**, plus a CSS scope only where the same phrase appears
  twice on screen.
- Interaction goes through `Runtime.evaluate` and real DOM events: a genuine
  `.click()` and the native value setter plus `input`/`change` events, so
  React sees the change exactly as it would from a person typing.
- Every wait is **condition-based with a bound**. There are no sleeps: the
  suite waits for a text, a request or a response to appear and gives up at a
  deadline it states out loud.
- Chrome is always closed, even when a scenario blows up.

## The CORS diagnosis

A platform call that the browser refuses is neither a timeout nor a flake: the
request never leaves the page. `page.corsDiagnosisFor()` reads the console
sentence the browser wrote and the preflight the platform answered, and the
scenarios turn that into a `FAIL` with the whole diagnosis instead of a
20-second wait that ends in "no response".

## Writing a scenario

```js
export default {
  id: 'SX',
  title: 'What the journey proves',
  async run({ page, context, log }) {
    const evidence = []
    await page.goto(`${BASE_URL}/`)
    await page.expectText('Escríbenos', 20000)
    // … drive the page, prove the outcome, collect the evidence …
    return { reason: 'what was proven', evidence, screenshots: [] }
  },
}
```

Use `awaitResponse()` / `platformResponse()` from `scenarios/helpers.js` for
every platform call: they wait with a bound, they fail fast on a CORS refusal
and they time out with the requests they were waiting for.
