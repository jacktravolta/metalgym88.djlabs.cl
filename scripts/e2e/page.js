// Page-level helpers on top of the raw CDP client.
//
// Everything the suite needs to drive a real page lives here: navigation,
// condition-based waits, text-based interaction, console/network capture and
// screenshots.
//
// Two rules shape the implementation:
//
//  · The UI is in Spanish and may change wording, so the selectors are built
//    from VISIBLE TEXT (plus a CSS scope only where the same phrase appears
//    twice on screen). Nothing depends on a generated class name for the
//    element under test.
//  · Interaction goes through Runtime.evaluate and real DOM events. A synthetic
//    click dispatches a genuine `.click()` on the element, and the value setter
//    is the native prototype setter plus `input`/`change` events, so React sees
//    the change exactly as it would from a human typing.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Injected into the page before every expression. */
const PAGE_HELPERS = `
const __norm = s => (s == null ? '' : String(s)).replace(/\\s+/g, ' ').trim();
const __visible = el => {
  if (!el || el.nodeType !== 1) return false;
  if (el.hidden) return false;
  if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
  const st = window.getComputedStyle(el);
  if (!st) return false;
  if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
  if (st.opacity === '0') return false;
  return el.getClientRects().length > 0;
};
const __text = el => __norm(el.innerText != null && el.innerText !== '' ? el.innerText : el.textContent);
const __desc = el => {
  if (!el) return null;
  return {
    tag: el.tagName.toLowerCase(),
    text: __text(el).slice(0, 160),
    id: el.id || null,
    name: el.getAttribute && el.getAttribute('name'),
    placeholder: el.getAttribute && el.getAttribute('placeholder'),
    ariaLabel: el.getAttribute && el.getAttribute('aria-label'),
    href: el.getAttribute && el.getAttribute('href'),
  };
};
const __scopeByHeading = heading => {
  const target = __norm(heading).toLowerCase();
  const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(el => __visible(el) && __text(el).toLowerCase().includes(target));
  if (!heads.length) return null;
  // The scope is the smallest panel around the heading that actually holds
  // form fields: the same wording can appear in a marketing section and in
  // the form itself, and only the second one is the interesting scope.
  const panels = heads.map(head => {
    let el = head;
    while (el && el !== document.body) {
      if (el.querySelector && el.querySelector('input,textarea,select')) return el;
      el = el.parentElement;
    }
    return head.parentElement || head;
  });
  panels.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
  return panels[0];
};
const __resolveScope = scope => {
  if (!scope) return [document.body];
  if (typeof scope === 'string') return Array.from(document.querySelectorAll(scope));
  if (scope.heading) {
    const found = __scopeByHeading(scope.heading);
    return found ? [found] : [];
  }
  return [scope];
};
const __pool = scope => {
  const roots = __resolveScope(scope);
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    if (!root) continue;
    for (const el of root.querySelectorAll('*')) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (__visible(el)) out.push(el);
    }
    if (root !== document.body && root.nodeType === 1 && __visible(root) && !seen.has(root)) {
      seen.add(root);
      out.push(root);
    }
  }
  return out;
};
const __matchesText = (el, needle, exact) => {
  const txt = __text(el).toLowerCase();
  const target = __norm(needle).toLowerCase();
  if (!target) return false;
  return exact ? txt === target : txt.includes(target);
};
const __findText = (needle, scope, exact) => {
  const pool = __pool(scope);
  const matches = pool.filter(el => __matchesText(el, needle, exact));
  if (!matches.length) return null;
  const leaves = matches.filter(el => !matches.some(other => other !== el && el.contains(other)));
  const candidates = leaves.length ? leaves : matches;
  const clickable = candidates.filter(el => {
    const tag = el.tagName.toLowerCase();
    return tag === 'button' || tag === 'a' || tag === 'label' || tag === 'summary' ||
      tag === 'input' || tag === 'textarea' || tag === 'select' || el.getAttribute('role') === 'button';
  });
  const pool2 = clickable.length ? clickable : candidates;
  pool2.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const areaA = ra.width * ra.height;
    const areaB = rb.width * rb.height;
    if (areaA !== areaB) return areaA - areaB;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return pool2[0] || null;
};
const __findField = (target, scope) => {
  const roots = __resolveScope(scope);
  const fields = [];
  for (const root of roots) {
    if (!root) continue;
    for (const el of root.querySelectorAll('input,textarea,select')) {
      if (__visible(el)) fields.push(el);
    }
  }
  if (!fields.length) return null;
  const wanted = __norm(target).toLowerCase();
  const byAttr = fields.filter(el => {
    const ph = __norm(el.getAttribute('placeholder')).toLowerCase();
    const nm = __norm(el.getAttribute('name')).toLowerCase();
    const al = __norm(el.getAttribute('aria-label')).toLowerCase();
    const id = __norm(el.id).toLowerCase();
    return ph === wanted || nm === wanted || al === wanted || id === wanted;
  });
  if (byAttr.length) return byAttr[0];
  const loose = fields.filter(el => {
    const ph = __norm(el.getAttribute('placeholder')).toLowerCase();
    const nm = __norm(el.getAttribute('name')).toLowerCase();
    const al = __norm(el.getAttribute('aria-label')).toLowerCase();
    return ph.includes(wanted) || nm.includes(wanted) || al.includes(wanted);
  });
  return loose[0] || null;
};
const __findCheckbox = (needle, scope) => {
  const target = __norm(needle).toLowerCase();
  const roots = __resolveScope(scope);
  const boxes = [];
  for (const root of roots) {
    if (!root) continue;
    for (const el of root.querySelectorAll('input[type=checkbox], input[type=radio]')) {
      if (__visible(el)) boxes.push(el);
    }
  }
  const scored = boxes.filter(el => {
    const holder = el.closest('label') || el.closest('form') || el.parentElement || el;
    return __norm(holder.innerText).toLowerCase().includes(target);
  });
  return scored[0] || null;
};
const __setValue = (el, value) => {
  const tag = el.tagName.toUpperCase();
  const proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : tag === 'SELECT' ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const __click = el => {
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  return __desc(el);
};
`

