import { describe, expect, it } from 'vitest'
import { Mailbox } from './mailbox.js'

describe('pinned mailbox configuration', () => {
  it('returns null when the suite should create a random inbox', () => {
    expect(Mailbox.fromEnvironment({})).toBeNull()
  })

  it('uses both configured values without printing them', () => {
    const mailbox = Mailbox.fromEnvironment({
      E2E_MAIL_ADDRESS: 'pinned@example.test',
      E2E_MAIL_PASSWORD: 'fixture-secret',
    })
    expect(mailbox.address).toBe('pinned@example.test')
    expect(mailbox.password).toBe('fixture-secret')
  })

  it('rejects a partial configuration', () => {
    expect(() => Mailbox.fromEnvironment({ E2E_MAIL_ADDRESS: 'pinned@example.test' }))
      .toThrow('E2E_MAIL_ADDRESS and E2E_MAIL_PASSWORD must be set together')
  })
})
