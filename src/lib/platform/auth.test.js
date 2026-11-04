import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { login, register, requestMagicLink, me, logout, EMAIL_REVERIFY_REQUIRED } from './auth.js'
import { HEART, withHeart } from './config.js'
import { phttp, getAccessToken, setAccessToken, clearAccessToken } from './http.js'

const BASE = 'https://api.djlabs.cl'

const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body)
})

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

describe('config — heart helpers', () => {
  it('binds every heart slug and keeps query strings intact', () => {
    expect(HEART).toBe('metalgym88')
    expect(withHeart({ a: 1 })).toEqual({ a: 1, heart: 'metalgym88' })
  })
})

describe('login', () => {
  it('POSTs email + password with the heart slug in the body', async () => {
    const m = mockFetch([res(200, { user: { id: 'u1', name: 'Ana' }, token: 'tok' })])
    vi.stubGlobal('fetch', m.impl)
    const out = await login('ana@example.com', 'pw')
    expect(out.user).toEqual({ id: 'u1', name: 'Ana' })
    expect(m.seen[0].url).toBe(BASE + '/auth/login')
    expect(m.seen[0].opts.method).toBe('POST')
    expect(m.seen[0].opts.credentials).toBe('include')
    const body = JSON.parse(m.seen[0].opts.body)
    expect(body).toEqual({ email: 'ana@example.com', password: 'pw', heart: 'metalgym88' })
  })

  it('keeps the returned access token in memory (sent as Bearer afterwards)', async () => {
    const m = mockFetch([res(200, { user: {}, token: 'abc' }), res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    await login('a@b.c', 'pw')
    expect(getAccessToken()).toBe('abc')
    await phttp('/auth/me?heart=metalgym88')
    expect(m.seen[1].opts.headers.Authorization).toBe('Bearer abc')
  })

  it('maps the EMAIL_REVERIFY_REQUIRED response to a distinct, catchable error', async () => {
    const m = mockFetch([res(409, { error: 'verify your email', code: EMAIL_REVERIFY_REQUIRED })])
    vi.stubGlobal('fetch', m.impl)
    const err = await login('a@b.c', 'pw').catch(e => e)
    expect(err.code).toBe(EMAIL_REVERIFY_REQUIRED)

    const m2 = mockFetch([res(200, { code: EMAIL_REVERIFY_REQUIRED })])
    vi.stubGlobal('fetch', m2.impl)
    const err2 = await login('a@b.c', 'pw').catch(e => e)
    expect(err2.code).toBe(EMAIL_REVERIFY_REQUIRED)
  })
})

describe('register / magic link', () => {
  it('register carries name and routes the welcome bonus via body.heart', async () => {
    const m = mockFetch([res(200, { user: { id: 'u2' } })])
    vi.stubGlobal('fetch', m.impl)
    await register('a@b.c', 'Bo')
    const body = JSON.parse(m.seen[0].opts.body)
    expect(body).toEqual({ email: 'a@b.c', name: 'Bo', heart: 'metalgym88' })
  })

  it('requestMagicLink hits /auth/magic-link with the heart', async () => {
    const m = mockFetch([res(200, { ok: true })])
    vi.stubGlobal('fetch', m.impl)
    await requestMagicLink('a@b.c')
    expect(m.seen[0].url).toBe(BASE + '/auth/magic-link')
    expect(JSON.parse(m.seen[0].opts.body)).toEqual({ email: 'a@b.c', heart: 'metalgym88' })
  })

  it('register carries the terms acceptance the platform demands', async () => {
    // The platform refuses both calls without terms_accepted (400 'Para continuar
    // necesitas aceptar los Términos y Condiciones.'), so the consent collected
    // in the form has to travel in the body.
    const m = mockFetch([res(200, { user: { id: 'u2' } })])
    vi.stubGlobal('fetch', m.impl)
    await register('a@b.c', 'Bo', { terms: true })
    const body = JSON.parse(m.seen[0].opts.body)
    expect(body).toEqual({ email: 'a@b.c', name: 'Bo', heart: 'metalgym88', terms_accepted: true })
  })

  it('requestMagicLink carries the terms acceptance too', async () => {
    const m = mockFetch([res(200, { ok: true })])
    vi.stubGlobal('fetch', m.impl)
    await requestMagicLink('a@b.c', { terms: true })
    expect(JSON.parse(m.seen[0].opts.body)).toEqual({ email: 'a@b.c', heart: 'metalgym88', terms_accepted: true })
  })

  it('never consents on the user\'s behalf: without a collected acceptance the flag is absent', async () => {
    const m = mockFetch([res(200, { ok: true })])
    vi.stubGlobal('fetch', m.impl)
    await requestMagicLink('a@b.c')
    expect(JSON.parse(m.seen[0].opts.body).terms_accepted).toBeUndefined()
  })
})

describe('me', () => {
  it('GETs /auth/me?heart=metalgym88 and maps user + balance', async () => {
    const m = mockFetch([res(200, { user: { id: 'u1', name: 'Ana' }, balance: 87 })])
    vi.stubGlobal('fetch', m.impl)
    const out = await me()
    expect(m.seen[0].url).toBe(BASE + '/auth/me?heart=metalgym88')
    expect(m.seen[0].opts.method).toBeUndefined() // default GET
    expect(out).toEqual({ user: { id: 'u1', name: 'Ana' }, balance: 87 })
  })

  it('passes 401 through as a logged-out signal', async () => {
    const m = mockFetch([res(401, {}), res(401, { error: 'gone' })]) // silent refresh also fails
    vi.stubGlobal('fetch', m.impl)
    const err = await me().catch(e => e)
    expect(err.status).toBe(401)
  })
})

describe('logout', () => {
  it('POSTs /auth/logout and drops the in-memory token', async () => {
    setAccessToken('tok')
    const m = mockFetch([res(200, { ok: true })])
    vi.stubGlobal('fetch', m.impl)
    await logout()
    expect(m.seen[0].url).toBe(BASE + '/auth/logout')
    expect(getAccessToken()).toBe(null)
  })

  it('drops the token even when the call fails', async () => {
    setAccessToken('tok')
    const m = mockFetch([res(500, {})])
    vi.stubGlobal('fetch', m.impl)
    await logout().catch(() => {})
    expect(getAccessToken()).toBe(null)
  })
})
