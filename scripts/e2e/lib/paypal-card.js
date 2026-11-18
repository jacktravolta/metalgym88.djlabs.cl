// Contract helpers for the PayPal sandbox card scenario.
//
// The helpers keep the scenario focused on the journey while making every
// observation explicit: the quote owns the price, the API owns the approved
// order, and only safe values can reach evidence.

import { blocked, fail } from '../runner.js'
import { StepTimeout } from '../page.js'
import { TEXT } from '../config.js'
import { openApp } from '../scenarios/helpers.js'
import { redactSensitiveValues } from './frames.js'
import { redact } from '../redact.js'

export const ALLOW_FLAG = 'E2E_ALLOW_PAYPAL_SANDBOX'
export const FIXTURE_ENV = {
  number: 'E2E_PAYPAL_CARD_NUMBER',
  expiry: 'E2E_PAYPAL_CARD_EXPIRY',
  cvv: 'E2E_PAYPAL_CARD_CVV',
  name: 'E2E_PAYPAL_CARD_NAME',
}

export const WALLET_SHEET = '.sheet'
export const WALLET_MOVEMENTS = 'Movimientos'
export const USD = 'USD'
export const CARD_COPY = 'Paga con tarjeta — no necesitas cuenta.'
export const CARD_UNAVAILABLE_COPY = [
  'El formulario de tarjeta no está disponible ahora — puedes continuar en la página de pago.',
  "The card form isn't available right now — you can continue on the payment page.",
]
export const SUCCESS_COPY = ['Tu recarga se acreditó', 'Your recharge went through']
export const PAY_BUTTON = 'Añadir'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function payload(body) {
  if (!body || typeof body !== 'object') return {}
  if (body.success === true && body.data && typeof body.data === 'object') return body.data
  if (body.data && typeof body.data === 'object') return body.data
  return body
}

