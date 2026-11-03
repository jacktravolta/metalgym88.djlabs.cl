import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normalizeLimits, fetchLimits, clampAmount,
  normalizeMovements, fetchMovements, movementDirection, movementLabel,
  normalizeTariffs, fetchTariffs, tariffLabel,
  createOrder, goToPayment,
  saveTopupRecord, readTopupRecord, clearTopupRecord, TOPUP_RECORD_KEY,
  orderStatus, statusKind, checkReturnedTopUp,
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
})

describe('tariffs', () => {
  it('GETs /tariffs?heart=metalgym88 and renders whatever rows the platform returns', async () => {
    const m = mockFetch([res(200, { tariffs: [
      { operation: 'chat_simple', cost_credits: 1 },
      { op: 'chat_doc', price: 5 },
    ] })])
    vi.stubGlobal('fetch', m.impl)
    const out = await fetchTariffs()
    expect(m.seen[0].url).toBe(BASE + '/tariffs?heart=metalgym88')
    expect(out).toEqual([
      { code: 'chat_simple', label: tariffLabel('chat_simple'), cost: 1 },
      { code: 'chat_doc', label: tariffLabel('chat_doc'), cost: 5 },
    ])
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
    expect(JSON.parse(call.opts.body)).toEqual({ amount_clp: 5000, document_type: 46, heart: 'metalgym88' })
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

describe('goToPayment', () => {
  it('navigates by full-page redirect, not an in-app fetch or window.open', () => {
    const fakeWindow = { location: { href: 'https://app/start' } }
    vi.stubGlobal('window', fakeWindow)
    goToPayment('https://pay.example/checkout')
    expect(fakeWindow.location.href).toBe('https://pay.example/checkout')
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

describe('checkReturnedTopUp', () => {
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
