import { describe, expect, it } from 'vitest'
import { redact } from './redact.js'

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
})
