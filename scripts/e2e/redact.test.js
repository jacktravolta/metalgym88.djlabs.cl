import { describe, expect, it } from 'vitest'
import { redact, redactValue } from './redact.js'

describe('report redaction', () => {
  it('redacts a card token in a JSON field', () => {
    expect(redact('{"card_token":"opaque-value"}')).toBe('{"card_token":"REDACTED"}')
  })

  it('redacts a secret nested inside an encoded URL parameter', () => {
    const text = 'https://example.test/collect?dl=https%3A%2F%2Fapp.test%2Fverify%3Ftoken%3Dsingle-use%26heart%3Ddemo'
    expect(redact(text)).not.toContain('single-use')
  })

  it('redacts a public provider client id from a URL', () => {
    expect(redact('https://sandbox.example/sdk?client-id=public-value&currency=USD'))
      .toContain('client-id=REDACTED')
  })

  it('removes known fixture values from nested report data', () => {
    const safe = redactValue({
      requests: [{ url: 'https://analytics.test/collect?id=123456' }],
      evidence: ['card fixture 9876'],
    }, ['123456', '9876'])
    const serialized = JSON.stringify(safe)
    expect(serialized).not.toContain('123456')
    expect(serialized).not.toContain('9876')
  })
})
