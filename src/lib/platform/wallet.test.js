import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normalizeLimits, fetchLimits, clampAmount,
  normalizeQuote, fetchQuote, formatMoney,
  usdPriceLabel, usdPacks, showsCustomAmount, normalizePaypalInfo,
  normalizeMovements, fetchMovements, movementDirection, movementLabel, groupMovements,
  normalizeTariffs, fetchTariffs, tariffLabel,
  createOrder, createCardOrder, extractCardToken, loadPaypalSdk, goToPayment,
  saveTopupRecord, readTopupRecord, clearTopupRecord, TOPUP_RECORD_KEY, TOPUP_TTL_MS,
  orderStatus, statusKind, topUpReturnKind, checkReturnedTopUp,
} from './wallet.js'

const BASE = 'https://api.djlabs.cl'

// Minimal Response stand-in: the client only reads .ok, .status and .json().
const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body)
})

// Records URL/opts of every fetch call and answers sequentially with `responses`.
// The string 'network' makes that call reject, like a network failure would.
function mockFetch(responses) {
  const seen = []
  const impl = vi.fn((url, opts) => {
    seen.push({ url, opts: opts || {} })
    const i = seen.length - 1
    if (responses[i] === 'network') return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(responses[i])
  })
  return { impl, seen }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearTopupRecord()
})

describe('limits', () => {
  it('GETs /payments/limits?heart=metalgym88 and reads the flat shape', async () => {
    const m = mockFetch([res(200, { min_clp: 1000, max_clp: 10000 })])
    vi.stubGlobal('fetch', m.impl)
    const out = await fetchLimits()
    expect(m.seen[0].url).toBe(BASE + '/payments/limits?heart=metalgym88')
    expect(out).toEqual({ min: 1000, max: 10000 })
  })

  it('also accepts a nested { limits } envelope and returns null when empty', () => {
    expect(normalizeLimits({ limits: { min_clp: 1000, max_clp: 10000 } })).toEqual({ min: 1000, max: 10000 })
    expect(normalizeLimits({})).toEqual(null)
    expect(normalizeLimits(null)).toEqual(null)
  })

  it('clamps a custom amount to the served range (UX hint only)', () => {
    const lim = { min: 1000, max: 10000 }
    expect(clampAmount(500, lim)).toBe(1000)
    expect(clampAmount(9999, lim)).toBe(9999)
    expect(clampAmount(10500, lim)).toBe(10000)
    expect(clampAmount('abc', lim)).toBe(1000)
    expect(clampAmount(500, null)).toBe(500)
  })
})