function numberFrom(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function readBalance(body) {
  const data = payload(body)
  const user = data.user && typeof data.user === 'object' ? data.user : {}
  return numberFrom(data.balance, user.balance, data.credits)
}

export function readMovements(body) {
  const data = payload(body)
  const rows = Array.isArray(data.movements) ? data.movements
    : Array.isArray(data.items) ? data.items
      : Array.isArray(data) ? data
        : []
  return rows.map(row => {
    const item = row && typeof row === 'object' ? row : {}
    return {
      id: item.id || item.movement_id || item.uuid || null,
      type: item.type || item.operation || item.kind || '',
      amount: numberFrom(item.amount, item.credits),
      date: item.created_at || item.date || item.ts || null,
    }
  })
}

export function readError(body) {
  const data = payload(body)
  const outer = body && typeof body === 'object' ? body : {}
  const inner = data.error && typeof data.error === 'object' ? data.error
    : outer.error && typeof outer.error === 'object' ? outer.error
      : null
  return {
    code: (inner && inner.code) || data.code || outer.code || null,
    message: (inner && inner.message)
      || (typeof data.error === 'string' ? data.error : null)
      || data.message
      || outer.message
      || null,
  }
}

export function formatUsdCents(cents) {
  const value = Number(cents)
  if (!Number.isFinite(value)) return null
  const whole = value % 100 === 0
  return 'US$' + (value / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export function readFixture(env = process.env) {
  const fixture = {}
  const missing = []
  for (const [field, name] of Object.entries(FIXTURE_ENV)) {
    const value = String(env[name] || '').trim()
    if (!value) missing.push(name)
    fixture[field] = value
  }
  if (missing.length) {
    throw blocked(
      `the sandbox card fixture is not configured (${missing.join(', ')}); no card data was typed and no order was created`,
      { missingEnvironmentVariables: missing }
    )
  }
  return fixture
}

export function safeText(value, fixture) {
  const text = redact(String(value == null ? '' : value))
  return redactSensitiveValues(text, Object.values(fixture || {}))
}

function settled(request) {
  return request && (request.status != null || request.errorText != null)
}

export async function waitForFreshResponses(page, since, paths, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const fresh = page.requests.slice(since)
    if (paths.every(path => fresh.some(request =>
      request.method === 'GET' && request.path === path && settled(request)
    ))) return fresh
    await delay(100)
  }
  throw new StepTimeout(`the wallet did not finish loading ${paths.join(', ')} within ${timeoutMs}ms`, {
    requests: page.requests.slice(since).map(request =>
      `${request.method || '?'} ${request.url} -> ${request.status || request.errorText || 'pending'}`
    ),
  })
}

export async function latestResponse(page, requests, path) {
  const candidates = requests.filter(request =>
    request.method === 'GET' && request.path === path && settled(request)
  )
  const request = candidates.filter(candidate => candidate.status === 200).pop() || candidates.pop() || null
  if (!request) return { request: null, status: null, body: null }
  return {
    request,
    status: request.status,
    body: await page.responseJson(request.id),
  }
}

export async function openWalletAndRead(page) {
  await openApp(page, '/settings')
  await page.expectText(TEXT.wallet, 20000)

  // The mark is taken before the click: the wallet fires its calls on mount.
  const since = page.requests.length
  await page.clickText(TEXT.wallet, { timeoutMs: 20000 })

  const deadline = Date.now() + 25000
  let mounted = false
  while (Date.now() < deadline) {
    const heading = await page.textContaining(WALLET_MOVEMENTS, { scope: WALLET_SHEET }).catch(() => null)
    if (heading) {
      mounted = true
      break
    }
    await delay(120)
  }
  if (!mounted) {
    throw new StepTimeout('the wallet sheet never showed its "Movimientos" heading')
  }

  const fresh = await waitForFreshResponses(page, since, ['/auth/me', '/payments/quote', '/credits/movements'])
  return {
    me: await latestResponse(page, fresh, '/auth/me'),
    quote: await latestResponse(page, fresh, '/payments/quote'),
    movements: await latestResponse(page, fresh, '/credits/movements'),
  }
}

export function readQuote(body) {
  const data = payload(body)
  const paypal = data.paypal && typeof data.paypal === 'object' ? data.paypal : {}
  const currencies = Array.isArray(data.currencies) ? data.currencies
    : Array.isArray(data.options) ? data.options
      : []
  const usd = currencies.find(currency => String(currency.currency || '').toUpperCase() === USD) || null
  const variants = usd && Array.isArray(usd.variants) ? usd.variants : []
  const credited = variants
    .map(variant => ({
      variantId: variant.variant_id || variant.variantId || variant.id || null,
      priceUsdCents: numberFrom(variant.price_usd_cents, variant.priceUsdCents),
      credits: numberFrom(variant.credits),
      label: variant.label || null,
    }))
    .filter(variant => variant.variantId && variant.priceUsdCents != null && variant.credits != null && variant.credits > 0)
    .sort((left, right) => left.priceUsdCents - right.priceUsdCents)
  return {
    environment: String(paypal.environment || '').toLowerCase(),
    usdAvailable: usd ? usd.available === true : false,
    variants: credited,
  }
}

export async function selectUsdVariant(page, variant) {
  await page.clickText(USD, { scope: WALLET_SHEET, exact: true, timeoutMs: 15000 })

  const price = formatUsdCents(variant.priceUsdCents)
  if (!price) throw fail('the selected USD variant carried no usable price')
  const selected = await page.evaluate(`
    const wantedPrice = __args.price;
    const wantedCredits = String(__args.credits);
    const roots = Array.from(document.querySelectorAll('.sheet')).filter(__visible);
    const root = roots.find(sheet => (sheet.innerText || '').includes('Movimientos')) || roots[0];
    if (!root) return { ok: false, reason: 'wallet sheet not found' };
    const candidates = Array.from(root.querySelectorAll('button[aria-pressed]')).filter(button => {
      if (!__visible(button)) return false;
      const text = __norm(button.innerText);
      if (!text.includes(wantedPrice)) return false;
      const credits = text.split(wantedPrice).join('').replace(/[^0-9]/g, '');
      return credits === wantedCredits;
    });
    if (candidates.length !== 1) return { ok: false, reason: 'variant label is not unique', count: candidates.length };
    const button = candidates[0];
    button.click();
    return { ok: true, pressed: button.getAttribute('aria-pressed') };
  `, { args: { price, credits: variant.credits } })
  if (!selected || !selected.ok) {
    throw fail(`the selected USD variant could not be identified uniquely in the wallet (${selected && selected.reason ? selected.reason : 'not found'})`)
  }
  if (selected.pressed !== 'true') {
    throw fail('the selected USD variant did not become the active wallet option')
  }
  return variant
}

export function forbiddenCardKeys(value, found = []) {
  if (!value || typeof value !== 'object') return found
  const forbidden = new Set([
    'number', 'card_number', 'cardnumber', 'cvv', 'cvv2', 'expiry',
    'expiration', 'exp_date', 'name', 'cardholder_name', 'cardholder',
  ])
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(String(key).toLowerCase())) found.push(String(key))
    forbiddenCardKeys(item, found)
  }
  return found
}

