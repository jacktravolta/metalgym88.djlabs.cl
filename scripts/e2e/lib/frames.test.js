import { describe, expect, it } from 'vitest'
import { attachedChildSessionId, classifyFrameField, redactSensitiveValues } from './frames.js'

describe('cross-origin frame classification', () => {
  it('reads the flattened child session id from the event params', () => {
    expect(attachedChildSessionId({ sessionId: 'child-session' })).toBe('child-session')
    expect(attachedChildSessionId({}, 'fallback-session')).toBe('fallback-session')
  })

  it('classifies the flat attribute array returned by DOM.getAttributes', () => {
    expect(classifyFrameField(['aria-label', 'Card number', 'name', 'cardNumber'])).toBe('number')
    expect(classifyFrameField(['aria-label', 'Expiration date'])).toBe('expiry')
    expect(classifyFrameField(['aria-label', 'Security code'])).toBe('cvv')
    expect(classifyFrameField(['aria-label', 'Name on card'])).toBe('name')
  })

  it('uses autocomplete before visible labels', () => {
    expect(classifyFrameField(['autocomplete', 'cc-csc', 'aria-label', 'Card number'])).toBe('cvv')
  })

  it('does not classify an unrelated input', () => {
    expect(classifyFrameField(['aria-label', 'Postal code'])).toBeNull()
  })
})

describe('sensitive frame values', () => {
  it('removes every configured value', () => {
    expect(redactSensitiveValues('alpha beta', ['alpha', 'beta'])).toBe('[REDACTED] [REDACTED]')
  })
})
