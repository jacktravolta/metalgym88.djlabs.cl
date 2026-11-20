import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CANONICAL_CSP, withCspNonce } from '../functions/_middleware.js'

const projectRootUrl = new URL('../', import.meta.url)

// The bootstrap returned by /devices/widgets changes between loads. These
// hashes are evidence of past runs, not a stable authorization mechanism.
const unstableMercadoPagoSdkBootstrapHashes = [
  "'sha256-A3HQMGCaYTLR55HokyyZBduy+DilrRCMRE/WGHXc5i4='",
  "'sha256-u3n8DlRExTbGVwTPaH6dx4VS3cNAI9vzqGuYZ9KG820='",
  "'sha256-GaxpzAIh22wwKY6rJ2h4OH/r40gMFKEsvsZpcf7YEOY='",
]

const firstPartyInlineScriptHashes = [
  "'sha256-jYHg7tXSuuVUqjy+JeRT8vyG97+Spkw5IFHdQEBbmrw='",
  "'sha256-Y8gZRRAdU1zK6frCTDDEcEN+fvPKQZLtSHr+o1pW1Og='",
  "'sha256-GRqTQiLptG6wuhtB52asFIQM5iVu0U4w9MQbYH/xszE='",
]

function read(relativePath) {
  return readFileSync(new URL(relativePath, projectRootUrl), 'utf8')
}

function policyFromHeaders(contents) {
  const match = contents.match(/^\s*Content-Security-Policy:\s*(.+)\r?$/m)
  if (!match) throw new Error('Content-Security-Policy header not found')
  return match[1].trim()
}

function policyFromMeta(contents) {
  const match = contents.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/)
  if (!match) throw new Error('Content-Security-Policy meta fallback not found')
  return match[1]
}

function directives(policy) {
  const result = new Map()
  for (const declaration of policy.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [name, ...sources] = declaration.split(/\s+/)
    result.set(name, sources)
  }
  return result
}

const rootHeaders = read('_headers')
const publicHeaders = read('public/_headers')
const indexHtml = read('index.html')
const policies = [
  ['root _headers', policyFromHeaders(rootHeaders)],
  ['public/_headers', policyFromHeaders(publicHeaders)],
  ['index.html meta fallback', policyFromMeta(indexHtml)],
]

describe('static-host Content Security Policy', () => {
  it('keeps the tracked host-config mirror and Vite public copy byte-for-byte identical', () => {
    // Vite consumes public/_headers and publishes it as dist/_headers. The root
    // copy is the tracked static-host configuration mirror, so both paths must
    // publish the same response headers.
    expect(rootHeaders).toBe(publicHeaders)
  })

  it('rejects unstable Mercado Pago bootstrap hashes and unsafe script execution', () => {
    for (const [source, policy] of policies) {
      const scriptSources = directives(policy).get('script-src')
      for (const hash of unstableMercadoPagoSdkBootstrapHashes) {
        expect(scriptSources, `${source}: ${hash}`).not.toContain(hash)
      }
      expect(scriptSources, source).not.toContain("'unsafe-inline'")
      expect(scriptSources, source).not.toContain("'unsafe-eval'")

      const wildcardSources = scriptSources.filter((value) => value.includes('*'))
      expect(new Set(wildcardSources), source).toEqual(
        new Set(['https://*.paypal.com', 'https://*.paypalobjects.com'])
      )
      expect(scriptSources, source).toContain('https://sdk.mercadopago.com')
      expect(scriptSources, source).toContain('https://http2.mlstatic.com')
    }
  })

  it('retains exactly the three first-party inline script hashes', () => {
    for (const [source, policy] of policies) {
      const scriptSources = directives(policy).get('script-src')
      const hashes = scriptSources.filter((value) => value.startsWith("'sha256-"))
      expect(new Set(hashes), source).toEqual(new Set(firstPartyInlineScriptHashes))
      expect(hashes, source).toHaveLength(firstPartyInlineScriptHashes.length)
    }
  })

  it('keeps the response-header and meta policies aligned', () => {
    const headerPolicy = directives(policyFromHeaders(rootHeaders))
    const metaPolicy = directives(policyFromMeta(indexHtml))

    // frame-ancestors cannot be delivered through meta. The repository also
    // keeps upgrade-insecure-requests only in the response-header policy.
    // Preserve those existing differences instead of changing unrelated
    // behavior; every other directive must remain identical.
    const responseHeaderOnly = new Set(['frame-ancestors', 'upgrade-insecure-requests'])
    for (const [name, sources] of headerPolicy) {
      if (responseHeaderOnly.has(name)) continue
      expect(metaPolicy.get(name), name).toEqual(sources)
    }
    for (const name of metaPolicy.keys()) {
      expect(headerPolicy.has(name), name).toBe(true)
    }
  })

  it('keeps the middleware canonical policy aligned with the response-header policy', () => {
    expect(CANONICAL_CSP).toBe(policyFromHeaders(rootHeaders))
  })

  it('adds only a nonce to script-src and preserves every non-script directive', () => {
    const nonce = 'dGVzdC1ub25jZS12YWx1ZQ=='
    const base = directives(CANONICAL_CSP)
    const transformed = directives(withCspNonce(CANONICAL_CSP, nonce))

    for (const [name, sources] of base) {
      if (name === 'script-src') continue
      expect(transformed.get(name), name).toEqual(sources)
    }
    expect(transformed.get('script-src')).toEqual([...base.get('script-src'), `'nonce-${nonce}'`])
    expect(transformed.get('script-src')).not.toContain("'unsafe-inline'")
    expect(transformed.get('script-src')).not.toContain("'unsafe-eval'")
  })
})
