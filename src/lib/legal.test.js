import { describe, it, expect } from 'vitest'
import { legalUrl, TERMS_URL, PRIVACY_URL } from './legal.js'

describe('legal links', () => {
  it('points at the pages this repo ships', () => {
    expect(TERMS_URL).toMatch(/legal\/terminos\.html$/)
    expect(PRIVACY_URL).toMatch(/legal\/privacidad\.html$/)
  })

  it('never points at the platform host', () => {
    // The platform answers /terminos and /privacidad with the landing page of
    // another product: a link to the platform is a link to someone else's
    // marketing page, so it must never come back.
    expect(TERMS_URL).not.toContain('api.djlabs.cl')
    expect(PRIVACY_URL).not.toContain('api.djlabs.cl')
  })

  it('keeps the base path the bundle was built for', () => {
    // BASE_URL is the prefix the app is published under: '/' at a domain root,
    // '/<repo>/' under GitHub Pages. The legal pages live inside that same root,
    // so the link has to start with it.
    expect(TERMS_URL.startsWith(import.meta.env.BASE_URL)).toBe(true)
    expect(PRIVACY_URL.startsWith(import.meta.env.BASE_URL)).toBe(true)
  })

  it('builds every page of the folder the same way', () => {
    expect(legalUrl('privacidad')).toBe(PRIVACY_URL)
    expect(legalUrl('terminos')).toBe(TERMS_URL)
  })
})
