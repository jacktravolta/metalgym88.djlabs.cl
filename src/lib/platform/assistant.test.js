import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  askAssistant, findGymTariff, fetchAssistantTariff, isOffline, ASSISTANT_PATH,
} from './assistant.js'

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

// phttp runs one silent refresh on a 401 — tests that simulate a dead session need
// the refresh call to fail too, so the 401 surfaces as-is.
const deadSession = [res(401, {}), res(401, { error: 'no session' })]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('askAssistant — request shape', () => {
  it('POSTs /opengym/ai with question, conversation_id and the heart in the body', async () => {
    const m = mockFetch([res(200, { answer: 'Bench 60kg next week.', conversation_id: 'c-1', balance: 97 })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('How much should I bench next week?')
    expect(m.impl).toHaveBeenCalledTimes(1)
    const call = m.seen[0]
    expect(call.url).toBe(BASE + ASSISTANT_PATH)
    expect(call.opts.method).toBe('POST')
    expect(call.opts.credentials).toBe('include')
    expect(call.opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(call.opts.body)).toEqual({
      question: 'How much should I bench next week?',
      conversation_id: null,
      heart: 'metalgym88',
    })
    expect(r.kind).toBe('ok')
    expect(r.answer).toBe('Bench 60kg next week.')
  })

  it('carries the conversation_id back to the server on follow-ups', async () => {
    const m = mockFetch([res(200, { answer: 'a1', conversation_id: 'conv-42' }), res(200, { answer: 'a2', conversation_id: 'conv-42' })])
    vi.stubGlobal('fetch', m.impl)
    const first = await askAssistant('q1')
    expect(first.conversationId).toBe('conv-42')
    await askAssistant('q2', { conversationId: first.conversationId })
    expect(JSON.parse(m.seen[1].opts.body).conversation_id).toBe('conv-42')
  })

  it('sends conversation_id null when the caller has none — never undefined or absent', async () => {
    const m = mockFetch([res(200, { answer: 'a' })])
    vi.stubGlobal('fetch', m.impl)
    await askAssistant('q')
    const body = JSON.parse(m.seen[0].opts.body)
    expect('conversation_id' in body).toBe(true)
    expect(body.conversation_id).toBe(null)
  })
})

describe('askAssistant — response handling', () => {
  it('extracts balance from the top level (contract shape)', async () => {
    const m = mockFetch([res(200, { answer: 'a', conversation_id: 'c', balance: 95 })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.balance).toBe(95)
    expect(r.conversationId).toBe('c')
  })

  it('extracts balance and conversation id from a nested { data } envelope too', async () => {
    const m = mockFetch([res(200, { data: { answer: 'a', conversation_id: 'c-9', balance: 12, operation_id: 'op-3' } })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('ok')
    expect(r.balance).toBe(12)
    expect(r.conversationId).toBe('c-9')
    expect(r.operationId).toBe('op-3')
  })

  it('returns balance null when the response carries none — the UI keeps the old number', async () => {
    const m = mockFetch([res(200, { answer: 'a' })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.balance).toBe(null)
  })

  it('a 200 without an answer text is a contract violation, classified as a gentle error', async () => {
    const m = mockFetch([res(200, { balance: 9 })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('error')
    expect(r.answer).toBe('')
  })
})

describe('askAssistant — failure classification (never throws)', () => {
  it('402 → insufficient_credits (the wallet hint the UI needs)', async () => {
    const m = mockFetch([res(402, { error: 'insufficient credits' })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('insufficient_credits')
    expect(r.status).toBe(402)
    expect(r.answer).toBe('')
  })

  it('a platform code naming insufficient credits counts too, whatever status rides along', async () => {
    const m = mockFetch([res(409, { error: 'no balance', code: 'INSUFFICIENT_CREDITS' })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('insufficient_credits')
  })

  it('404 and 501 → not_available (pre-T6: the module is packaged, not applied)', async () => {
    for (const status of [404, 501]) {
      const m = mockFetch([res(status, { error: 'no route' })])
      vi.stubGlobal('fetch', m.impl)
      const r = await askAssistant('q')
      expect(r.kind).toBe('not_available')
      expect(r.status).toBe(status)
      vi.unstubAllGlobals()
    }
  })

  it('a network failure (offline, DNS, down) reads as not_available — same silent-keep philosophy', async () => {
    const m = mockFetch(['network'])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('not_available')
    expect(r.status).toBe(null)
  })

  it('401 with a dead refresh → auth (the session listener has already flipped the app)', async () => {
    const m = mockFetch(deadSession)
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('auth')
    expect(r.status).toBe(401)
  })

  it('any other server status → error, with the status carried for the UI', async () => {
    const m = mockFetch([res(500, { error: 'boom' })])
    vi.stubGlobal('fetch', m.impl)
    const r = await askAssistant('q')
    expect(r.kind).toBe('error')
    expect(r.status).toBe(500)
  })
})

describe('tariff before sending', () => {
  it('finds the gym AI row among whatever the platform serves', () => {
    const tariffs = [
      { code: 'chat_simple', cost: 1 },
      { code: 'gym_ai_chat', cost: 3 },
    ]
    // Hand-built rows return as-is: findGymTariff matches on code + cost only.
    expect(findGymTariff(tariffs)).toEqual({ code: 'gym_ai_chat', cost: 3 })
  })

  it('accepts any gym_* key (the server owns the naming) but only rows with a real cost', () => {
    expect(findGymTariff([{ code: 'gym_ai_plan', cost: 5 }]).cost).toBe(5)
    expect(findGymTariff([{ code: 'gym_ai_chat', cost: null }])).toBe(null)
    expect(findGymTariff([{ code: 'chat_doc', cost: 2 }])).toBe(null)
    expect(findGymTariff([])).toBe(null)
    expect(findGymTariff(null)).toBe(null)
    expect(findGymTariff('junk')).toBe(null)
  })

  it('GETs /tariffs?heart=metalgym88 and returns the matching row', async () => {
    const m = mockFetch([res(200, { tariffs: [{ operation: 'gym_ai_chat', cost_credits: 3 }] })])
    vi.stubGlobal('fetch', m.impl)
    const r = await fetchAssistantTariff()
    expect(m.seen[0].url).toBe(BASE + '/tariffs?heart=metalgym88')
    expect(r).toEqual({ code: 'gym_ai_chat', cost: 3, label: 'AI assistant' })
  })

  it('no gym row served → null, so the UI says the cost is shown on confirm (never invents a number)', async () => {
    const m = mockFetch([res(200, { tariffs: [{ operation: 'chat_simple', cost_credits: 1 }] })])
    vi.stubGlobal('fetch', m.impl)
    expect(await fetchAssistantTariff()).toBe(null)
  })

  it('a failed tariffs call → null as well: no cost display beats a wrong cost display', async () => {
    const m = mockFetch(['network'])
    vi.stubGlobal('fetch', m.impl)
    expect(await fetchAssistantTariff()).toBe(null)
  })
})

describe('isOffline', () => {
  it('mirrors the browser signal — true only when the browser says it is offline', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOffline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOffline()).toBe(false)
  })

  it('without a navigator at all it reads online (SSR/tests never disable the feature by accident)', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isOffline()).toBe(false)
  })
})
