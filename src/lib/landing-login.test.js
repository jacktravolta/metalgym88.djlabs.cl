import { describe, it, expect, vi, afterEach } from 'vitest'
import { LOGIN_SECTION_ID, panelUrl, loginSectionHref, panelHref } from './landing-login.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The menu and the section must agree, or the label lies about where a click ends.
describe('the landing login section contract', () => {
  it('leads the header CTA and the footer link to the login section when there is no session', () => {
    expect(panelHref(false)).toBe('#login')
    // the section carries the id; the links carry the anchor to it
    expect(loginSectionHref()).toBe('#' + LOGIN_SECTION_ID)
    expect(LOGIN_SECTION_ID.startsWith('#')).toBe(false)
  })

  it('keeps "Entrar al panel" going to the panel once the session is here', () => {
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    expect(panelUrl()).toBe('/index.html#/home')
    expect(panelHref(true)).toBe(panelUrl())
  })

  it('names the document, because a fragment-only URL never loads the panel', () => {
    // The landing IS the app root document, so "/#/home" differs from it only
    // by the fragment: the browser swaps the hash and stops, the landing stays
    // mounted and the panel never boots — a "goes to the panel" promise that
    // does nothing. Verified in a real browser: the landing survived, no #app.
    vi.stubGlobal('document', { baseURI: 'https://metalgym88.djlabs.cl/' })
    expect(panelHref(true)).toMatch(/\/index\.html#\/home$/)
    expect(panelHref(true)).not.toBe('/#/home')
  })

  it('points inside the landing, not past it at the hash router', () => {
    // The landing is served as its own page, so "#login" scrolls to the
    // section. An "index.html#/…" target here would send the person to the
    // app gate instead of to the login the label promises.
    expect(panelHref(false).startsWith('index.html')).toBe(false)
  })

  it('follows the app root when the app is published under a path', () => {
    // The panel URL is NOT a hand-written constant: GitHub Pages serves the
    // app under /metalgym88.djlabs.cl/, and a fixed "index.html#/home" would
    // send the person outside the app. The app root is the source of truth.
    vi.stubGlobal('document', { baseURI: 'https://jacktravolta.github.io/metalgym88.djlabs.cl/' })
    expect(panelUrl()).toBe('/metalgym88.djlabs.cl/index.html#/home')
    expect(panelHref(true)).toBe('/metalgym88.djlabs.cl/index.html#/home')
  })
})
