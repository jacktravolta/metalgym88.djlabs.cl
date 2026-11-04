import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  updateProfile, fetchNotificationPrefs, updateNotificationPrefs,
  isChannelEnabled, canUseWhatsApp, SWITCHABLE_CHANNELS,
} from './profile.js'

const BASE = 'https://api.djlabs.cl'

// Minimal Response stand-in: the client only reads .ok, .status and .json().
const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body),
})

// Records URL/opts of every fetch call and answers sequentially with `responses`.
function mockFetch(responses) {
  const seen = []
  const impl = vi.fn((url, opts) => {
    seen.push({ url, opts: opts || {} })
    return Promise.resolve(responses[seen.length - 1])
  })
  return { impl, seen }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateProfile', () => {
  it('PUTs the name and phone to /profile and returns the user', async () => {
    const user = { id: 'u1', name: 'Ana', email: 'ana@example.com', phone: '+56912345678' }
    const m = mockFetch([res(200, { success: true, data: { user } })])
    vi.stubGlobal('fetch', m.impl)

    const out = await updateProfile({ name: 'Ana', phone: '+56912345678' })

    expect(m.seen[0].url).toBe(BASE + '/profile')
    expect(m.seen[0].opts.method).toBe('PUT')
    const body = JSON.parse(m.seen[0].opts.body)
    expect(body.name).toBe('Ana')
    expect(body.phone).toBe('+56912345678')
    expect(out).toEqual(user)
  })

  it('also reads a flat { user } answer', async () => {
    const m = mockFetch([res(200, { user: { id: 'u2', name: 'Bo' } })])
    vi.stubGlobal('fetch', m.impl)
    const out = await updateProfile({ name: 'Bo', phone: '' })
    expect(out).toEqual({ id: 'u2', name: 'Bo' })
  })

  it('sends an empty phone to clear the stored number', async () => {
    const m = mockFetch([res(200, { data: { user: { id: 'u1', name: 'Ana', phone: null } } })])
    vi.stubGlobal('fetch', m.impl)
    await updateProfile({ name: 'Ana', phone: '' })
    expect(JSON.parse(m.seen[0].opts.body).phone).toBe('')
  })

  it('propagates the server error with its Spanish message', async () => {
    const message = 'Tu nombre puede tener entre 2 y 100 caracteres: usa el que quieras mostrar.'
    const m = mockFetch([res(400, { success: false, error: { code: 'VALIDATION_ERROR', message } })])
    vi.stubGlobal('fetch', m.impl)

    const err = await updateProfile({ name: 'A', phone: '' }).catch(e => e)

    expect(err.status).toBe(400)
    expect(err.message).toBe(message)
  })
})

describe('fetchNotificationPrefs', () => {
  it('GETs /profile/notifications?heart=metalgym88 and returns the prefs', async () => {
    const m = mockFetch([res(200, { success: true, data: { prefs: { NotMail: true, NotWsp: false } } })])
    vi.stubGlobal('fetch', m.impl)

    const out = await fetchNotificationPrefs()

    expect(m.seen[0].url).toBe(BASE + '/profile/notifications?heart=metalgym88')
    expect(out).toEqual({ NotMail: true, NotWsp: false })
  })

  it('accepts a flat { prefs } answer and falls back to {} when nothing is usable', async () => {
    const m = mockFetch([res(200, { prefs: { NotMail: false, NotWsp: true } })])
    vi.stubGlobal('fetch', m.impl)
    expect(await fetchNotificationPrefs()).toEqual({ NotMail: false, NotWsp: true })

    const m2 = mockFetch([res(200, {})])
    vi.stubGlobal('fetch', m2.impl)
    expect(await fetchNotificationPrefs()).toEqual({})
  })
})

describe('updateNotificationPrefs', () => {
  it('PUTs the channel and returns the prefs the server holds', async () => {
    const m = mockFetch([res(200, { success: true, data: { prefs: { NotMail: false, NotWsp: true } } })])
    vi.stubGlobal('fetch', m.impl)

    const out = await updateNotificationPrefs({ NotMail: false })

    expect(m.seen[0].url).toBe(BASE + '/profile/notifications')
    expect(m.seen[0].opts.method).toBe('PUT')
    expect(JSON.parse(m.seen[0].opts.body)).toEqual({ NotMail: false })
    expect(out).toEqual({ NotMail: false, NotWsp: true })
  })

  it('only sends the switchable channels', async () => {
    expect(SWITCHABLE_CHANNELS).toEqual(['NotMail', 'NotWsp'])
    const m = mockFetch([res(200, { data: { prefs: { NotMail: true, NotWsp: true } } })])
    vi.stubGlobal('fetch', m.impl)

    await updateNotificationPrefs({ NotWsp: true, NotInterna: false, other: 1 })

    expect(JSON.parse(m.seen[0].opts.body)).toEqual({ NotWsp: true })
  })

  it('propagates the server error when the save is refused', async () => {
    const message = 'Indica al menos un canal para actualizar (NotMail o NotWsp).'
    const m = mockFetch([res(400, { success: false, error: { code: 'VALIDATION_ERROR', message } })])
    vi.stubGlobal('fetch', m.impl)

    const err = await updateNotificationPrefs({ NotMail: true }).catch(e => e)

    expect(err.status).toBe(400)
    expect(err.message).toBe(message)
  })
})

describe('the platform rules the card reads', () => {
  it('reads a channel with no stored row as enabled (absence = opted in)', () => {
    expect(isChannelEnabled({}, 'NotMail')).toBe(true)
    expect(isChannelEnabled(null, 'NotWsp')).toBe(true)
    expect(isChannelEnabled({ NotMail: true, NotWsp: true }, 'NotMail')).toBe(true)
    expect(isChannelEnabled({ NotMail: false }, 'NotMail')).toBe(false)
    expect(isChannelEnabled({ NotMail: false }, 'NotWsp')).toBe(true)
  })

  it('only lets WhatsApp on when the account has a phone', () => {
    expect(canUseWhatsApp({ phone: '+56912345678' })).toBe(true)
    expect(canUseWhatsApp({ phone: '   ' })).toBe(false)
    expect(canUseWhatsApp({ phone: '' })).toBe(false)
    expect(canUseWhatsApp({})).toBe(false)
    expect(canUseWhatsApp(null)).toBe(false)
  })
})
