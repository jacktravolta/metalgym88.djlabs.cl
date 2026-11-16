import { describe, it, expect } from 'vitest'
import { readWelcomeBonus, welcomeBonusMessage } from './welcome-bonus.js'

describe('welcome bonus', () => {
  it('reads the ledger result published by the platform', () => {
    expect(readWelcomeBonus({
      welcome_bonus: { credits_added: 100, already_awarded: false },
    })).toEqual({ creditsAdded: 100, alreadyAwarded: false })
  })

  it('also accepts the result inside a success envelope', () => {
    expect(readWelcomeBonus({
      success: true,
      data: { welcome_bonus: { credits_added: 0, already_awarded: true } },
    })).toEqual({ creditsAdded: 0, alreadyAwarded: true })
  })

  it('treats an absent or malformed result as unknown', () => {
    expect(readWelcomeBonus(null)).toBe(null)
    expect(readWelcomeBonus({})).toBe(null)
    expect(readWelcomeBonus({ welcome_bonus: { credits_added: 'many' } })).toBe(null)
  })

  it('confirms only the credits the platform says arrived', () => {
    const message = welcomeBonusMessage({ creditsAdded: 100, alreadyAwarded: false })
    expect(message).toContain('100')
    expect(message).toContain('added')
  })

  it('says the credits are already there without blaming the person', () => {
    const message = welcomeBonusMessage({ creditsAdded: 0, alreadyAwarded: true })
    expect(message).toContain('already')
    expect(message.toLowerCase()).not.toContain('duplicate')
    expect(message.toLowerCase()).not.toContain('fraud')
  })

  it('makes no amount promise when the platform published no result', () => {
    const message = welcomeBonusMessage(readWelcomeBonus({ ok: true }))
    expect(message).not.toContain('100')
    expect(message).not.toMatch(/\d+\s+credit/i)
    expect(message.toLowerCase()).toContain('balance')
  })
})