describe('payment quote', () => {
  it('normalizes the pinned currencies[] shape into one canonical shape', () => {
    const out = normalizeQuote({
      detected_country: 'CL',
      detected_currency: 'CLP',
      default_currency: 'CLP',
      currencies: [
        { currency: 'CLP', available: true, min_clp: 1000, max_clp: 10000, presets: [1000, 5000, 10000] },
        { currency: 'USD', available: false, reason: 'El pago en dólares todavía no está disponible.', variants: [] },
      ],
    })
    expect(out).toEqual({
      detectedCountry: 'CL',
      detectedCurrency: 'CLP',
      defaultCurrency: 'CLP',
      paypal: null,
      currencies: [
        { currency: 'CLP', available: true, reason: null, minClp: 1000, maxClp: 10000, presets: [1000, 5000, 10000], variants: [] },
        { currency: 'USD', available: false, reason: 'El pago en dólares todavía no está disponible.', minClp: null, maxClp: null, presets: [], variants: [] },
      ],
    })
  })

  it('accepts the earlier options[] shape and normalizes its variants', () => {
    const out = normalizeQuote({
      detected_country: 'US',
      detected_currency: 'USD',
      default_currency: 'USD',
      options: [
        { currency: 'CLP', available: true, min: 1000, max: 10000, amounts: [1000, 5000, 10000] },
        {
          currency: 'USD',
          available: true,
          variants: [{ variant_id: '67890', price_usd: 10, credits: 10000, amount_clp: 10000, label: 'US$10' }],
        },
      ],
    })
    expect(out.defaultCurrency).toBe('USD')
    expect(out.currencies[0]).toEqual({
      currency: 'CLP', available: true, reason: null, minClp: 1000, maxClp: 10000,
      presets: [1000, 5000, 10000], variants: [],
    })
    expect(out.currencies[1].variants).toEqual([
      { variantId: '67890', priceUsd: 10, priceUsdCents: 1000, credits: 10000, amountClp: 10000, label: 'US$10' },
    ])
  })

  it('reads the integer price_usd_cents the API sends, so the price never depends on the label', () => {
    const out = normalizeQuote({
      currencies: [{
        currency: 'USD',
        available: true,
        variants: [
          { variant_id: 'paypal_1', price_usd_cents: 100, credits: 1000, label: 'US$1' },
          { variant_id: 'paypal_5', price_usd_cents: 500, credits: 5000, label: 'US$5' },
          { variant_id: 'paypal_10', price_usd_cents: 1000, credits: 10000, label: 'US$10' },
        ],
      }],
    })
    expect(out.currencies[0].variants.map(v => [v.variantId, v.priceUsdCents, v.priceUsd, v.credits])).toEqual([
      ['paypal_1', 100, 1, 1000],
      ['paypal_5', 500, 5, 5000],
      ['paypal_10', 1000, 10, 10000],
    ])
  })

  it('reads the public PayPal client id and environment the API exposes on the quote', () => {
    expect(normalizeQuote({
      currencies: [{ currency: 'USD', available: true }],
      paypal: { client_id: 'sb-client', environment: 'sandbox' },
    }).paypal).toEqual({ clientId: 'sb-client', environment: 'sandbox' })
    expect(normalizePaypalInfo({ client_id: 'live-client', environment: 'live' }))
      .toEqual({ clientId: 'live-client', environment: 'live' })
    // Anything unknown falls back to sandbox: never point the buyer at live by accident.
    expect(normalizePaypalInfo({ client_id: 'x', environment: 'staging' }))
      .toEqual({ clientId: 'x', environment: 'sandbox' })
    // A missing or unusable field must leave the card option off, not break the quote.
    expect(normalizePaypalInfo(null)).toBe(null)
    expect(normalizePaypalInfo({})).toBe(null)
    expect(normalizePaypalInfo({ client_id: '   ' })).toBe(null)
    expect(normalizeQuote({ currencies: [{ currency: 'USD', available: true }] }).paypal).toBe(null)
  })

  it('renders a USD pack row from the quote variants: dollar price plus credits', () => {
    const usd = normalizeQuote({
      currencies: [{
        currency: 'USD',
        available: true,
        variants: [
          { variant_id: 'paypal_1', price_usd_cents: 100, credits: 1000, label: 'US$1' },
          { variant_id: 'paypal_5', price_usd_cents: 500, credits: 5000, label: 'US$5' },
          { variant_id: 'paypal_10', price_usd_cents: 1000, credits: 10000, label: 'US$10' },
        ],
      }],
    }).currencies[0]
    expect(usdPacks(usd)).toEqual([
      { variantId: 'paypal_1', price: 'US$1', credits: 1000 },
      { variantId: 'paypal_5', price: 'US$5', credits: 5000 },
      { variantId: 'paypal_10', price: 'US$10', credits: 10000 },
    ])
    expect(usdPacks(null)).toEqual([])
  })

  it('formats whole-dollar cents without decimals and keeps the cents when they matter', () => {
    expect(usdPriceLabel({ priceUsdCents: 100 })).toBe('US$1')
    expect(usdPriceLabel({ priceUsdCents: 550 })).toBe('US$5.50')
    expect(usdPriceLabel({ priceUsdCents: 123400 })).toBe('US$1,234')
    // Older/partial payloads still show a price: dollars first, then the server label.
    expect(usdPriceLabel({ priceUsd: 5 })).toBe('US$5')
    expect(usdPriceLabel({ label: 'US$5' })).toBe('US$5')
    expect(usdPriceLabel(null)).toBe(null)
  })

  it('offers the custom amount field for CLP only — USD prices are server-owned variants', () => {
    expect(showsCustomAmount('CLP')).toBe(true)
    expect(showsCustomAmount('USD')).toBe(false)
    expect(showsCustomAmount('')).toBe(false)
    expect(showsCustomAmount(null)).toBe(false)
  })

  it('returns null for garbage instead of exposing a broken quote to the UI', () => {
    expect(normalizeQuote(null)).toBe(null)
    expect(normalizeQuote([])).toBe(null)
    expect(normalizeQuote({ options: 'not-a-list' })).toBe(null)
    expect(normalizeQuote({ currencies: [null, 42] })).toBe(null)
  })

  it('fetches the heart-scoped quote and returns null when the endpoint is missing', async () => {
    const m = mockFetch([res(404, { error: 'Not found' })])
    vi.stubGlobal('fetch', m.impl)
    expect(await fetchQuote()).toBe(null)
    expect(m.seen[0].url).toBe(BASE + '/payments/quote?heart=metalgym88')
  })

  it('returns null on a quote network failure', async () => {
    const m = mockFetch(['network'])
    vi.stubGlobal('fetch', m.impl)
    expect(await fetchQuote()).toBe(null)
  })

  it('formats CLP as an integer and USD with two decimals', () => {
    expect(formatMoney(10000, 'CLP')).toBe('10.000')
    expect(formatMoney(1234, 'CLP')).toBe('1234')
    expect(formatMoney(10, 'USD')).toBe('US$10.00')
    expect(formatMoney(1234.5, 'USD')).toBe('US$1,234.50')
  })
})

