import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readLanding, consumeMagicLink, clearLandingUrl } from './landing.js'
import { getAccessToken, clearAccessToken } from './http.js'

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

// A Location-like object, the way the browser hands it over.
const loc = (pathname, search = '') => ({ pathname, search })

beforeEach(() => {
  clearAccessToken()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearAccessToken()
})

describe('readLanding', () => {
  it('reads the token of the verify path', () => {
    expect(readLanding(loc('/auth/verify', '?token=abc123'))).toEqual({
      kind: 'magic-link', token: 'abc123', heart: 'metalgym88'
    })
  })

  it('is null without a token', () => {
    expect(readLanding(loc('/auth/verify', ''))).toBe(null)
    expect(readLanding(loc('/auth/verify', '?heart=metalgym88'))).toBe(null)
    expect(readLanding(loc('/auth/verify', '?token='))).toBe(null)
  })

  it('is null on any other path — the token is only read on the verify path', () => {
    expect(readLanding(loc('/', '?token=abc123'))).toBe(null)
    expect(readLanding(loc('/library', '?token=abc123'))).toBe(null)
    expect(readLanding(loc('/auth/verify-other', '?token=abc123'))).toBe(null)
  })

  it('keeps the heart the link carries', () => {
    expect(readLanding(loc('/auth/verify', '?token=abc123&heart=otro')).heart).toBe('otro')
  })

  it('falls back to the heart of this product', () => {
    expect(readLanding(loc('/auth/verify', '?token=abc123')).heart).toBe('metalgym88')
  })

  it('tolerates extra query parameters, a hash and the case of the URL', () => {
    expect(readLanding(loc('/AUTH/Verify/', '?utm_source=mail&Token=abc123#top'))).toEqual({
      kind: 'magic-link', token: 'abc123', heart: 'metalgym88'
    })
    expect(readLanding('https://metalgym88.djlabs.cl/auth/verify?token=abc123&heart=metalgym88#top')).toEqual({
      kind: 'magic-link', token: 'abc123', heart: 'metalgym88'
    })
  })
})

describe('consumeMagicLink', () => {
  it('redeems the token through the JSON contract and adopts the access token', async () => {
    const m = mockFetch([
      res(200, { success: true, data: { access_token: 'tok-1', refresh_token: 'r-1', user: { id: 'u1' } } })
    ])
    vi.stubGlobal('fetch', m.impl)
    const out = await consumeMagicLink('abc 123')
    expect(m.seen[0].url).toBe(BASE + '/auth/verify?token=abc%20123&heart=metalgym88')
    expect(m.seen[0].opts.headers.Accept).toBe('application/json')
    expect(m.seen[0].opts.credentials).toBe('include')
    expect(out).toEqual({ access_token: 'tok-1', refresh_token: 'r-1', user: { id: 'u1' } })
    // the session is live for the app that boots next
    expect(getAccessToken()).toBe('tok-1')
  })

  it('propagates the error of an expired or already used link', async () => {
    const m = mockFetch([
      res(400, { success: false, error: { code: 'INVALID_TOKEN', message: 'Este enlace ya no es válido.' } })
    ])
    vi.stubGlobal('fetch', m.impl)
    const err = await consumeMagicLink('abc123').catch(e => e)
    expect(err.code).toBe('INVALID_TOKEN')
    expect(err.status).toBe(400)
    expect(getAccessToken()).toBe(null)
  })

  it('takes an injected request, so the check never depends on the network', async () => {
    const request = vi.fn(async () => ({ access_token: 'tok-2', user: { id: 'u2' } }))
    const out = await consumeMagicLink('abc123', { request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('/auth/verify?token=abc123&heart=metalgym88')
    expect(request.mock.calls[0][1]).toEqual({ headers: { Accept: 'application/json' } })
    expect(out.user).toEqual({ id: 'u2' })
    expect(getAccessToken()).toBe('tok-2')
  })

  it('propagates the error of an injected request', async () => {
    const boom = new Error('network down')
    const err = await consumeMagicLink('abc123', { request: async () => { throw boom } }).catch(e => e)
    expect(err).toBe(boom)
    expect(getAccessToken()).toBe(null)
  })
})

describe('clearLandingUrl', () => {
  it('replaces the history entry, so the token leaves the address bar', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', { history: { replaceState } })
    clearLandingUrl()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/home')
  })

  it('never throws when there is no history to clean', () => {
    expect(() => clearLandingUrl()).not.toThrow()
  })
})