/** Wraps a body of code with the page helpers and evaluates it. */
function expression(body) {
  return `(async () => { ${PAGE_HELPERS}\n${body}\n})()`
}

function describeException(details) {
  if (!details) return 'unknown page exception'
  const exception = details.exception || {}
  return exception.description || exception.value || details.text || 'unknown page exception'
}

/**
 * True when navigating from `before` to `after` only changes the fragment:
 * the browser then performs a same-document navigation and NO load event ever
 * fires (which is why the callers reload when they need a fresh boot).
 */
function sameDocumentNavigation(before, after) {
  if (!before) return false
  try {
    const a = new URL(before)
    const b = new URL(after)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return false
  }
}

/** Raised when a bounded wait expires. The runner turns it into BLOCKED. */
export class StepTimeout extends Error {
  constructor(message, lastState = null) {
    super(message)
    this.name = 'StepTimeout'
    this.lastState = lastState
  }
}

/**
 * Raised when the BROWSER refused a platform call.
 *
 * This is not a timeout and not a harness limitation: the request never left
 * the page because the CORS preflight was refused (or answered without
 * Access-Control-Allow-Origin). The runner turns it into a FAIL — the product
 * is broken for the person using it, not for the suite.
 */
export class CorsBlocked extends Error {
  constructor(message, diagnosis = null) {
    super(message)
    this.name = 'CorsBlocked'
    this.diagnosis = diagnosis
  }
}

export class Page {
  constructor(conn, sessionId, opts = {}) {
    this.conn = conn
    this.sessionId = sessionId
    this.artifactDir = opts.artifactDir || null
    this.screenshotDir = opts.screenshotDir || null
    this.consoleEntries = []
    this.requests = []
    this.inflight = new Set()
    this.lastActivityAt = Date.now()
    this.screenshots = []
    this.pageOrigin = null
    this.bodyErrors = []
    this.#bind()
  }

  send(method, params = {}, timeoutMs = 30000) {
    return this.conn.send(method, params, this.sessionId, timeoutMs)
  }

  #bind() {
    const on = (method, handler) => {
      this.conn.on(method, (params, sessionId) => {
        if (sessionId && sessionId !== this.sessionId) return
        try { handler(params) } catch (e) {
          console.error(`[page] ${method} handler threw:`, e && e.message)
        }
      })
    }