describe('movements', () => {
  it('GETs /credits/movements?heart=…&page=2 and unwraps the { movements, has_more } shape', async () => {
    const m = mockFetch([res(200, {
      movements: [{ type: 'WELCOME_CREDIT', amount: 100, created_at: '2026-11-01T10:00:00Z' }],
      has_more: true,
    })])
    vi.stubGlobal('fetch', m.impl)
    const out = await fetchMovements(2)
    expect(m.seen[0].url).toBe(BASE + '/credits/movements?page=2&heart=metalgym88')
    expect(out.items).toHaveLength(1)
    expect(out.items[0]).toEqual({
      type: 'WELCOME_CREDIT', label: movementLabel('WELCOME_CREDIT'),
      amount: 100, dir: 1, date: '2026-11-01T10:00:00Z',
    })
    expect(out.hasMore).toBe(true)
  })

  it('accepts a bare array and a { items } envelope, and defaults has_more off', () => {
    const arr = Array.isArray(normalizeMovements([{ type: 'USAGE_DEBIT', amount: -3 }]).items)
    expect(arr).toBe(true)
    expect(normalizeMovements({ items: [{ type: 'USAGE_DEBIT', amount: 3 }] }).hasMore).toBe(false)
    expect(normalizeMovements(null).items).toEqual([])
  })

  it('derives the direction from the type when the amount is bare, keeps it when signed', () => {
    expect(movementDirection('USAGE_DEBIT', 3)).toBe(-1)
    expect(movementDirection('USAGE_DEBIT', -3)).toBe(-1)
    expect(movementDirection('USAGE_DEBIT', null)).toBe(-1)
    expect(movementDirection('REFUND', 5)).toBe(1)
    expect(movementDirection('', 4)).toBe(1)
    expect(movementDirection('', -4)).toBe(-1)
    expect(movementDirection('', null)).toBe(1) // unknown row never screams debit
  })

  it('maps operation types to friendly labels, humanizing unknown ones', () => {
    expect(movementLabel('WELCOME_CREDIT')).toBe('Welcome credit')
    expect(movementLabel('PURCHASE_CREDIT')).toBe('Credit purchase')
    expect(movementLabel('USAGE_DEBIT')).toBe('AI usage')
    expect(movementLabel('REFUND')).toBe('Refund')
    expect(movementLabel('ADMIN_ADJUSTMENT')).toBe('Balance adjustment')
    expect(movementLabel('REFERRAL_CREDIT')).toBe('Referral credit')
    expect(movementLabel('GYM_BONUS')).toBe('Gym bonus')
    expect(movementLabel('')).toBe('Movement')
  })

  it('groups movements by calendar day with the net total and the type breakdown', () => {
    const items = [
      { type: 'USAGE_DEBIT', label: 'AI usage', amount: 2000, dir: -1, date: '2026-11-17T10:00:00Z' },
      { type: 'PURCHASE_CREDIT', label: 'Credit purchase', amount: 10000, dir: 1, date: '2026-11-17T08:00:00Z' },
      { type: 'WELCOME_CREDIT', label: 'Welcome credit', amount: 100, dir: 1, date: '2026-11-16T09:00:00Z' },
    ]
    const groups = groupMovements(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].day).toBe('2026-11-17')
    expect(groups[0].net).toBe(8000)
    expect(groups[0].items).toEqual(items.slice(0, 2))  // newest-first order is kept
    // Types appear in the order they were met, each with its signed day total.
    expect(groups[0].types).toEqual([
      { type: 'USAGE_DEBIT', label: 'AI usage', total: -2000 },
      { type: 'PURCHASE_CREDIT', label: 'Credit purchase', total: 10000 },
    ])
    expect(groups[1].day).toBe('2026-11-16')
    expect(groups[1].net).toBe(100)
    expect(groups[1].types).toEqual([
      { type: 'WELCOME_CREDIT', label: 'Welcome credit', total: 100 },
    ])
  })

  it('groups undated rows last instead of dropping them, and survives empty input', () => {
    const groups = groupMovements([
      { type: 'REFUND', label: 'Refund', amount: 50, dir: 1, date: null },
      { type: 'REFUND', label: 'Refund', amount: 25, dir: 1, date: 'not-a-date' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].day).toBe(null)
    expect(groups[0].net).toBe(75)
    expect(groupMovements([])).toEqual([])
    expect(groupMovements(null)).toEqual([])
  })
})

