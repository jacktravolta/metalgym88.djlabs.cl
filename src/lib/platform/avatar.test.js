import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadAvatar, removeAvatar, avatarUrl, AVATAR_MAX_BYTES, AVATAR_TYPES } from './avatar.js'

// Minimal Response stand-in: the client only reads .ok, .status and .json().
const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body)
})

function mockFetch(responses) {
  const seen = []
  const impl = vi.fn((url, opts) => {
    seen.push({ url, opts: opts || {} })
    return Promise.resolve(responses[seen.length - 1])
  })
  return { impl, seen }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the profile photo', () => {
  it('uploads the file as multipart — the browser sets the boundary', async () => {
    const m = mockFetch([res(200, { success: true, data: { avatar: '/avatar/abc' } })])
    vi.stubGlobal('fetch', m.impl)

    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    const path = await uploadAvatar(file)

    expect(path).toBe('/avatar/abc')
    const { url, opts } = m.seen[0]
    expect(url).toContain('/profile/avatar')
    expect(opts.method).toBe('POST')
    expect(opts.body).toBeInstanceOf(FormData)
    // The content type must NOT be set by hand: the browser sets it WITH the
    // boundary, and a hand-written one breaks every upload.
    expect(Object.keys(opts.headers || {}).join(' ')).not.toContain('Content-Type')
  })

  it('removes the photo', async () => {
    const m = mockFetch([res(200, { success: true, data: { avatar: null } })])
    vi.stubGlobal('fetch', m.impl)

    await removeAvatar()

    expect(m.seen[0].opts.method).toBe('DELETE')
    expect(m.seen[0].url).toContain('/profile/avatar')
  })

  it('builds the photo URL with a version that busts the cache', () => {
    expect(avatarUrl('abc')).toContain('/avatar/abc')
    expect(avatarUrl('abc', 123)).toContain('/avatar/abc?v=123')
    expect(avatarUrl('')).toBe('')
  })

  it('knows the server limits before the upload', () => {
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(AVATAR_TYPES).toContain('image/jpeg')
    expect(AVATAR_TYPES).toContain('image/png')
    expect(AVATAR_TYPES).toContain('image/webp')
  })
})
