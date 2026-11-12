// Small HTTP helper with bounded retries.
//
// The suite talks to a public API and to a disposable mailbox: both answer
// with the occasional timeout or a 429, and a flaky network must not be
// mistaken for a broken product. Every call therefore has a timeout and a
// short retry ladder.
import { setTimeout as delay } from 'node:timers/promises'

export { delay }

/**
 * fetch + JSON/text parsing.
 * Returns { status, ok, headers, text, json }.
 */
export async function fetchJson(url, opts = {}) {
  const { timeoutMs = 30000, retries = 3, retryOn = [429, 500, 502, 503, 504], ...init } = opts
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      const text = await response.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* not JSON — the text is kept */ }
      if (!response.ok && retryOn.includes(response.status) && attempt < retries) {
        await delay(700 * (attempt + 1))
        continue
      }
      return { status: response.status, ok: response.ok, headers: response.headers, text, json }
    } catch (e) {
      lastError = e
      if (attempt < retries) {
        await delay(700 * (attempt + 1))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error(`request to ${url} failed`)
}

/** JSON body helper for fetchJson. */
export function jsonInit(method, body, extraHeaders = {}) {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }
}

/**
 * Proves a host is reachable at the network level (DNS + TCP + TLS) WITHOUT
 * issuing an HTTP request: some gateway confirmation pages change state on a
 * plain GET, so the suite checks reachability without touching them.
 */
export async function probeTls(host, { port = 443, timeoutMs = 10000 } = {}) {
  const tls = await import('node:tls')
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch { /* already closed */ }
      resolve(value)
    }
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false })
    const timer = setTimeout(() => finish({ host, port, reachable: false, error: `timeout after ${timeoutMs}ms` }), timeoutMs)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      finish({
        host,
        port,
        reachable: true,
        protocol: socket.getProtocol ? socket.getProtocol() : null,
        authorized: socket.authorized === true,
      })
    })
    socket.once('error', e => {
      clearTimeout(timer)
      finish({ host, port, reachable: false, error: e && e.message ? e.message : String(e) })
    })
  })
}