describe('tariffs', () => {
  it('GETs /tariffs?heart=metalgym88 and returns only this product\'s rows', async () => {
    const m = mockFetch([res(200, { tariffs: [
      { operation: 'hosting_monthly', cost_credits: 10 },
      { operation: 'gym_ai_chat', cost_credits: 1 },
    ] })])
    vi.stubGlobal('fetch', m.impl)
    const out = await fetchTariffs()
    expect(m.seen[0].url).toBe(BASE + '/tariffs?heart=metalgym88')
    expect(out).toEqual([
      { code: 'gym_ai_chat', label: tariffLabel('gym_ai_chat'), cost: 1 },
    ])
  })

  it('keeps only gym operations from the shared platform tariff payload', () => {
    expect(normalizeTariffs([
      { operation: 'hosting_monthly', cost_credits: 10 },
      { operation: 'laboral_document', cost_credits: 4 },
      { operation: 'gym_ai_chat', cost_credits: 1 },
      { operation: 'tts', cost_credits: 2 },
      { operation: 'pdf_generate', cost_credits: 3 },
    ])).toEqual([
      { code: 'gym_ai_chat', label: tariffLabel('gym_ai_chat'), cost: 1 },
    ])
  })

  it('returns an empty list when the shared payload has only foreign operations', () => {
    expect(normalizeTariffs([
      { operation: 'hosting_monthly', cost_credits: 10 },
      { operation: 'document_download', cost_credits: 1 },
      { operation: 'url_analysis', cost_credits: 2 },
    ])).toEqual([])
  })

  it('labels the known operations and humanizes anything new the platform adds', () => {
    expect(tariffLabel('chat_simple')).toBe('AI chat question')
    expect(tariffLabel('chat_doc')).toBe('AI document question')
    expect(tariffLabel('gym_ai_chat')).toBe('AI assistant')
    expect(tariffLabel('gym_ai_plan')).toBe('Gym ai plan')
    expect(normalizeTariffs({ operations: [] })).toEqual([])
    expect(normalizeTariffs(null)).toEqual([])
  })
})

