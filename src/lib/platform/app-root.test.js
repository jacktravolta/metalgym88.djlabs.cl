import { describe, it, expect, vi, afterEach } from 'vitest'
import { appRootUrl, appRootPath, isAppRoot } from './app-root.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('app root', () => {
  it('is the site root when the app is served at the root of a domain', () => {
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    expect(appRootPath()).toBe('/')
    expect(appRootUrl().href).toBe('https://metalgym88.djlabs.cl/')
  })

  it('is the prefix when the app is served under a path (GitHub Pages)', () => {
    vi.stubGlobal('document', { baseURI: 'https://jacktravolta.github.io/metalgym88.djlabs.cl/' })
    expect(appRootPath()).toBe('/metalgym88.djlabs.cl/')
    expect(appRootUrl().href).toBe('https://jacktravolta.github.io/metalgym88.djlabs.cl/')
  })

  it('recognises the app root and nothing else', () => {
    vi.stubGlobal('document', { baseURI: 'https://jacktravolta.github.io/metalgym88.djlabs.cl/' })
    expect(isAppRoot('/metalgym88.djlabs.cl/')).toBe(true)
    expect(isAppRoot('/metalgym88.djlabs.cl')).toBe(true)
    expect(isAppRoot('/metalgym88.djlabs.cl/auth/verify')).toBe(false)
    expect(isAppRoot('/')).toBe(false)
  })

  it('falls back to the site root when there is no document', () => {
    vi.stubGlobal('document', undefined)
    expect(appRootPath()).toBe('/')
  })
})
