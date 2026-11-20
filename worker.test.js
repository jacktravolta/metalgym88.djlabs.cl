import { describe, expect, it, vi } from 'vitest'
import worker from './worker.js'
import { CSP_NONCE_META_NAME } from './functions/_middleware.js'

function nonceFromHtml(html) {
  const match = html.match(new RegExp(`<meta name="${CSP_NONCE_META_NAME}" content="([^"]+)">`))
  if (!match) throw new Error('CSP nonce meta not found')
  return match[1]
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'",
      'Cache-Control': 'public, max-age=31536000',
    },
  })
}

describe('Cloudflare Worker entry', () => {
  it('forwards the document to ASSETS and stamps the middleware nonce', async () => {
    const upstream = htmlResponse(
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>App</title></head><body>ok</body></html>',
    )
    const assetFetch = vi.fn(() => Promise.resolve(upstream))
    const request = new Request('https://metalgym88.djlabs.cl/wallet', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })

    const response = await worker.fetch(request, { ASSETS: { fetch: assetFetch } })
    const body = await response.text()
    const nonce = nonceFromHtml(body)

    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect(response.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`)
    expect(body).toContain(`<meta name="${CSP_NONCE_META_NAME}" content="${nonce}">`)
  })

  it('passes a non-HTML asset through without nonce rewriting', async () => {
    const upstream = new Response('{"ok":true}', {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Content-Security-Policy': "default-src 'self'",
      },
    })
    const assetFetch = vi.fn(() => Promise.resolve(upstream))

    const response = await worker.fetch(new Request('https://metalgym88.djlabs.cl/api/health'), {
      ASSETS: { fetch: assetFetch },
    })

    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'")
    expect(await response.json()).toEqual({ ok: true })
  })
})