describe('createOrder — provider-agnostic order creation', () => {
  it('POSTs the exact boleta body with heart and the Idempotency-Key header', async () => {
    const m = mockFetch([res(200, { redirect_url: 'https://pay/go' })])
    vi.stubGlobal('fetch', m.impl)
    const { order, idempotencyKey } = await createOrder(5000, { genKey: () => 'KEY-1' })
    expect(order).toEqual({ redirect_url: 'https://pay/go' })
    expect(typeof idempotencyKey).toBe('string')
    const call = m.seen[0]
    expect(call.url).toBe(BASE + '/payments/orders')
    expect(call.opts.method).toBe('POST')
    expect(call.opts.headers['Idempotency-Key']).toBe('KEY-1')
    expect(JSON.parse(call.opts.body)).toEqual({ amount_clp: 5000, currency: 'CLP', document_type: 46, heart: 'metalgym88' })
  })

  it('POSTs the USD variant without inventing an amount or credits', async () => {
    const m = mockFetch([res(200, { redirect_url: 'https://pay/go' })])
    vi.stubGlobal('fetch', m.impl)
    const { order } = await createOrder(null, { currency: 'USD', variantId: '67890', genKey: () => 'KEY-USD' })
    expect(order).toEqual({ redirect_url: 'https://pay/go' })
    const call = m.seen[0]
    expect(call.url).toBe(BASE + '/payments/orders')
    expect(call.opts.headers['Idempotency-Key']).toBe('KEY-USD')
    expect(JSON.parse(call.opts.body)).toEqual({ currency: 'USD', variant_id: '67890', document_type: 46, heart: 'metalgym88' })
    expect(JSON.parse(call.opts.body)).not.toHaveProperty('amount_clp')
    expect(JSON.parse(call.opts.body)).not.toHaveProperty('credits')
  })

  it('REUSES the same idempotency key after a network failure — never a double charge', async () => {
    const m = mockFetch(['network', 'network', res(200, { redirect_url: 'https://pay/go' })])
    vi.stubGlobal('fetch', m.impl)
    const { idempotencyKey } = await createOrder(5000, { genKey: () => 'SAME-KEY' })
    expect(m.impl).toHaveBeenCalledTimes(3)
    expect(m.seen[0].opts.headers['Idempotency-Key']).toBe('SAME-KEY')
    expect(m.seen[1].opts.headers['Idempotency-Key']).toBe('SAME-KEY')
    expect(m.seen[2].opts.headers['Idempotency-Key']).toBe('SAME-KEY')
    expect(m.seen[2].opts.body).toBe(m.seen[0].opts.body)
    expect(idempotencyKey).toBe('SAME-KEY')
  })

  it('reuses the same idempotency key and body across USD network retries', async () => {
    const m = mockFetch(['network', 'network', res(200, { redirect_url: 'https://pay/go' })])
    vi.stubGlobal('fetch', m.impl)
    const { idempotencyKey } = await createOrder(null, {
      currency: 'USD',
      variantId: '67890',
      genKey: () => 'USD-SAME-KEY',
    })
    expect(m.impl).toHaveBeenCalledTimes(3)
    expect(m.seen.map(call => call.opts.headers['Idempotency-Key'])).toEqual([
      'USD-SAME-KEY', 'USD-SAME-KEY', 'USD-SAME-KEY',
    ])
    expect(m.seen[2].opts.body).toBe(m.seen[0].opts.body)
    expect(idempotencyKey).toBe('USD-SAME-KEY')
  })

  it('stops retrying the moment the server answers with an error and surfaces it', async () => {
    const m = mockFetch([res(402, { error: 'Top-up not available', code: 'TOPUP_DISABLED' })])
    vi.stubGlobal('fetch', m.impl)
    const err = await createOrder(5000, { genKey: () => 'K' }).catch(e => e)
    expect(m.impl).toHaveBeenCalledTimes(1)
    expect(err.status).toBe(402)
    expect(err.code).toBe('TOPUP_DISABLED')
  })

  it('an idempotent replay the platform answers with the same order just succeeds', async () => {
    // A prior attempt reached the server but the answer was lost on the way back:
    // retrying with the SAME key gets the SAME order object back — success, continue.
    const existing = { order_id: 'o-7', status: 'PENDING', redirect_url: 'https://pay/go' }
    const m = mockFetch([res(200, existing), res(200, existing)])
    vi.stubGlobal('fetch', m.impl)
    const a = await createOrder(5000, { genKey: () => 'REPLAY' })
    const b = await createOrder(5000, { genKey: () => 'REPLAY' })
    expect(m.impl).toHaveBeenCalledTimes(2)
    expect(m.seen[0].opts.headers['Idempotency-Key']).toBe(m.seen[1].opts.headers['Idempotency-Key'])
    expect(a.order).toEqual(existing)
    expect(b.order).toEqual(existing)
  })
})

describe('goToPayment — always the same window', () => {
  it('navigates this window to the gateway and NEVER opens another tab', () => {
    const fakeWindow = {
      location: { href: 'https://app/start', assign: vi.fn() },
      open: vi.fn(() => { throw new Error('no window.open allowed') }),
    }
    vi.stubGlobal('window', fakeWindow)
    expect(goToPayment('https://pay.example/checkout')).toBe(true)
    expect(fakeWindow.location.assign).toHaveBeenCalledWith('https://pay.example/checkout')
    expect(fakeWindow.open).not.toHaveBeenCalled()
  })

  it('falls back to location.href when assign is unavailable — still the same window', () => {
    const fakeWindow = { location: { href: 'https://app/start' }, open: vi.fn() }
    vi.stubGlobal('window', fakeWindow)
    expect(goToPayment('https://pay.example/checkout')).toBe(true)
    expect(fakeWindow.location.href).toBe('https://pay.example/checkout')
    expect(fakeWindow.open).not.toHaveBeenCalled()
  })

  it('does nothing (and reports it) without a URL', () => {
    const fakeWindow = { location: { href: 'https://app/start', assign: vi.fn() } }
    vi.stubGlobal('window', fakeWindow)
    expect(goToPayment('')).toBe(false)
    expect(goToPayment(null)).toBe(false)
    expect(fakeWindow.location.assign).not.toHaveBeenCalled()
  })
})

