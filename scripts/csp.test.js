import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const projectRootUrl = new URL('../', import.meta.url)
const mercadoPagoSdkHash = "'sha256-A3HQMGCaYTLR55HokyyZBduy+DilrRCMRE/WGHXc5i4='"

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

  it('allows the observed Mercado Pago SDK inline bootstrap without weakening script execution', () => {
    for (const [source, policy] of policies) {
      const scriptSources = directives(policy).get('script-src')
      expect(scriptSources, source).toContain(mercadoPagoSdkHash)
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
})
