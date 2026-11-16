import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { phttp, setAccessToken, clearAccessToken, getAccessToken, onAuthExpired, onAuthRefreshFailed, refreshSession } from './http.js'

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
    if (responses[i] === 'network') return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(responses[i])
  })
  return { impl, seen }
}

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  clearAccessToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAccessToken()
})

describe('phttp — error envelope', () => {
  // The platform answers errors as { success:false, error:{ code, message } }.
  // The message and the machine code both live INSIDE that nested object: read flat,
  // the UI shows "[object Object]" and never sees EMAIL_REVERIFY_REQUIRED.
  it('extracts message and code from the nested error envelope', async () => {
    // 401 first (as the platform answers an expired session), then the refresh
    // attempt fails with the same nested envelope — that is the error the user sees.
    const m = mockFetch([
      res(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Sesión no reconocida.' } }),
      res(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Sesión no reconocida.' } }),
    ])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/auth/login', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).toBe('Sesión no reconocida.')
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.status).toBe(401)
  })

  it('keeps EMAIL_REVERIFY_REQUIRED visible for the registration pause', async () => {
    const m = mockFetch([res(409, { success: false, error: { code: 'EMAIL_REVERIFY_REQUIRED', message: 'Re-verifica tu correo.' } })])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/auth/register', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.code).toBe('EMAIL_REVERIFY_REQUIRED')
    expect(err.message).toBe('Re-verifica tu correo.')
  })

  it('still accepts a flat error body', async () => {
    const m = mockFetch([res(409, { error: 'Email exists', code: 'EMAIL_TAKEN' })])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/auth/register', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).toBe('Email exists')
    expect(err.code).toBe('EMAIL_TAKEN')
  })

  it('never leaks an object into the error message', async () => {
    const m = mockFetch([res(500, { success: false, error: { code: 'SERVER_ERROR', message: 'Algo falló.' } })])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/opengym/ai', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).not.toContain('[object')
    expect(err.message).toBe('Algo falló.')
  })
})

describe('phttp — success envelope unwrap', () => {
  // The platform wraps nearly every JSON answer in { success: true, data: { ... } }
  // (see leydatos/js/http.js — the same transport convention). Callers receive the
  // INNER payload; module answers without the envelope pass through unchanged.
  it('unwraps the { success, data } envelope on 2xx', async () => {
    const m = mockFetch([res(200, { success: true, data: { user: { id: 'u1' }, balance: 300 } })])
    vi.stubGlobal('fetch', m.impl)
    const out = await phttp('/auth/login', { method: 'POST', body: '{}' })
    expect(out).toEqual({ user: { id: 'u1' }, balance: 300 })
  })

  it('keeps module-shaped answers (no envelope) untouched', async () => {
    const m = mockFetch([res(200, { state: { foo: 1 } }), res(200, { ok: true, answer: 'x' })])
    vi.stubGlobal('fetch', m.impl)
    expect(await phttp('/opengym/data')).toEqual({ state: { foo: 1 } })
    expect(await phttp('/opengym/assistant', { method: 'POST', body: '{}' })).toEqual({ ok: true, answer: 'x' })
  })

  it('never unwraps error bodies — they keep their shape', async () => {
    const m = mockFetch([res(409, { success: false, data: { error: 'no' }, error: 'Email exists', code: 'X' })])
    vi.stubGlobal('fetch', m.impl)
    const err = await phttp('/auth/register', { method: 'POST', body: '{}' }).catch(e => e)
    expect(err.message).toBe('Email exists')
    expect(err.code).toBe('X')
  })

  it('unwraps envelope payloads that are arrays', async () => {
    const m = mockFetch([res(200, { success: true, data: [{ code: 'gym_ai_chat', credits: 5 }] })])
    vi.stubGlobal('fetch', m.impl)
    expect(await phttp('/tariffs')).toEqual([{ code: 'gym_ai_chat', credits: 5 }])
  })
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

describe('session refresh — single flight and failure meaning', () => {
  it('shares ONE refresh across a burst of concurrent 401s', async () => {
    const refresh = deferred()
    let originalCalls = 0
    const impl = vi.fn((url) => {
      if (url === BASE + '/auth/refresh') return refresh.promise
      originalCalls += 1
      return Promise.resolve(originalCalls <= 3 ? res(401, {}) : res(200, { fine: true }))
    })
    vi.stubGlobal('fetch', impl)

    const requests = [phttp('/one'), phttp('/two'), phttp('/three')]
    await new Promise(resolve => setTimeout(resolve, 0))

    const refreshCalls = impl.mock.calls.filter(([url]) => url === BASE + '/auth/refresh')
    expect(refreshCalls).toHaveLength(1)

    refresh.resolve(res(200, { token: 'shared-token' }))
    const results = await Promise.all(requests)
    expect(results).toEqual([{ fine: true }, { fine: true }, { fine: true }])
    expect(impl.mock.calls.filter(([url]) => url === BASE + '/auth/refresh')).toHaveLength(1)
  })

  it('a 5xx refresh failure is transient: the session and token stay alive', async () => {
    const m = mockFetch([res(401, {}), res(503, { error: 'busy' })])
    vi.stubGlobal('fetch', m.impl)
    setAccessToken('still-here')
    const expired = vi.fn()
    const failed = vi.fn()
    const offExpired = onAuthExpired(expired)
    const offFailed = onAuthRefreshFailed(failed)

    const err = await phttp('/auth/me').catch(e => e)
    expect(err.transient).toBe(true)
    expect(err.refreshStatus).toBe(503)
    expect(expired).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledTimes(1)
    expect(failed.mock.calls[0][0]).toMatchObject({ kind: 'transient', status: 503 })
    expect(getAccessToken()).toBe('still-here')

    offExpired()
    offFailed()
  })

  it('a network refresh failure is transient too — it never ends the session', async () => {
    const m = mockFetch([res(401, {}), 'network'])
    vi.stubGlobal('fetch', m.impl)
    setAccessToken('still-here')
    const expired = vi.fn()
    const failed = vi.fn()
    const offExpired = onAuthExpired(expired)
    const offFailed = onAuthRefreshFailed(failed)

    const err = await phttp('/auth/me').catch(e => e)
    expect(err.transient).toBe(true)
    expect(expired).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledTimes(1)
    expect(failed.mock.calls[0][0]).toMatchObject({ kind: 'transient', status: null })
    expect(getAccessToken()).toBe('still-here')

    offExpired()
    offFailed()
  })

  it('a definite 400 refresh rejection ends the session exactly once', async () => {
    const m = mockFetch([res(401, {}), res(400, { error: 'invalid refresh' })])
    vi.stubGlobal('fetch', m.impl)
    const expired = vi.fn()
    const failed = vi.fn()
    const offExpired = onAuthExpired(expired)
    const offFailed = onAuthRefreshFailed(failed)

    const err = await phttp('/auth/me').catch(e => e)
    expect(err.authExpired).toBe(true)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(failed).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe(null)

    offExpired()
    offFailed()
  })

  it('accepts the platform success envelope around the refreshed token', async () => {
    const m = mockFetch([res(200, { success: true, data: { access_token: 'nested-token' } })])
    vi.stubGlobal('fetch', m.impl)
    const result = await refreshSession()
    expect(result).toEqual({ kind: 'ok', token: 'nested-token' })
    expect(getAccessToken()).toBe('nested-token')
  })
})