describe('card checkout — token only, never raw card data', () => {
  it('extracts the token from every shape the SDK may hand over', () => {
    expect(extractCardToken({ paymentSource: { card: { token: 'tok_card' } } })).toBe('tok_card')
    expect(extractCardToken({ paymentSource: { card: { id: 'tok_id' } } })).toBe('tok_id')
    expect(extractCardToken({ card: { token: 'tok_top' } })).toBe('tok_top')
    expect(extractCardToken({ paymentSource: 'tok_source' })).toBe('tok_source')
    expect(extractCardToken({ token: 'tok_flat' })).toBe('tok_flat')
    expect(extractCardToken('tok_plain')).toBe('tok_plain')
    // A card NUMBER is not a token: it must never travel to our API.
    expect(extractCardToken({ paymentSource: { card: { number: '4111111111111111', cvv: '123' } } })).toBe(null)
    expect(extractCardToken({})).toBe(null)
    expect(extractCardToken(null)).toBe(null)
  })

  it('POSTs only { variant_id, card_token } with its own Idempotency-Key', async () => {
    const m = mockFetch([res(200, {
      order_id: 'o-card', provider_order_id: 'pp-1', status: 'APPROVED', credits: 5000,
    })])
    vi.stubGlobal('fetch', m.impl)
    const { order, idempotencyKey } = await createCardOrder('paypal_5', 'tok_123', { genKey: () => 'CARD-KEY' })
    const call = m.seen[0]
    expect(call.url).toBe(BASE + '/payments/orders/card')
    expect(call.opts.method).toBe('POST')
    expect(call.opts.headers['Idempotency-Key']).toBe('CARD-KEY')
    expect(idempotencyKey).toBe('CARD-KEY')
    expect(JSON.parse(call.opts.body)).toEqual({
      variant_id: 'paypal_5', card_token: 'tok_123', heart: 'metalgym88',
    })
    // Nothing card-shaped ever reaches the API body.
    const body = JSON.parse(call.opts.body)
    expect(body).not.toHaveProperty('card_number')
    expect(body).not.toHaveProperty('number')
    expect(body).not.toHaveProperty('cvv')
    expect(body).not.toHaveProperty('expiry')
    expect(body).not.toHaveProperty('amount_clp')
    expect(body).not.toHaveProperty('credits')
    expect(order).toEqual({
      orderId: 'o-card', providerOrderId: 'pp-1', status: 'APPROVED', credits: 5000, redirectUrl: null,
    })
  })

  it('reuses ONE key across network retries — a captured card is never charged twice', async () => {
    const m = mockFetch(['network', res(200, { order_id: 'o-2', status: 'PENDING' })])
    vi.stubGlobal('fetch', m.impl)
    await createCardOrder('paypal_5', 'tok_123', { genKey: () => 'SAME-CARD-KEY' })
    expect(m.impl).toHaveBeenCalledTimes(2)
    expect(m.seen.map(c => c.opts.headers['Idempotency-Key'])).toEqual(['SAME-CARD-KEY', 'SAME-CARD-KEY'])
    expect(m.seen[1].opts.body).toBe(m.seen[0].opts.body)
  })

  it('stops at the first answered error instead of retrying a real decision', async () => {
    const m = mockFetch([res(402, { error: 'Card capture failed', code: 'CARD_DECLINED' })])
    vi.stubGlobal('fetch', m.impl)
    const err = await createCardOrder('paypal_5', 'tok_123', { genKey: () => 'K' }).catch(e => e)
    expect(m.impl).toHaveBeenCalledTimes(1)
    expect(err.status).toBe(402)
    expect(err.code).toBe('CARD_DECLINED')
  })
})

describe('PayPal JS SDK loader', () => {
  function fakeDom() {
    const appended = []
    const document = {
      head: { appendChild: el => { appended.push(el) } },
      createElement: () => ({}),
    }
    return { appended, document }
  }

  it('builds the sandbox card-fields URL with the API client id and loads it once', async () => {
    const { appended, document } = fakeDom()
    const fakeWindow = {}
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', fakeWindow)
    const p = loadPaypalSdk({ clientId: 'sb-client', environment: 'sandbox' })
    expect(appended).toHaveLength(1)
    expect(appended[0].src).toBe('https://www.sandbox.paypal.com/sdk/js?client-id=sb-client&components=card-fields&currency=USD')
    // A second call shares the same in-flight script.
    loadPaypalSdk({ clientId: 'sb-client', environment: 'sandbox' })
    expect(appended).toHaveLength(1)
    fakeWindow.paypal = { CardFields: () => ({}) }
    appended[0].onload()
    expect(await p).toBe(fakeWindow.paypal)
  })

  it('uses the live host only when the API says live', async () => {
    const { appended, document } = fakeDom()
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', {})
    loadPaypalSdk({ clientId: 'live-client', environment: 'live' })
    expect(appended[0].src).toBe('https://www.paypal.com/sdk/js?client-id=live-client&components=card-fields&currency=USD')
  })

  it('refuses to load anything without a client id — the card option stays off', async () => {
    const { appended, document } = fakeDom()
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', {})
    expect(await loadPaypalSdk({ clientId: '' })).toBe(null)
    expect(await loadPaypalSdk(null)).toBe(null)
    expect(appended).toHaveLength(0)
  })

  it('resolves null when the script cannot load, so the wallet can fall back honestly', async () => {
    const { appended, document } = fakeDom()
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', {})
    const p = loadPaypalSdk({ clientId: 'broken-client', environment: 'sandbox' })
    appended[0].onerror()
    expect(await p).toBe(null)
  })
})

