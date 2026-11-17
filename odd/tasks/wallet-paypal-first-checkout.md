# Wallet: PayPal-first checkout, USD packs, same-window flow, grouped movements

## Objective

The owner must be able to test the PayPal (USD) rail from the app without a
PayPal account and without leaving the app window:

- PayPal/USD is the first payment method (already live through the allowlisted
  sandbox window in the API).
- The USD option shows the SAME three top-up amounts as CLP, expressed in
  dollars (the API owns the price and credits per variant).
- The payment gateway never opens in a new window: the flow continues in the
  same window.
- The buyer can pay with a card directly (no PayPal account registration):
  the card fields are rendered by PayPal's JS SDK inside our page, the card
  token goes to the API, and the API creates + captures the order server-side.
- The wallet movements are grouped by date, with the group total and the usage
  type, so the list is readable instead of endless.

## Problem

Today the wallet shows CLP packs (1.000 / 5.000 / 10.000) plus a free amount
field, while USD shows a single variant button. The redirect flow opens the
gateway in a new tab and PayPal's hosted page asks for an email and offers
"open an account". The movements list is a flat, long list.

## Why

The owner is testing the gateway end to end and needs the real buying
experience: pick a pack, type the card, pay, stay in the app.

## Scope

### In

- `src/components/Wallet.jsx` + `src/lib/platform/wallet.js`: USD packs, the
  same-window flow, the card form, the grouped movements.
- `src/locales/es.js`: the new Spanish copy (and the English source strings).
- The front's tests (`src/lib/platform/wallet.test.js` and any component
  test) and the strict locale test.
- The API (separate repo, separate task): the card order endpoint.

### Out

- Live PayPal credentials (still pending; the sandbox window stays allowlisted).
- The webhook endpoint registration.
- The API's own served panel and the ATSCV front (same pattern, separate task).

## Constraints

- The API owns the price and the credits for USD: the client sends a
  `variant_id`, never an amount. The three USD packs come from the API quote
  (`currencies[].variants`), so the front renders whatever the server offers.
- The gateway URL is always followed in the same window (`location.assign`),
  never `window.open`. The wallet polls the order status after the return.
- The card data never touches our server: PayPal's JS SDK renders the fields
  and returns a token; only the token is sent to the API.
- Copy in `src/locales/es.js` (neutral/professional Spanish). Code, comments
  and identifiers in English.
- No provider names in user-facing copy unless the server names them.

## Tasks

- [x] **T1 — USD packs like CLP.** When the selected currency is USD, render
      the quote's USD variants as the same pack row as CLP (price in dollars,
      credits below), and keep the server-owned price. The custom amount field
      stays CLP-only (USD prices come from the server variants).
- [x] **T2 — Same-window flow.** The pay button navigates in the same window
      (`location.assign(order.redirect_url)`); no `window.open`, no polling tab.
      The copy that announces "the payment screen opens in another tab" is
      removed. After the gateway returns, the wallet reads the order status
      (the existing return handling already does).
- [x] **T3 — Card-first checkout.** Load PayPal's JS SDK (`card-fields`
      component) with the client id the API exposes, render the card fields
      inside the wallet sheet, create a token and post it to the API's card
      order endpoint. The wallet stays in place and shows the result. The
      hosted PayPal account page is no longer used for the USD rail.
- [x] **T4 — Movements grouped by date.** Group the movements by calendar day,
      show the group header with the day's net total and the usage type
      (top-up vs. use), and list the movements of that day under it. Keep the
      pagination ("load more") working.

## Acceptance criteria

- With the USD currency selected, the wallet shows three dollar packs taken
  from the API quote and the button states the dollar amount and the credits.
- Pressing pay never opens a new tab; the whole flow stays in one window.
- A card payment completes without any PayPal account page, and the credits
  are credited server-side (the order status turns approved).
- The movements list is grouped by date with the group total and the type.
- The front's test suite (unit + locale strictness) is green, and the build
  succeeds.

## Applicable checks

```
npm test
npm run build
```

(Report the real output of each.)

## Route

Delegated direct (the front changes touch several non-trivial files: the
wallet component, the platform library, the locales and their tests).

## Progress log

- 2026-11-17 — Feature created after the owner reported the USD option not
  matching the CLP option, the gateway opening in a new tab, PayPal asking for
  an account, and the movements list being too long.

- 2026-11-17 — Work unit on `feat/wallet-paypal-first`: USD packs read from
  `price_usd_cents`, the gateway followed in the same window (`location.assign`,
  no `window.open`), PayPal card fields rendered lazily inside the wallet with
  a token-only `POST /payments/orders/card`, and movements grouped by day with
  the group net and per-type breakdown. `npm test`: 33 files / 496 tests passed.
  `npm run build`: ok (pre-existing chunk-size warning only).
  Limit observed up front: no live card capture was exercised — it needs the
  API's card endpoint and `quote.paypal.client_id` from the parallel work unit.
  Without the client id (or if the SDK fails to load) the card form stays off,
  the wallet says so, and the buy button uses the same-window redirect.
  Work-unit commit: `d42832e` (this entry records the hash it produced).
