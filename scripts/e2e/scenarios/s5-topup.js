// S5 — the credit top-up.
//
// What can be proven without a human payment method:
//   · the recharge limits the platform publishes (GET /payments/limits),
//   · the order creation (POST /payments/orders, with an Idempotency-Key),
//   · the hand-off to the payment gateway (the URL the app hands over).
//
// What cannot: paying. The last leg needs a real payment method, and on this
// platform install the gateway answers a plain GET by approving the order —
// so the harness records the hand-off instead of following it.
import { blocked, fail } from '../runner.js'
import { probeTls } from '../lib/net.js'
import { API_HOST, HEART, TEXT } from '../config.js'
import { ensureSignedIn, interceptWindowOpen, openApp, platformResponse } from './helpers.js'

export default {
  id: 'S5',
  title: 'Credit top-up — limits, order creation and the hand-off to the gateway',
  async run({ page, context, log }) {
    const evidence = []
    const steps = []

    // The wallet belongs to a signed-in account. Without a session there is no
    // wallet to open, and the session cannot exist while the browser refuses
    // the platform calls.
    if (context.cors) {
      throw fail(
        `the recharge could not be started — ${context.cors.message}. ` +
        `The limits, the order and the hand-off to the gateway were never reached, and the payment leg was ` +
        `never attempted (no card data was asked for, shown or sent)`,
        context.cors
      )
    }

    const session = await ensureSignedIn(page, context)
    evidence.push({ label: 'session', value: session.balance || 'balance chip not visible' })

    await openApp(page, '/settings')
    await page.expectText(TEXT.wallet, 20000)
    await page.clickText(TEXT.wallet)
    await page.expectText(TEXT.limitsLine, 20000)

    // --- step 1: the limits the platform publishes -------------------------
    const limitsRequest = await page.waitForRequest(r => r.method === 'GET' && r.path === '/payments/limits', 20000)
    const limitsResponse = await platformResponse(page, limitsRequest)
    if (limitsResponse.status !== 200) {
      throw fail(`GET /payments/limits answered HTTP ${limitsResponse.status}`)
    }
    const limitsBody = await page.responseJson(limitsRequest.id)
    const limits = (limitsBody && limitsBody.data) || limitsBody || {}
    let min = limits.min_clp != null ? limits.min_clp : limits.min
    let max = limits.max_clp != null ? limits.max_clp : limits.max
    let limitsFrom = 'the answer body'
    if (min == null || max == null) {
      // The browser forgets the body of some answers. The UI publishes the
      // same numbers, so the limits are still provable — and the report says
      // where they came from.
      const line = await page.textContaining(TEXT.limitsLine, { scope: '.sheet' })
      const numbers = line ? (line.match(/[\d.]+/g) || []) : []
      const values = numbers.map(n => Number(String(n).replace(/\./g, ''))).filter(n => !isNaN(n))
      if (values.length >= 2) {
        min = values[0]
        max = values[1]
        limitsFrom = 'the UI (the answer body was not readable)'
      }
    }
    if (min == null || max == null) {
      throw fail('GET /payments/limits did not publish a minimum and a maximum', { body: limitsBody })
    }
    steps.push('limits: PASS')
    evidence.push({
      label: 'step 1 — limits (PASS)',
      value: `min=${min} max=${max} provider=${limits.provider || 'unknown'} (HTTP ${limitsResponse.status}, from ${limitsFrom})`,
    })
    const limitsLine = await page.textContaining(TEXT.limitsLine, { scope: '.sheet' })
    evidence.push({ label: 'step 1 — UI', value: limitsLine || 'limits line not found' })

    // --- step 2: create the order -----------------------------------------
    await interceptWindowOpen(page)
    await page.clickText(TEXT.topUpButton, { scope: '.sheet' })

    const orderRequest = await page.waitForRequest(
      r => r.method === 'POST' && r.path === '/payments/orders',
      25000
    )
    if (orderRequest.host !== API_HOST) {
      throw fail(`POST /payments/orders went to ${orderRequest.host}, expected ${API_HOST}`)
    }
    const idempotencyKey = orderRequest.headers['idempotency-key']
    if (!idempotencyKey) {
      throw fail('POST /payments/orders went out without an Idempotency-Key header')
    }
    const orderResponse = await platformResponse(page, orderRequest)
    if (orderResponse.status !== 200) {
      throw fail(`POST /payments/orders answered HTTP ${orderResponse.status}`)
    }
    const orderBody = await page.responseJson(orderRequest.id)
    const order = (orderBody && orderBody.data) || orderBody || {}
    const orderId = order.order_id || order.id || null
    if (!orderId) {
      throw fail('POST /payments/orders answered without an order id', { body: orderBody })
    }
    steps.push('order creation: PASS')
    evidence.push({
      label: 'step 2 — order (PASS)',
      value: `HTTP ${orderResponse.status} id=${orderId} status=${order.status} provider=${order.provider}`,
    })
    evidence.push({
      label: 'step 2 — provider',
      value: order.provider || 'unknown',
    })
    evidence.push({ label: 'step 2 — Idempotency-Key', value: 'present' })

    // --- step 3: the hand-off to the gateway -------------------------------
    const gatewayUrl = await page.evaluate('return window.__e2e ? window.__e2e.gatewayUrl : null')
    const redirectUrl = order.redirect_url || order.redirectUrl || null
    if (!redirectUrl) {
      throw fail('the created order carried no redirect URL, so the gateway hand-off cannot be proven', {
        handedOver: gatewayUrl,
      })
    }
    if (gatewayUrl !== redirectUrl) {
      throw fail('the app did not hand the gateway URL over to the payment tab', {
        handedOver: gatewayUrl,
        redirectUrl,
      })
    }
    const gatewayHost = new URL(redirectUrl).host
    const probe = await probeTls(gatewayHost)
    const provider = String(order.provider || '').toLowerCase()
    const fakeProvider = provider === 'fake'
    steps.push(`gateway hand-off: ${fakeProvider ? 'BLOCKED' : 'PASS'}`)
    evidence.push({
      label: `step 3 — gateway hand-off (${fakeProvider ? 'BLOCKED' : 'PASS'})`,
      value: `${redirectUrl} (host ${gatewayHost} reachable over TLS: ${probe.reachable ? 'yes' : `no — ${probe.error}`})`,
    })
    evidence.push({
      label: 'step 3 — gateway host',
      value: `${gatewayHost}:${probe.port} TLS=${probe.reachable ? probe.protocol : 'unreachable'}`,
    })

    // --- step 4: paying (needs a human) -----------------------------------
    steps.push('payment: BLOCKED')
    evidence.push({
      label: 'step 4 — payment (BLOCKED)',
      value:
        'the last leg needs a human payment method; the harness records the gateway hand-off instead of ' +
        'following it (on this platform install the gateway approves the order on a plain GET)',
    })

    const shot = await page.screenshot('s5-wallet-topup')
    log(`order ${order.order_id || order.id} created; gateway ${gatewayHost} reached`)

    if (fakeProvider) {
      return {
        status: 'BLOCKED',
        reason:
          `limits loaded (${min}-${max} CLP) and the order was created (HTTP ${orderResponse.status}), but ` +
          `the platform returned provider=fake and the redirect stayed on ${gatewayHost}; the real Flow gateway ` +
          `was not reached, and the payment leg was not attempted`,
        evidence,
        screenshots: shot.path ? [shot.path] : [],
        steps,
      }
    }

    return {
      status: 'BLOCKED',
      reason:
        `limits loaded (${min}-${max} CLP) and the order was created (HTTP ${orderResponse.status}, provider=${order.provider}), ` +
        `the app handed over to ${gatewayHost} — but the payment itself needs a human payment method`,
      evidence,
      screenshots: shot.path ? [shot.path] : [],
      steps,
    }
  },
}