describe('top-up breadcrumb record (TTL 24h)', () => {
  const store = new Map()
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: k => { store.delete(k) },
      },
      configurable: true
    })
    store.clear()
  })

  it('saves and reads the order id + timestamp', () => {
    saveTopupRecord('o-42', 1000)
    expect(JSON.parse(store.get(TOPUP_RECORD_KEY))).toEqual({ order_id: 'o-42', ts: 1000 })
    expect(readTopupRecord(2000)).toEqual({ order_id: 'o-42', ts: 1000 })
  })

  it('keeps a record inside the TTL and purges one past 24 hours, on read', () => {
    saveTopupRecord('o-42', 1000)
    expect(readTopupRecord(1000 + 24 * 60 * 60 * 1000 - 1)).toEqual({ order_id: 'o-42', ts: 1000 })
    expect(readTopupRecord(1000 + 24 * 60 * 60 * 1000 + 1)).toBe(null)
    expect(store.has(TOPUP_RECORD_KEY)).toBe(false)
  })

  it('purges malformed records and clears on demand', () => {
    store.set(TOPUP_RECORD_KEY, 'not json')
    expect(readTopupRecord(1)).toBe(null)
    saveTopupRecord('o-43', 100)
    clearTopupRecord()
    expect(store.has(TOPUP_RECORD_KEY)).toBe(false)
    expect(readTopupRecord(200)).toBe(null)
  })
})

describe('voucher status mapping', () => {
  it('finds the status on the root, the order or a nested voucher', () => {
    expect(orderStatus({ status: 'APPROVED' })).toBe('APPROVED')
    expect(orderStatus({ order: { status: 'pending' } })).toBe('PENDING')
    expect(orderStatus({ voucher: { status: 'REJECTED' } })).toBe('REJECTED')
    expect(orderStatus(null)).toBe('')
  })

  it('maps every gateway status to a neutral kind — unknown becomes pending, never scary', () => {
    expect(statusKind('APPROVED')).toBe('approved')
    expect(statusKind('COMPLETED')).toBe('approved')
    expect(statusKind('PENDING')).toBe('pending')
    expect(statusKind('PENDING_PAYMENT')).toBe('pending')
    expect(statusKind('PENDING_REVIEW')).toBe('pending_review')
    expect(statusKind('REJECTED')).toBe('rejected')
    expect(statusKind('CANCELED')).toBe('canceled')
    expect(statusKind('CANCELLED')).toBe('canceled')
    expect(statusKind('SOMETHING_NEW')).toBe('pending')
    expect(statusKind('')).toBe('pending')
  })
})

describe('gateway return state', () => {
  it('maps known gateway states to the existing status kinds', () => {
    expect(topUpReturnKind('?pago=approved')).toBe('approved')
    expect(topUpReturnKind('?pago=rejected')).toBe('rejected')
    expect(topUpReturnKind('?pago=cancelled')).toBe('canceled')
    expect(topUpReturnKind('?pago=canceled')).toBe('canceled')
    expect(topUpReturnKind('?pago=pending')).toBe('pending')
    expect(topUpReturnKind('?pago=pending_review')).toBe('pending_review')
    expect(topUpReturnKind({ search: '?pago=approved' })).toBe('approved')
  })

  it('has no opinion about a missing or unknown gateway state', () => {
    expect(topUpReturnKind('')).toBe(null)
    expect(topUpReturnKind('?pago=unknown')).toBe(null)
    expect(topUpReturnKind('?pago=surprise')).toBe(null)
  })
})

