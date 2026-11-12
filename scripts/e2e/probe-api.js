#!/usr/bin/env node
// A throwaway probe: what does the BROWSER see when the app calls the platform?
//
// It answers the question the suite cannot answer by itself: is the request
// blocked by CORS, slow, or answered? It runs in the page (same origin, same
// CSP, same cookies as the real product) and prints the raw outcome.
import { launchChrome, CDPConnection } from './cdp.js'
import { Page } from './page.js'
import { BASE_URL } from './config.js'

const chrome = await launchChrome()
let connection = null
try {
  connection = await new CDPConnection(chrome.version.webSocketDebuggerUrl).connect()
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true })
  const page = new Page(connection, sessionId)
  await page.enable()
  await page.goto(`${BASE_URL}/`, { timeoutMs: 30000 })

  const probe = await page.evaluate(`
    const started = Date.now();
    try {
      const res = await fetch('https://api.djlabs.cl/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'probe', email: 'probe@fldubai.com', message: 'probe', website: '', heart: 'metalgym88' }),
      });
      const body = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        type: res.type,
        ms: Date.now() - started,
        body: body.slice(0, 300),
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), ms: Date.now() - started };
    }
  `)
  console.log('POST /contact from the page:', JSON.stringify(probe, null, 2))

  const preflight = await page.evaluate(`
    const started = Date.now();
    try {
      const res = await fetch('https://api.djlabs.cl/contact', {
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      return { status: res.status, ms: Date.now() - started, headers: Object.fromEntries(res.headers.entries()) };
    } catch (e) {
      return { error: String(e && e.message ? e.message : e), ms: Date.now() - started };
    }
  `)
  console.log('OPTIONS /contact from the page:', JSON.stringify(preflight, null, 2))

  console.log('\n--- captured requests ---')
  for (const r of page.requests) {
    if (!/djlabs\.cl/.test(r.url || '')) continue
    console.log(JSON.stringify({
      method: r.method,
      url: r.url,
      status: r.status,
      errorText: r.errorText,
      type: r.type,
      headers: r.headers,
    }, null, 2))
  }
  console.log('\n--- console entries ---')
  for (const c of page.consoleEntries) {
    console.log(`${c.level} ${c.source}: ${c.text}`)
  }
} finally {
  if (connection) connection.close()
  await chrome.close()
}
