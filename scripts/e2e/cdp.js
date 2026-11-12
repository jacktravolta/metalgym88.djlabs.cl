// A minimal Chrome DevTools Protocol client — no npm dependency, only the
// WebSocket that Node 22 ships with.
//
// The flow is the documented one:
//   GET http://127.0.0.1:<port>/json/version  ->  webSocketDebuggerUrl
//   Target.createTarget                     ->  targetId
//   Target.attachToTarget { flatten: true } ->  sessionId
//   <command> { sessionId }                 ->  page-scoped command
//
// Everything else in this folder is built on top of `CDPConnection` and
// `launchChrome`.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CHROME = process.env.E2E_CHROME || '/usr/bin/google-chrome'

// Generic scratch space: the session environment pre-creates /tmp/opencode and
// allows external writes there, so the browser profile lives there instead of
// in a random system temp path.
const TMP_ROOT = (() => {
  const candidate = process.env.E2E_TMP || '/tmp/opencode'
  return existsSync(candidate) ? candidate : tmpdir()
})()

export const CHROME_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
]

/** A free TCP port on the loopback interface. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Polls /json/version until Chrome answers. */
async function waitForVersion(port, timeoutMs, stderr) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no answer yet'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) return await res.json()
      lastError = `HTTP ${res.status}`
    } catch (e) {
      lastError = e && e.message ? e.message : String(e)
    }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(
    `Chrome did not expose its debugging port on ${port} within ${timeoutMs}ms ` +
      `(last error: ${lastError})\n${stderr ? stderr() : ''}`
  )
}

/**
 * Launches headless Chrome with a remote debugging port.
 * The returned handle always knows how to shut the browser down.
 */
export async function launchChrome(opts = {}) {
  const binary = opts.binary || DEFAULT_CHROME
  const port = opts.port || (await freePort())
  const userDataDir = opts.userDataDir || (await mkdtemp(join(TMP_ROOT, 'mg88-e2e-chrome-')))
  const args = [
    ...CHROME_ARGS,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(opts.extraArgs || []),
    'about:blank',
  ]

  const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', chunk => { stderr += chunk.toString() })
  proc.stdout.on('data', () => {})
  proc.on('error', e => { stderr += `\nspawn error: ${e.message}` })

  let version
  try {
    version = await waitForVersion(port, opts.timeoutMs || 30000, () => stderr)
  } catch (e) {
    try { proc.kill('SIGKILL') } catch { /* already gone */ }
    throw e
  }

  return {
    proc,
    port,
    userDataDir,
    version,
    stderr: () => stderr,
    async close() {
      try { proc.kill('SIGTERM') } catch { /* already gone */ }
      await new Promise(resolve => {
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch { /* already gone */ }
          resolve()
        }, 5000)
        proc.once('exit', () => { clearTimeout(timer); resolve() })
      })
      if (!opts.keepProfile) {
        // Chrome can still hold a file or two for a moment after the process
        // is gone: the removal is retried before the profile is abandoned.
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await rm(userDataDir, { recursive: true, force: true })
            break
          } catch {
            await new Promise(resolve => setTimeout(resolve, 300))
          }
        }
      }
    },
  }
}

/** JSON-RPC style connection to the browser's DevTools websocket. */
export class CDPConnection {
  constructor(url) {
    this.url = url
    this.nextId = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.closed = false
    this.ws = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url)
      this.ws = ws
      const onError = e => reject(new Error(`CDP websocket error: ${e && e.message ? e.message : e && e.type}`))
      ws.addEventListener('open', () => resolve(this))
      ws.addEventListener('error', onError)
      ws.addEventListener('close', () => {
        this.closed = true
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer)
          entry.reject(new Error('CDP connection closed'))
        }
        this.pending.clear()
      })
      ws.addEventListener('message', event => this.#dispatch(event.data))
    })
  }

  #dispatch(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : raw.data)
    } catch {
      return
    }
    if (message.id != null && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        const err = new Error(`${message.error.message}${message.error.data ? ` — ${message.error.data}` : ''}`)
        err.cdp = message.error
        entry.reject(err)
      } else {
        entry.resolve(message.result)
      }
      return
    }
    if (!message.method) return
    for (const handler of this.handlers.get(message.method) || []) {
      try {
        handler(message.params || {}, message.sessionId)
      } catch (e) {
        console.error(`[cdp] handler for ${message.method} threw:`, e && e.message)
      }
    }
  }

  /** Registers an event handler. Returns an unsubscribe function. */
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
    return () => {
      const list = this.handlers.get(method) || []
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error(`CDP connection is closed (${method})`))
    const id = ++this.nextId
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.ws.send(JSON.stringify(payload))
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  close() {
    this.closed = true
    try { this.ws && this.ws.close() } catch { /* already closed */ }
  }
}