describe('checkReturnedTopUp', () => {
  const installStore = () => {
    const store = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: k => { store.delete(k) },
      },
      configurable: true
    })
    store.clear()
    return store
  }

  const stubBrowserUrl = (search, hash = '#/wallet') => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/', search, hash },
      history: { replaceState, state: null },
    })
    return replaceState
  }

  it('asks the voucher endpoint for the recorded order and consumes the record once', async () => {
    const store = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: k => { store.delete(k) },
      },
      configurable: true
    })
    saveTopupRecord('o-42', Date.now())
    const m = mockFetch([res(200, { status: 'APPROVED' })])
    vi.stubGlobal('fetch', m.impl)
    const got = await checkReturnedTopUp()
    expect(m.seen[0].url).toBe(BASE + '/payments/orders/o-42/voucher?heart=metalgym88')
    expect(got).toEqual({ orderId: 'o-42', voucher: { status: 'APPROVED' }, status: 'APPROVED', kind: 'approved' })
    expect(store.has(TOPUP_RECORD_KEY)).toBe(false) // spoken once, then gone
  })

  it('uses the gateway cancel state instead of a still-pending voucher', async () => {
    installStore()
    saveTopupRecord('o-42', Date.now())
    stubBrowserUrl('?pago=cancelled&orden=o-42')
    const m = mockFetch([res(200, { status: 'PENDING' })])
    vi.stubGlobal('fetch', m.impl)

    const got = await checkReturnedTopUp()

    expect(got).toEqual({
      orderId: 'o-42',
      voucher: { status: 'PENDING' },
      status: 'PENDING',
      kind: 'canceled',
    })
  })

  it('uses the gateway approved state instead of the voucher status', async () => {
    installStore()
    saveTopupRecord('o-42', Date.now())
    stubBrowserUrl('?pago=approved&orden=o-42')
    const m = mockFetch([res(200, { status: 'PENDING' })])
    vi.stubGlobal('fetch', m.impl)

    const got = await checkReturnedTopUp()

    expect(got.kind).toBe('approved')
  })

  it('lets the voucher decide when the gateway state is unknown', async () => {
    installStore()
    saveTopupRecord('o-42', Date.now())
    stubBrowserUrl('?pago=surprise&orden=o-42')
    const m = mockFetch([res(200, { status: 'REJECTED' })])
    vi.stubGlobal('fetch', m.impl)

    const got = await checkReturnedTopUp()

    expect(got.kind).toBe('rejected')
  })

  it('still speaks from the order in the URL when the breadcrumb is missing', async () => {
    installStore()
    stubBrowserUrl('?orden=o-from-url')
    const m = mockFetch([res(200, { status: 'APPROVED' })])
    vi.stubGlobal('fetch', m.impl)

    const got = await checkReturnedTopUp()

    expect(m.seen[0].url).toBe(BASE + '/payments/orders/o-from-url/voucher?heart=metalgym88')
    expect(got).toEqual({
      orderId: 'o-from-url',
      voucher: { status: 'APPROVED' },
      status: 'APPROVED',
      kind: 'approved',
    })
  })

  it('falls back to the URL order when the breadcrumb has expired', async () => {
    const store = installStore()
    saveTopupRecord('expired-order', Date.now() - TOPUP_TTL_MS - 1)
    stubBrowserUrl('?orden=o-from-url')
    const m = mockFetch([res(200, { status: 'APPROVED' })])
    vi.stubGlobal('fetch', m.impl)

    const got = await checkReturnedTopUp()

    expect(got.orderId).toBe('o-from-url')
    expect(store.has(TOPUP_RECORD_KEY)).toBe(false)
  })

  it('removes the gateway return params after the result is ready', async () => {
    installStore()
    saveTopupRecord('o-42', Date.now())
    const replaceState = stubBrowserUrl('?pago=cancelled&orden=o-42&keep=yes')
    const m = mockFetch([res(200, { status: 'PENDING' })])
    vi.stubGlobal('fetch', m.impl)

    await checkReturnedTopUp()

    expect(replaceState).toHaveBeenCalledTimes(1)
    const cleanedUrl = replaceState.mock.calls[0][2]
    expect(cleanedUrl).not.toContain('pago=')
    expect(cleanedUrl).not.toContain('orden=')
    expect(cleanedUrl).toContain('keep=yes')
    expect(cleanedUrl).toContain('#/wallet')
  })

  it('returns null when there is no record', async () => {
    const m = mockFetch([])
    vi.stubGlobal('fetch', m.impl)
    expect(await checkReturnedTopUp()).toBe(null)
    expect(m.impl).not.toHaveBeenCalled()
  })

  it('keeps the record for a next boot when the voucher lookup fails', async () => {
    const store = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: k => { store.delete(k) },
      },
      configurable: true
    })
    saveTopupRecord('o-42', Date.now())
    const m = mockFetch(['network'])
    vi.stubGlobal('fetch', m.impl)
    expect(await checkReturnedTopUp()).toBe(null)
    expect(store.has(TOPUP_RECORD_KEY)).toBe(true)
  })
})
