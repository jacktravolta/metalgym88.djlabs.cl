import { describe, it, expect } from 'vitest'
import { LOGIN_SECTION_ID, PANEL_URL, loginSectionHref, panelHref } from './landing-login.js'

// The menu and the section must agree, or the label lies about where a click ends.
describe('the landing login section contract', () => {
  it('leads the header CTA and the footer link to the login section when there is no session', () => {
    expect(panelHref(false)).toBe('#login')
    // the section carries the id; the links carry the anchor to it
    expect(loginSectionHref()).toBe('#' + LOGIN_SECTION_ID)
    expect(LOGIN_SECTION_ID.startsWith('#')).toBe(false)
  })

  it('keeps "Entrar al panel" going to the panel once the session is here', () => {
    expect(panelHref(true)).toBe(PANEL_URL)
    expect(PANEL_URL).toBe('index.html#/home')
  })

  it('points inside the landing, not past it at the hash router', () => {
    // The landing is served as its own page, so "#login" scrolls to the
    // section. An "index.html#/…" target here would send the person to the
    // app gate instead of to the login the label promises.
    expect(panelHref(false).startsWith('index.html')).toBe(false)
  })
})
