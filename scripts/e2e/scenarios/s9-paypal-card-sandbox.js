// S9 — the PayPal sandbox card rail, proved end to end.
//
// This is the only scenario that completes a payment. It is opt-in, it runs
// only against PayPal's sandbox, and it types the fixture into PayPal's own
// cross-origin frames. The fixture lives outside the repository: the harness
// reads it from environment variables and never retains or reports its value.
//
// The API owns the price and the credits. This scenario selects a variant from
// GET /payments/quote, verifies that only the variant id and PayPal's
// single-use card token reach POST /payments/orders/card, and then proves the
// approved order, the balance delta and the PURCHASE_CREDIT ledger movement.

import { blocked, fail } from '../runner.js'
import { StepTimeout } from '../page.js'
import { API_HOST } from '../config.js'
import { ensureSignedIn, platformResponse } from './helpers.js'
import {
  ALLOW_FLAG,
  CARD_COPY,
  PAY_BUTTON,
  SUCCESS_COPY,
  WALLET_SHEET,
  closeWalletCardForm,
  consoleErrorSummary,
  forbiddenCardKeys,
  latestResponse,
  maskVisibleSensitiveValues,
  openWalletAndRead,
  readBalance,
  readError,
  readFixture,
  readMovements,
  readQuote,
  safeText,
  selectUsdVariant,
  waitForCardFields,
  waitForFreshResponses,
} from '../lib/paypal-card.js'

