import { describe, it, expect, vi, afterEach } from 'vitest'
import { goToIndex, indexUrl, signOutAndGoToIndex } from './nav.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sign-out navigation', () => {
  it('closes the session and then lands on the product index, never /login', async () => {
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    const assign = vi.fn()
    const signOut = vi.fn(async () => {})

    const destination = await signOutAndGoToIndex(signOut, { assign })

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('https://metalgym88.djlabs.cl/')
    expect(destination).toBe('https://metalgym88.djlabs.cl/')
    expect(destination).not.toContain('#/login')
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(assign.mock.invocationCallOrder[0])
  })

  it('does not navigate when the explicit sign-out fails', async () => {
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    const assign = vi.fn()
    const failure = new Error('still signed in')

    await expect(signOutAndGoToIndex(async () => { throw failure }, { assign })).rejects.toBe(failure)
    expect(assign).not.toHaveBeenCalled()
  })

  it('follows the app root when the product is published under a path', () => {
    vi.stubGlobal('document', { baseURI: 'https://jacktravolta.github.io/metalgym88.djlabs.cl/' })
    const assign = vi.fn()
    expect(indexUrl()).toBe('https://jacktravolta.github.io/metalgym88.djlabs.cl/')
    goToIndex({ assign })
    expect(assign).toHaveBeenCalledWith('https://jacktravolta.github.io/metalgym88.djlabs.cl/')
  })

  it('falls back to assigning location.href when assign is unavailable', () => {
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    const location = { href: '' }
    goToIndex(location)
    expect(location.href).toBe('https://metalgym88.djlabs.cl/')
  })
})