    on('Runtime.consoleAPICalled', params => {
      const text = (params.args || [])
        .map(a => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(' ')
      this.consoleEntries.push({
        source: 'console',
        level: params.type,
        text: String(text).slice(0, 2000),
        url: params.stackTrace && params.stackTrace.callFrames && params.stackTrace.callFrames[0]
          ? params.stackTrace.callFrames[0].url
          : null,
        line: params.stackTrace && params.stackTrace.callFrames && params.stackTrace.callFrames[0]
          ? params.stackTrace.callFrames[0].lineNumber
          : null,
      })
    })

    on('Runtime.exceptionThrown', params => {
      const details = params.exceptionDetails || {}
      this.consoleEntries.push({
        source: 'exception',
        level: 'error',
        text: String(describeException(details)).slice(0, 2000),
        url: details.url || null,
        line: details.lineNumber != null ? details.lineNumber : null,
      })
    })

    on('Log.entryAdded', params => {
      const entry = params.entry || {}
      this.consoleEntries.push({
        source: 'log',
        level: entry.level || 'info',
        text: String(entry.text || '').slice(0, 2000),
        url: entry.url || null,
        line: entry.lineNumber != null ? entry.lineNumber : null,
      })
    })

    on('Network.requestWillBeSent', params => {
      const request = params.request || {}
      let parsed = null
      try { parsed = new URL(request.url) } catch { /* data: and blob: urls */ }
      const headers = {}
      for (const [key, value] of Object.entries(request.headers || {})) {
        const lower = key.toLowerCase()
        if (lower === 'cookie' || lower === 'authorization') continue
        headers[lower] = value
      }
      const record = {
        id: params.requestId,
        method: request.method,
        url: request.url,
        host: parsed ? parsed.host : null,
        path: parsed ? parsed.pathname : null,
        query: parsed ? parsed.search : null,
        type: params.type || null,
        headers,
        postData: request.postData ? String(request.postData).slice(0, 20000) : null,
        status: null,
        statusText: null,
        mimeType: null,
        errorText: null,
        // A redirect chain shows up as a request that carries the previous
        // response: the suite reports it instead of hiding it.
        redirectStatus: params.redirectResponse ? params.redirectResponse.status : null,
        redirectUrl: params.redirectResponse ? params.redirectResponse.url : null,
        startedAt: Date.now(),
      }
      const existing = this.requests.find(r => r.id === record.id)
      if (existing) {
        // A redirect reuses the request id: the hop that answers with the
        // redirect must not be lost when the next hop lands on the same id.
        const redirectStatus = record.redirectStatus != null ? record.redirectStatus : existing.redirectStatus
        const redirectUrl = record.redirectUrl != null ? record.redirectUrl : existing.redirectUrl
        Object.assign(existing, record)
        existing.redirectStatus = redirectStatus
        existing.redirectUrl = redirectUrl
      } else this.requests.push(record)
      this.inflight.add(params.requestId)
      this.lastActivityAt = Date.now()
      // The document request tells the harness which origin the page runs on:
      // a cross-origin call from there needs the platform's CORS answer.
      if (params.type === 'Document' && parsed) this.pageOrigin = parsed.origin
    })

    on('Network.responseReceived', params => {
      const record = this.requests.find(r => r.id === params.requestId)
      if (!record) return
      record.status = params.response ? params.response.status : null
      record.statusText = params.response ? params.response.statusText : null
      record.mimeType = params.response ? params.response.mimeType : null
      record.responseAt = Date.now()
      this.inflight.delete(params.requestId)
      this.lastActivityAt = Date.now()
    })

    on('Network.loadingFailed', params => {
      const record = this.requests.find(r => r.id === params.requestId)
      this.inflight.delete(params.requestId)
      this.lastActivityAt = Date.now()
      if (record) {
        record.errorText = params.errorText || 'loading failed'
        record.canceled = !!params.canceled
      } else {
        this.requests.push({
          id: params.requestId,
          method: null,
          url: null,
          host: null,
          path: null,
          status: null,
          errorText: params.errorText || 'loading failed',
          startedAt: Date.now(),
        })
      }
    })
  }