export async function closeWalletCardForm(page) {
  const closed = await page.evaluate(`
    const roots = Array.from(document.querySelectorAll('.sheet')).filter(__visible);
    const wallet = roots.find(sheet => (sheet.innerText || '').includes('Movimientos'));
    if (!wallet) return false;
    const close = wallet.querySelector('.sheet-close');
    if (!close) return false;
    close.click();
    return true;
  `).catch(() => false)
  if (!closed) return false
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const visible = await page.waitForText(CARD_COPY, 300).catch(() => false)
    if (!visible) return true
  }
  return false
}

export async function maskVisibleSensitiveValues(page, values) {
  const sensitive = Array.from(new Set(values.map(value => String(value || '')).filter(Boolean)))
    .sort((left, right) => right.length - left.length)
  if (!sensitive.length) return false
  return await page.evaluate(`
    const values = __args.values;
    const walker = document.createTreeWalker(document.body, 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let text = node.nodeValue || '';
      for (const value of values) text = text.split(value).join('[REDACTED]');
      node.nodeValue = text;
    }
    for (const input of document.querySelectorAll('input,textarea')) {
      let value = input.value || '';
      for (const secret of values) value = value.split(secret).join('[REDACTED]');
      input.value = value;
    }
    return true;
  `, { args: { values: sensitive } })
}

export function consoleErrorSummary(page, since, fixture = {}) {
  return page.consoleEntries.slice(since.console)
    .filter(entry => entry.level === 'error' || entry.source === 'exception')
    .map(entry => ({ level: entry.level, text: safeText(entry.text, fixture) }))
    .slice(-10)
}

function providerCardRefusal(page, since) {
  const entry = page.consoleEntries.slice(since.console).find(item =>
    /card payments are not eligible/i.test(item.text || '')
  )
  return entry ? safeText(entry.text, {}) : null
}

export async function waitForCardFields(page, scenarioMark, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const refusal = providerCardRefusal(page, scenarioMark)
    if (refusal) {
      throw blocked(
        'PayPal sandbox refused to mount the card fields (card payments are not eligible); no card was typed and no order was created',
        {
          quoteHttpStatus: 200,
          orderHttpStatus: null,
          providerCode: 'CARD_PAYMENTS_NOT_ELIGIBLE',
          providerMessage: refusal,
          consoleErrors: consoleErrorSummary(page, scenarioMark),
        }
      )
    }
    for (const copy of CARD_UNAVAILABLE_COPY) {
      if (await page.waitForText(copy, 100)) {
        throw blocked(
          'the wallet reported that the sandbox card form is unavailable; no card was typed and no order was created',
          {
            quoteHttpStatus: 200,
            orderHttpStatus: null,
            providerCode: 'CARD_FORM_UNAVAILABLE',
            providerMessage: copy,
            consoleErrors: consoleErrorSummary(page, scenarioMark),
          }
        )
      }
    }
    const fields = []
    for (const field of ['number', 'expiry', 'cvv', 'name']) {
      const found = await page.findFrameField(field)
      if (found) fields.push(found)
    }
    if (fields.length === 4) return fields
    await delay(150)
  }
  throw new StepTimeout(`the PayPal sandbox card fields did not mount within ${timeoutMs}ms`)
}
