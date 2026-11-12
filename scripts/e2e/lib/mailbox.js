// Disposable mailbox client (mail.tm, public API, no key).
//
// The suite needs to read the real magic-link email: the platform sends it to
// the address that asked for it, and mail.tm is the only inbox a test can own
// without a real mailbox. If mail.tm refuses the address, or the platform
// refuses to deliver to the domain, the scenario reports BLOCKED with the
// exact status and body — never an invented pass.
import { fetchJson, jsonInit, delay } from './net.js'

const API = process.env.E2E_MAIL_API || 'https://api.mail.tm'

function randomSuffix(length = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export class Mailbox {
  constructor({ address, password, token = null }) {
    this.address = address
    this.password = password
    this.token = token
  }

  /** The first active domain mail.tm offers. */
  static async domain() {
    const res = await fetchJson(`${API}/domains`)
    if (!res.ok) throw new Error(`mail.tm /domains answered ${res.status}: ${res.text.slice(0, 200)}`)
    const list = res.json && (res.json['hydra:member'] || res.json.member || [])
    const active = list.find(d => d.isActive !== false) || list[0]
    if (!active || !active.domain) throw new Error('mail.tm offered no active domain')
    return active.domain
  }

  /** Creates a fresh inbox. Throws with the exact API answer when it refuses. */
  static async create({ prefix = 'mg88e2e', domain = null } = {}) {
    const host = domain || (await Mailbox.domain())
    let lastError = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const address = `${prefix}${randomSuffix()}@${host}`
      const password = `E2e!${randomSuffix(12)}`
      const res = await fetchJson(`${API}/accounts`, jsonInit('POST', { address, password }))
      if (res.status === 201 || res.ok) {
        const mailbox = new Mailbox({ address, password })
        await mailbox.authenticate()
        return mailbox
      }
      lastError = new Error(`mail.tm refused ${address}: HTTP ${res.status} — ${res.text.slice(0, 300)}`)
      if (res.status === 422) {
        // The address was rejected or taken: a new random name is the fix.
        await delay(500)
        continue
      }
      throw lastError
    }
    throw lastError || new Error('mail.tm refused every candidate address')
  }

  /** Exchanges the address/password for a bearer token. */
  async authenticate() {
    const res = await fetchJson(`${API}/token`, jsonInit('POST', { address: this.address, password: this.password }))
    if (!res.ok || !res.json || !res.json.token) {
      throw new Error(`mail.tm /token answered ${res.status}: ${res.text.slice(0, 200)}`)
    }
    this.token = res.json.token
    return this.token
  }

  #headers() {
    return { Authorization: `Bearer ${this.token}` }
  }

  /** The inbox, newest first. */
  async messages() {
    const res = await fetchJson(`${API}/messages`, { headers: this.#headers() })
    if (!res.ok) throw new Error(`mail.tm /messages answered ${res.status}: ${res.text.slice(0, 200)}`)
    const json = res.json || {}
    return json['hydra:member'] || json.member || []
  }

  /** One message with its body. */
  async read(id) {
    const res = await fetchJson(`${API}/messages/${encodeURIComponent(id)}`, { headers: this.#headers() })
    if (!res.ok) throw new Error(`mail.tm /messages/${id} answered ${res.status}: ${res.text.slice(0, 200)}`)
    return res.json || {}
  }

  /**
   * Waits for a message that matches the predicate.
   * Returns { message, body } or throws with the inbox contents as evidence.
   */
  async waitForMessage(predicate, { timeoutMs = 120000, pollMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let seen = []
    while (Date.now() < deadline) {
      const list = await this.messages()
      seen = list.map(m => `${m.subject} (${m.from && m.from.address})`)
      for (const message of list) {
        if (!predicate(message)) continue
        const body = await this.read(message.id)
        return { message, body }
      }
      await delay(pollMs)
    }
    throw new Error(
      `mail.tm delivered no matching message within ${timeoutMs}ms. Inbox: ${seen.join(' | ') || 'empty'}`
    )
  }

  /** The newest message whose subject matches, read in full. */
  async latestWithSubject(subjectPattern, options = {}) {
    const { timeoutMs = 120000, pollMs = 3000, since = null } = options
    const deadline = Date.now() + timeoutMs
    let seen = []
    while (Date.now() < deadline) {
      const list = await this.messages()
      const matching = list
        .filter(message => subjectPattern.test(message.subject || ''))
        .filter(message => !since || Date.parse(message.createdAt || '') >= Date.parse(since))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      seen = list.map(m => `${m.subject} (${m.createdAt})`)
      if (matching.length) {
        const message = matching[0]
        const body = await this.read(message.id)
        return { message, body }
      }
      await delay(pollMs)
    }
    throw new Error(
      `mail.tm delivered no matching message within ${timeoutMs}ms. Inbox: ${seen.join(' | ') || 'empty'}`
    )
  }
}

/** Every URL that carries a token, out of the message body (text + html). */
export function extractTokenUrls(message) {
  const parts = []
  if (Array.isArray(message.text)) parts.push(...message.text)
  else if (message.text) parts.push(message.text)
  if (Array.isArray(message.html)) parts.push(...message.html)
  else if (message.html) parts.push(message.html)
  // The HTML part escapes the ampersands between query parameters, so the
  // entity is rebuilt here instead of being written inline.
  const amp = String.fromCharCode(38)
  const ampEntity = new RegExp(amp + 'am' + 'p;', 'gi')
  const raw = parts.join('\n').replace(ampEntity, amp).replace(new RegExp(amp + '#38;', 'g'), amp)
  const urls = raw.match(/https?:\/\/[^\s"'<>)]+/g) || []
  return urls.filter(url => /[?&]token=/.test(url))
}