  /** Turns on the domains the suite listens to. */
  async enable() {
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Network.enable'),
      this.send('Log.enable'),
    ])
  }

  /** Evaluates an expression in the page and returns its value. */
  async evaluate(body, { timeoutMs = 30000, args = null } = {}) {
    const source = args ? expression(`const __args = ${JSON.stringify(args)};\n${body}`) : expression(body)
    const result = await this.send(
      'Runtime.evaluate',
      { expression: source, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs
    )
    if (result.exceptionDetails) throw new Error(`page evaluation failed: ${describeException(result.exceptionDetails)}`)
    return result.result ? result.result.value : undefined
  }

  /** Waits for the page to be ready (load event, then a quiet network). */
  async waitIdle(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    // readyState complete
    while (Date.now() < deadline) {
      const ready = await this.evaluate('return document.readyState').catch(() => null)
      if (ready === 'complete' || ready === 'interactive') break
      await new Promise(r => setTimeout(r, 100))
    }
    // network quiet: no request in flight for a short window
    while (Date.now() < deadline) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivityAt > 300) return true
      await new Promise(r => setTimeout(r, 100))
    }
    return false
  }

  /** Navigates and waits for the load event. Returns what was loaded. */
  async goto(url, { timeoutMs = 30000 } = {}) {
    const before = await this.currentUrl().catch(() => '')
    const sameDocument = sameDocumentNavigation(before, url)
    const loaded = sameDocument ? Promise.resolve(false) : this.#waitForLoad(timeoutMs)
    const nav = await this.send('Page.navigate', { url }, timeoutMs)
    if (nav && nav.errorText) throw new Error(`navigation to ${url} failed: ${nav.errorText}`)
    await loaded
    await this.waitIdle(Math.min(timeoutMs, 15000))
    const document = this.requests.filter(r => r.type === 'Document').pop() || null
    return {
      requested: url,
      finalUrl: await this.currentUrl().catch(() => null),
      status: document ? document.status : null,
      request: document,
    }
  }

  /** Reloads the current document and waits for it. */
  async reload({ timeoutMs = 30000 } = {}) {
    const loaded = this.#waitForLoad(timeoutMs)
    await this.send('Page.reload', { ignoreCache: false }, timeoutMs)
    await loaded
    await this.waitIdle(Math.min(timeoutMs, 15000))
    return this.currentUrl()
  }

  #waitForLoad(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new StepTimeout(`the page did not fire loadEventFired within ${timeoutMs}ms`))
      }, timeoutMs)
      const off = this.conn.on('Page.loadEventFired', (_params, sessionId) => {
        if (sessionId && sessionId !== this.sessionId) return
        clearTimeout(timer)
        off()
        resolve(true)
      })
    })
  }

  async currentUrl() {
    return this.evaluate('return location.href')
  }

  async title() {
    return this.evaluate('return document.title')
  }

  /** Waits until a visible text shows up. Returns true/false (never throws). */
  async waitForText(text, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = await this.evaluate(
        'return __findText(__args.text, null, false) ? true : false',
        { args: { text } }
      ).catch(() => false)
      if (found) return true
      await new Promise(r => setTimeout(r, 120))
    }
    return false
  }

  /** Waits until a visible text shows up; throws a StepTimeout when it never does. */
  async expectText(text, timeoutMs = 10000, lastState = null) {
    const ok = await this.waitForText(text, timeoutMs)
    if (!ok) {
      throw new StepTimeout(`the text "${text}" did not show up within ${timeoutMs}ms`, lastState)
    }
    return true
  }

  /** Clicks the element whose visible text matches. Returns a description of it. */
  async clickText(text, { scope = null, exact = false, timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let desc = null
    while (Date.now() < deadline) {
      desc = await this.evaluate(
        'const el = __findText(__args.text, __args.scope, __args.exact); return el ? __click(el) : null',
        { args: { text, scope, exact } }
      ).catch(() => null)
      if (desc) return desc
      await new Promise(r => setTimeout(r, 120))
    }
    throw new StepTimeout(`no clickable element with the text "${text}" appeared within ${timeoutMs}ms`, {
      scope,
      pageText: await this.bodyText().catch(() => ''),
    })
  }

  /** Fills an input/textarea found by CSS selector, placeholder, name or aria-label. */
  async fill(target, value, { scope = null, timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const done = await this.evaluate(
        `const el = __findField(__args.target, __args.scope);
         if (!el) return null;
         __setValue(el, __args.value);
         return __desc(el);`,
        { args: { target, value, scope } }
      ).catch(() => null)
      if (done) return done
      await new Promise(r => setTimeout(r, 120))
    }
    throw new StepTimeout(`no field matching "${target}" appeared within ${timeoutMs}ms`, {
      scope,
      pageText: await this.bodyText().catch(() => ''),
    })
  }

  /** Ticks the checkbox whose label/holder text mentions the given phrase. */
  async checkByText(phrase, { scope = null, timeoutMs = 10000 } = {}) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const done = await this.evaluate(
        `const el = __findCheckbox(__args.phrase, __args.scope);
         if (!el) return null;
         if (!el.checked) el.click();
         return { ...__desc(el), checked: el.checked };`,
        { args: { phrase, scope } }
      ).catch(() => null)
      if (done) return done
      await new Promise(r => setTimeout(r, 120))
    }
    throw new StepTimeout(`no checkbox mentioning "${phrase}" appeared within ${timeoutMs}ms`, {
      scope,
      pageText: await this.bodyText().catch(() => ''),
    })
  }

  /** Reads the visible text of the first element matching a CSS selector. */
  async textOf(selector) {
    return this.evaluate(
      'const el = document.querySelector(__args.selector); return el ? __text(el) : null',
      { args: { selector } }
    )
  }

  /** The visible text of the smallest element that mentions the phrase. */
  async textContaining(phrase, { scope = null } = {}) {
    return this.evaluate(
      `const el = __findText(__args.phrase, __args.scope, false);
       return el ? __text(el) : null;`,
      { args: { phrase, scope } }
    )
  }

  /** The visible text of the first heading of the given level. */
  async headingText(level = 'h1') {
    return this.evaluate(
      `const el = Array.from(document.querySelectorAll(__args.level)).find(e => __visible(e));
       return el ? __text(el) : null;`,
      { args: { level } }
    )
  }

  /** Waits until the page's first heading shows the given text. */
  async waitForHeading(text, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    let heading = null
    while (Date.now() < deadline) {
      heading = await this.headingText('h1').catch(() => null)
      if (heading && heading.toLowerCase().includes(String(text).toLowerCase())) return heading
      await new Promise(r => setTimeout(r, 120))
    }
    return null
  }

  /** The whole visible text of the page (truncated). */
  async bodyText(limit = 20000) {
    return this.evaluate(
      'return __norm(document.body ? document.body.innerText : "").slice(0, __args.limit)',
      { args: { limit } }
    )
  }

  /** The serialized document. */
  async html() {
    return this.evaluate('return document.documentElement.outerHTML')
  }

  /** Every visible link/button whose text mentions the given phrase. */
  async linksWithText(phrase) {
    return this.evaluate(
      `const target = __norm(__args.phrase).toLowerCase();
       return Array.from(document.querySelectorAll('a,button'))
         .filter(el => __visible(el) && __text(el).toLowerCase().includes(target))
         .map(el => ({ ...__desc(el), href: el.href || null }));`,
      { args: { phrase } }
    )
  }

  /** The aria-label of the first visible element that carries the phrase. */
  async ariaLabelWithText(phrase) {
    return this.evaluate(
      `const target = __norm(__args.phrase).toLowerCase();
       const el = Array.from(document.querySelectorAll('[aria-label]'))
         .find(e => __visible(e) && __norm(e.getAttribute('aria-label')).toLowerCase().includes(target));
       return el ? el.getAttribute('aria-label') : null;`,
      { args: { phrase } }
    )
  }

  /** Waits until an element with the given aria-label shows up. */
  async waitForAriaLabel(phrase, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    let label = null
    while (Date.now() < deadline) {
      label = await this.ariaLabelWithText(phrase).catch(() => null)
      if (label) return label
      await new Promise(r => setTimeout(r, 150))
    }
    return null
  }

  /** Waits for a captured request matching the predicate. */
  async waitForRequest(predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = this.requests.find(predicate)
      if (found) return found
      await new Promise(r => setTimeout(r, 100))
    }
    throw new StepTimeout(`the expected request did not happen within ${timeoutMs}ms`, {
      requests: this.requests.map(r => `${r.method || '?'} ${r.url} -> ${r.status || r.errorText || 'pending'}`),
    })
  }

  /** Waits for a request whose response status is known. */
  async waitForResponse(predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = this.requests.find(r => r.status != null && predicate(r))
      if (found) return found
      await new Promise(r => setTimeout(r, 100))
    }
    throw new StepTimeout(`the expected response did not arrive within ${timeoutMs}ms`, {
      requests: this.requests.map(r => `${r.method || '?'} ${r.url} -> ${r.status || r.errorText || 'pending'}`),
    })
  }

  /** Reads a captured response body (same-origin or already cached by CDP). */
  async responseBody(requestId) {
    try {
      const result = await this.send('Network.getResponseBody', { requestId })
      return result.body
    } catch (e) {
      // CDP forgets the body of a request it no longer holds (a redirect, a
      // cached answer, a request evicted from the buffer). That is a fact of
      // the harness, not of the product: it is recorded, not thrown.
      this.bodyErrors.push({ requestId, error: e && e.message ? e.message : String(e) })
      return null
    }
  }

  /** Parsed response body, best effort. */
  async responseJson(requestId) {
    const body = await this.responseBody(requestId)
    if (body == null) return null
    try { return JSON.parse(body) } catch { return null }
  }

  /** Console entries that name a CORS refusal. */
  corsConsoleErrors() {
    return this.consoleEntries.filter(e =>
      /blocked by CORS policy|CORS policy: Response to preflight/i.test(e.text || '')
    )
  }

  /** The CORS preflights the browser sent, with what the server answered. */
  preflights() {
    return this.requests.filter(r => r.method === 'OPTIONS')
  }

  /**
   * The CORS refusal that concerns one URL, or null when there is none.
   *
   * The diagnosis carries the evidence the report needs: the preflight and
   * its status, the console sentence the browser wrote, and the origin the
   * page ran on. `since` scopes the search to one scenario (see `mark()`), so
   * a refusal seen earlier is never charged to a later scenario.
   */
  corsDiagnosisFor(url, { since = null } = {}) {
    const needle = url ? String(url).split('?')[0] : null
    const entries = since ? this.consoleEntries.slice(since.console) : this.consoleEntries
    const requests = since ? this.requests.slice(since.requests) : this.requests
    const entry = entries
      .filter(e => /blocked by CORS policy|CORS policy: Response to preflight/i.test(e.text || ''))
      .find(e => !needle || (e.text || '').includes(needle))
    if (!entry) return null
    const failed = requests.filter(r => r.errorText && (!needle || (r.url || '').includes(needle)))
    const preflights = requests.filter(r => r.method === 'OPTIONS' && (!needle || (r.url || '').includes(needle)))
    // The last preflight that carries an answer is the one that explains the
    // refusal; a preflight still in flight says nothing.
    const preflight = preflights.filter(r => r.status != null).pop() || preflights.pop() || null
    // The URL of the refused call: the one that was asked for, or the one the
    // browser named in its console sentence.
    const target = needle
      || (failed[0] && failed[0].url)
      || (preflight && preflight.url)
      || ((entry.text.match(/Access to fetch at '([^']+)'/) || [])[1])
      || 'an unknown platform URL'
    let apiHost = null
    try { apiHost = target ? new URL(target).host : null } catch { /* keep null */ }
    const preflightText = preflight
      ? `the CORS preflight ${preflight.method} ${preflight.url} answered HTTP ${preflight.status != null ? preflight.status : 'without an answer'} and carried no Access-Control-Allow-Origin header`
      : 'the answer carried no Access-Control-Allow-Origin header, so the browser refused to hand it to the page'
    const errorText = failed.map(f => f.errorText).filter(Boolean)[0] || null
    const fateText = errorText
      ? `the request never left the page (${errorText})`
      : 'the request was sent, but the browser refused to hand the answer to the page'
    return {
      origin: this.pageOrigin,
      apiHost,
      url: target,
      preflight: preflight ? { url: preflight.url, status: preflight.status } : null,
      console: entry.text,
      failedRequests: failed.map(f => ({ method: f.method, url: f.url, error: f.errorText })),
      message:
        `the browser refused the platform call to ${target} (${preflightText}), so ${fateText}. ` +
        `The page runs on ${this.pageOrigin || 'an unknown origin'} and the console said: ${entry.text}`,
    }
  }

  /** Console errors and uncaught exceptions seen so far. */
  consoleErrors() {
    return this.consoleEntries.filter(e => e.level === 'error' || e.source === 'exception')
  }

  /**
   * The current position in the console/request logs.
   *
   * A scenario takes a mark when it starts and scopes its searches to it, so
   * a refusal or a failure seen in an earlier scenario is never charged to a
   * later one.
   */
  mark() {
    return { console: this.consoleEntries.length, requests: this.requests.length }
  }

  /** Requests that failed at the network level or answered 4xx/5xx. */
  failedRequests() {
    return this.requests.filter(r => r.errorText || (typeof r.status === 'number' && r.status >= 400))
  }

  /** Saves a PNG screenshot into the artifacts directory. */
  async screenshot(name) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000)
    const fileName = `${name}.png`
    const dir = this.screenshotDir || this.artifactDir
    if (!dir) return { name: fileName, path: null }
    await mkdir(dir, { recursive: true })
    const path = join(dir, fileName)
    await writeFile(path, Buffer.from(shot.data, 'base64'))
    this.screenshots.push(path)
    return { name: fileName, path }
  }
}
