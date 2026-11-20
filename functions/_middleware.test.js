import { describe, expect, it } from 'vitest'
import {
  CANONICAL_CSP,
  CSP_NONCE_META_NAME,
  createCspNonce,
  injectCspNonce,
  onRequest,
  withCspNonce,
} from './_middleware.js'

function directives(policy) {
  const result = new Map()
  for (const declaration of policy.split(';').map((part) => part.trim()).filter(Boolean)) {
    const [name, ...sources] = declaration.split(/\s+/)
    result.set(name, sources)
  }
  return result
}

function nonceFromHtml(html) {
  const match = html.match(new RegExp(`<meta name="${CSP_NONCE_META_NAME}" content="([^"]+)">`))
  if (!match) throw new Error('CSP nonce meta not found')
  return match[1]
}

function policyFromHtml(html) {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
  if (!match) throw new Error('CSP policy meta not found')
  return match[1]
}

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    ...init,
  })
}

describe('Cloudflare Pages CSP nonce middleware', () => {
  it('rewrites HTML with one matching header/meta/app nonce and preserves response metadata', async () => {
    const upstream = htmlResponse(
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>App</title></head><body>ok</body></html>',
      {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'",
          'Cache-Control': 'public, max-age=31536000',
          ETag: '"stale"',
          'X-Request-Id': 'request-42',
        },
      },
    )

    const response = await onRequest({ next: async () => upstream })
    const body = await response.text()
    const nonce = nonceFromHtml(body)
    const policy = response.headers.get('Content-Security-Policy')

    expect(response.status).toBe(404)
    expect(response.statusText).toBe('Not Found')
    expect(response.headers.get('X-Request-Id')).toBe('request-42')
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect(response.headers.get('ETag')).toBe(null)
    expect(policy).toContain(`'nonce-${nonce}'`)
    expect(policyFromHtml(body)).toBe(policy)
    expect(response.headers.get('Content-Length')).toBe(String(new TextEncoder().encode(body).byteLength))
  })

  it('issues a fresh unpredictable nonce for every HTML response', async () => {
    const first = await onRequest({ next: async () => htmlResponse('<html><head></head><body>one</body></html>') })
    const second = await onRequest({ next: async () => htmlResponse('<html><head></head><body>two</body></html>') })
    const firstNonce = nonceFromHtml(await first.text())
    const secondNonce = nonceFromHtml(await second.text())

    expect(firstNonce).not.toBe(secondNonce)
    expect(firstNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(secondNonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(Buffer.from(firstNonce, 'base64')).toHaveLength(16)
    expect(Buffer.from(secondNonce, 'base64')).toHaveLength(16)
  })

  it('removes conditional cache headers before the asset lookup', async () => {
    const request = new Request('https://metalgym88.djlabs.cl/', {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'If-None-Match': '"stale"',
        'If-Modified-Since': 'Thu, 20 Nov 2026 00:00:00 GMT',
      },
    })
    let forwardedRequest = null

    await onRequest({
      request,
      next: async forwarded => {
        forwardedRequest = forwarded
        return htmlResponse('<html><head></head><body>fresh</body></html>')
      },
    })

    expect(forwardedRequest).not.toBe(null)
    expect(forwardedRequest.headers.get('If-None-Match')).toBe(null)
    expect(forwardedRequest.headers.get('If-Modified-Since')).toBe(null)
  })

  it('leaves non-HTML responses untouched', async () => {
    const upstream = new Response('{"ok":true}', {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Content-Security-Policy': "default-src 'self'",
      },
    })

    const response = await onRequest({ next: async () => upstream })

    expect(response).toBe(upstream)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'")
    expect(await response.json()).toEqual({ ok: true })
  })

  it('injects a policy when the HTML response has no CSP meta', () => {
    const nonce = createCspNonce()
    const policy = withCspNonce(CANONICAL_CSP, nonce)
    const html = injectCspNonce('<!doctype html><html><head><title>App</title></head><body>ok</body></html>', policy, nonce)

    expect(policyFromHtml(html)).toBe(policy)
    expect(nonceFromHtml(html)).toBe(nonce)
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
  })
})
