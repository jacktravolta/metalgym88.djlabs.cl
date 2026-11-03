import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { phttp, setAccessToken, clearAccessToken, getAccessToken, onAuthExpired } from './http.js'

const BASE = 'https://api.djlabs.cl'

// Minimal Response stand-in: the client only reads .ok, .status and .json().
const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body)
})

// Records URL/opts of every fetch call and answers sequentially with `responses`.
function mockFetch(responses) {
  const seen = []
  const impl = vi.fn((url, opts) => {
    seen.push({ url, opts: opts || {} })
    const i = seen.length - 1
    return Promise.resolve(responses[i])
  })
  return { impl, seen }
}

beforeEach(() => {
  clearAccessToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAccessToken()
})

describe('phttp — transport', () => {
  it('sends credentials and hits the platform base URL', async () => {
    const m = mockFetch([res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    await phttp('/auth/me?heart=metalgym88')
    expect(m.impl).toHaveBeenCalledTimes(1)
    expect(m.seen[0].url).toBe(BASE + '/auth/me?heart=metalgym88')
    expect(m.seen[0].opts.credentials).toBe('include')
  })

  it('on 401, does exactly one refresh and retries the original call with Bearer', async () => {
    const m = mockFetch([res(401, {}), res(200, { token: 'tok1' }), res(200, { fine: true })])
    vi.stubGlobal('fetch', m.impl)
    const out = await phttp('/auth/me')
    expect(out).toEqual({ fine: true })
    expect(m.impl).toHaveBeenCalledTimes(3)
    expect(m.seen[1].url).toBe(BASE + '/auth/refresh')
    expect(m.seen[1].opts.method).toBe('POST')
    expect(m.seen[1].opts.credentials).toBe('include')
    expect(m.seen[2].url).toBe(BASE + '/auth/me')
    expect(m.seen[2].opts.headers.Authorization).toBe('Bearer tok1')
    expect(getAccessToken()).toBe('tok1')
  })

  it('fires expiry listeners and surfaces the 401 when refresh also fails', async () => {
    const m = mockFetch([res(401, {}), res(401, { error: 'no session' })])
    vi.stubGlobal('fetch', m.impl)
    const expired = vi.fn()
    const off = onAuthExpired(expired)
    const err = await phttp('/auth/me').catch(e => e)
    expect(err.status).toBe(401)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(clearAccessToken()).toBe(undefined) // token memory is cleared on expiry
  })

  it('refreshes only once — a bad token does not loop', async () => {
    const m = mockFetch([res(401, {}), res(200, { token: 't' }), res(401, {})])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/opengym/data').catch(e => e)
    expect(err.status).toBe(401)
    expect(m.impl).toHaveBeenCalledTimes(3)
  })

  it('never refreshes for the refresh and logout endpoints themselves', async () => {
    for (const path of ['/auth/refresh', '/auth/logout']) {
      const m = mockFetch([res(401, {})])
      vi.stubGlobal('fetch', m.impl)
      const err = await phttp(path, { method: 'POST' }).catch(e => e)
      expect(err.status).toBe(401)
      expect(m.impl).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    }
  })

  it('propagates the platform error shape', async () => {
    const m = mockFetch([res(409, { error: 'Email exists', code: 'EMAIL_TAKEN' })])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/auth/register').catch(e => e)
    expect(err.message).toBe('Email exists')
    expect(err.status).toBe(409)
    expect(err.code).toBe('EMAIL_TAKEN')
  })

  it('merges caller headers alongside Content-Type and Authorization', async () => {
    const m = mockFetch([res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    setAccessToken('tok1')
    await phttp('/payments/orders', { method: 'POST', headers: { 'Idempotency-Key': 'k-1' }, body: '{}' })
    const h = m.seen[0].opts.headers
    expect(h['Idempotency-Key']).toBe('k-1')
    expect(h['Content-Type']).toBe('application/json')
    expect(h.Authorization).toBe('Bearer tok1')
  })
})