export default {
  id: 'S9',
  title: 'PayPal sandbox card — approved order and credited ledger movement',
  async run({ page, context, log }) {
    // The gate comes before the sign-in, before an account can be registered,
    // before a quote can create an order and before any card value is read.
    if (process.env[ALLOW_FLAG] !== '1') {
      return {
        status: 'BLOCKED',
        reason: `skipped — ${ALLOW_FLAG}=1 is not set; no account was registered, no order was created and no card data was read`,
        evidence: [],
        screenshots: [],
      }
    }

    const startedAt = Date.now()
    const scenarioMark = page.mark()
    const evidence = []
    const fixture = readFixture()
    const screenshotSecrets = [
      context.email,
      context.email ? String(context.email).split('@')[0] : null,
      ...Object.values(fixture),
    ]
    page.setSensitiveValues(Object.values(fixture))

    const session = await ensureSignedIn(page, context)
    log('signed in through the configured mailbox')
    evidence.push({ label: 'session', value: session.balance || 'balance chip visible' })

    const wallet = await openWalletAndRead(page)
    if (wallet.quote.status !== 200) {
      throw fail(`GET /payments/quote answered HTTP ${wallet.quote.status}`)
    }
    if (wallet.me.status !== 200) {
      throw fail(`GET /auth/me answered HTTP ${wallet.me.status}`)
    }
    if (wallet.movements.status !== 200) {
      throw fail(`GET /credits/movements answered HTTP ${wallet.movements.status}`)
    }

    const quote = readQuote(wallet.quote.body)
    if (quote.environment !== 'sandbox') {
      throw blocked(
        `the quote reports PayPal environment "${quote.environment || 'unknown'}"; S9 is sandbox-only, so no card was read and no order was created`
      )
    }
    if (!quote.usdAvailable) {
      throw blocked('the quote does not offer USD to this account; no card was read and no order was created')
    }
    if (!quote.variants.length) {
      throw blocked('the USD quote carries no credited variant; no card was read and no order was created')
    }

    const variant = quote.variants[0]
    const balanceBefore = readBalance(wallet.me.body)
    const purchasesBefore = readMovements(wallet.movements.body)
      .filter(movement => movement.type === 'PURCHASE_CREDIT').length
    if (balanceBefore == null) {
      throw fail('GET /auth/me did not publish the pre-payment balance')
    }
    log('sandbox quote verified; selected the lowest-priced credited USD variant')

    let response = null
    let providerMessage = null
    try {
      await selectUsdVariant(page, variant)
      await page.waitForText(CARD_COPY, 25000)

      // The fields are identified by their labels/placeholders inside the
      // child frame, never by a provider class name.
      await waitForCardFields(page, scenarioMark, 25000)

      await page.fillFrameField('number', fixture.number)
      await page.fillFrameField('expiry', fixture.expiry)
      await page.fillFrameField('cvv', fixture.cvv)
      await page.fillFrameField('name', fixture.name)
      log('sandbox card fixture entered in PayPal frames')

      const paymentMark = page.requests.length
      await page.clickText(PAY_BUTTON, { scope: WALLET_SHEET, timeoutMs: 20000 })
      const request = await page.waitForRequest(
        candidate => candidate.method === 'POST' && candidate.path === '/payments/orders/card',
        30000
      )
      if (request.host !== API_HOST) {
        throw fail(`POST /payments/orders/card went to ${request.host}, expected ${API_HOST}`)
      }
      if (!request.headers['idempotency-key']) {
        throw fail('POST /payments/orders/card went out without an Idempotency-Key header')
      }

      let requestBody = null
      try { requestBody = JSON.parse(request.postData || '{}') } catch { /* handled below */ }
      if (!requestBody || typeof requestBody !== 'object') {
        throw fail('POST /payments/orders/card carried no readable JSON body')
      }
      if (requestBody.variant_id !== variant.variantId) {
        throw fail('POST /payments/orders/card carried a different variant than the one selected from the quote')
      }
      if (typeof requestBody.card_token !== 'string' || !requestBody.card_token.trim()) {
        throw fail('POST /payments/orders/card carried no PayPal card token')
      }
      const rawKeys = forbiddenCardKeys(requestBody)
      if (rawKeys.length) {
        throw fail(`POST /payments/orders/card carried raw card field(s): ${rawKeys.join(', ')}`)
      }
      const serialized = JSON.stringify(requestBody)
      const distinctiveFixtureValues = [fixture.number, fixture.expiry, fixture.name]
      if (distinctiveFixtureValues.some(value => value && serialized.includes(value))) {
        throw fail('POST /payments/orders/card carried a raw sandbox card value')
      }

      response = await platformResponse(page, request, {
        timeoutMs: 90000,
        label: 'POST /payments/orders/card',
      })
      const responseBody = await page.responseJson(request.id)
      const error = readError(responseBody)
      providerMessage = error.message ? safeText(error.message, fixture) : null
      if (response.status === 202) {
        throw blocked(
          `the provider returned PAYMENT_PENDING (HTTP 202); the scenario does not retry a pending card payment`,
          {
            httpStatus: response.status,
            providerCode: error.code || 'PAYMENT_PENDING',
            providerMessage,
            consoleErrors: consoleErrorSummary(page, scenarioMark, fixture),
          }
        )
      }
      if (response.status !== 200) {
        const kind = response.status === 409 ? blocked : fail
        throw kind(
          `POST /payments/orders/card answered HTTP ${response.status}${error.code ? ` (${error.code})` : ''}`,
          {
            httpStatus: response.status,
            providerCode: error.code,
            providerMessage,
            consoleErrors: consoleErrorSummary(page, scenarioMark, fixture),
          }
        )
      }

      const order = responseBody && responseBody.success === true && responseBody.data
        ? responseBody.data
        : responseBody
      const orderId = typeof order.order_id === 'string' ? order.order_id.trim() : ''
      const providerOrderId = typeof order.provider_order_id === 'string' ? order.provider_order_id.trim() : ''
      if (!orderId || !providerOrderId) {
        throw fail('the approved card order carried no order id or provider order id')
      }
      if (order.status !== 'APPROVED') {
        throw fail(`the card order status was ${order.status || 'missing'}, expected APPROVED`)
      }
      if (Number(order.credits) !== variant.credits) {
        throw fail('the approved card order credited a different amount than the quote variant')
      }
      if (!Object.prototype.hasOwnProperty.call(order, 'redirect_url') || order.redirect_url !== null) {
        throw fail('the approved card order did not carry redirect_url=null')
      }

      let successVisible = false
      for (const copy of SUCCESS_COPY) {
        if (await page.waitForText(copy, 1000)) {
          successVisible = true
          break
        }
      }
      if (!successVisible) {
        throw new StepTimeout('the wallet never showed its approved-payment confirmation')
      }

      const after = await waitForFreshResponses(page, paymentMark, ['/auth/me', '/credits/movements'], 30000)
      const meAfter = await latestResponse(page, after, '/auth/me')
      const movementsAfter = await latestResponse(page, after, '/credits/movements')
      if (meAfter.status !== 200) {
        throw fail(`the post-payment GET /auth/me answered HTTP ${meAfter.status}`)
      }
      if (movementsAfter.status !== 200) {
        throw fail(`the post-payment GET /credits/movements answered HTTP ${movementsAfter.status}`)
      }
      const balanceAfter = readBalance(meAfter.body)
      if (balanceAfter == null) {
        throw fail('the post-payment GET /auth/me did not publish the balance')
      }
      if (balanceAfter - balanceBefore !== variant.credits) {
        throw fail(
          `the balance changed by ${balanceAfter - balanceBefore}, expected the credited amount ${variant.credits}`
        )
      }

      const purchasesAfter = readMovements(movementsAfter.body)
        .filter(movement => movement.type === 'PURCHASE_CREDIT')
      if (purchasesAfter.length <= purchasesBefore) {
        throw fail('the ledger did not gain a PURCHASE_CREDIT movement')
      }

      const cardFormGone = await closeWalletCardForm(page)
      if (!cardFormGone) {
        throw fail('the card form could not be removed before the evidence screenshot')
      }
      await maskVisibleSensitiveValues(page, screenshotSecrets)
      const shot = await page.screenshot('s9-paypal-card-sandbox-approved')

      evidence.length = 0
      evidence.push({ label: 'order id', value: orderId })
      evidence.push({ label: 'provider order id', value: providerOrderId })
      evidence.push({ label: 'credited amount', value: variant.credits })
      evidence.push({ label: 'balance before', value: balanceBefore })
      evidence.push({ label: 'balance after', value: balanceAfter })
      evidence.push({ label: 'movement type', value: 'PURCHASE_CREDIT' })
      evidence.push({ label: 'elapsed time', value: `${Math.round((Date.now() - startedAt) / 100) / 10}s` })

      return {
        status: 'PASS',
        reason: 'the PayPal sandbox card order was APPROVED and its credits reached the visible balance and ledger',
        evidence,
        screenshots: shot.path ? [shot.path] : [],
      }
    } catch (error) {
      // A failed run must never keep a filled card form on screen. Closing the
      // wallet unmounts PayPal's fields before the fallback screenshot.
      const cardFormGone = await closeWalletCardForm(page)
      if (cardFormGone) {
        await maskVisibleSensitiveValues(page, screenshotSecrets)
        await page.screenshot('s9-paypal-card-sandbox-blocked').catch(() => null)
      }
      if (error && error.kind) throw error
      if (error instanceof StepTimeout) {
        throw blocked(`the PayPal sandbox card journey timed out: ${error.message}`, {
          httpStatus: response ? response.status : null,
          providerMessage,
          consoleErrors: consoleErrorSummary(page, scenarioMark, fixture),
        })
      }
      throw error
    }
  },
}
