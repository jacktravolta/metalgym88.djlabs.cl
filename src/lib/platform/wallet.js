// Wallet operations against the djlabs platform, scoped to the metalgym88 heart.
//
// The balance itself lives in the store (set at boot and refreshed by GET /auth/me);
// this module owns everything around it: movements, active tariffs, recharge limits,
// order creation and the return-from-payment-gateway voucher check.
//
// Idempotency contract: ONE Idempotency-Key per top-up attempt cycle, not per HTTP
// call. Network failures retried inside createOrder reuse the SAME key, so the
// platform recognizes the replay and hands back the same unresolved order instead of
// charging twice. Only the user starting a NEW recharge generates a new key.
//
// Payment provider is deliberately unnamed everywhere (client copy included): the
// gateway is platform-side and provider-agnostic.
import { phttp } from './http.js'
import { withHeart, withHeartQuery } from './config.js'
import { fmtNum } from '../format.js'

/* ============================ limits ============================ */

// Server owns the truth; the client only mirrors it as a UX hint. Accepts either a
// flat { min_clp, max_clp } or a nested { limits: {...} } envelope; null when the
// platform gives nothing usable (the UI then only offers the preset packs).
export function normalizeLimits(data) {
  const l = data && typeof data === 'object' && !Array.isArray(data) && typeof data.limits === 'object'
    ? data.limits
    : data
  const pick = obj => !obj || typeof obj !== 'object' ? {} : obj
  const o = pick(l)
  const min = typeof o.min_clp === 'number' ? o.min_clp : typeof o.min === 'number' ? o.min : null
  const max = typeof o.max_clp === 'number' ? o.max_clp : typeof o.max === 'number' ? o.max : null
  return min == null && max == null ? null : { min, max }
}

export async function fetchLimits() {
  return normalizeLimits(await phttp(withHeartQuery('/payments/limits'), {}))
}

// Client-side clamp is a UX hint only — the order endpoint re-clamps server-side.
export function clampAmount(v, limits) {
  let a = Math.round(Number(v) || 0)
  if (limits) {
    if (typeof limits.min === 'number') a = Math.max(limits.min, a)
    if (typeof limits.max === 'number') a = Math.min(limits.max, a)
  }
  return a
}

/* ============================ quote ============================ */

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const stringOrNull = value => typeof value === 'string' && value.trim() ? value.trim() : null
const currencyCode = value => {
  const code = stringOrNull(value)?.toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : null
}
const booleanOrNull = value => typeof value === 'boolean' ? value : null

function normalizeVariant(raw) {
  if (!isObject(raw)) return null
  const variantId = stringOrNull(raw.variant_id) || stringOrNull(raw.variantId) || stringOrNull(raw.id)
  if (!variantId) return null
  // The API owns the USD price as integer cents; older payloads may still send
  // dollars. Both become the same integer here, so the UI never parses a label.
  const cents = numberOrNull(raw.price_usd_cents) ?? numberOrNull(raw.priceUsdCents)
  const dollars = numberOrNull(raw.price_usd) ?? numberOrNull(raw.priceUsd) ?? numberOrNull(raw.price)
  return {
    variantId,
    priceUsdCents: cents != null ? Math.round(cents) : dollars != null ? Math.round(dollars * 100) : null,
    priceUsd: dollars ?? (cents != null ? cents / 100 : null),
    credits: numberOrNull(raw.credits),
    amountClp: numberOrNull(raw.amount_clp) ?? numberOrNull(raw.amountClp),
    label: stringOrNull(raw.label),
    // A card price may carry its own IVA-inclusive breakdown. Per-variant beats
    // the quote-level block: the buyer must see the tax of the price they pick.
    iva: normalizeIva(raw.iva),
  }
}

// The quote may carry the public PayPal client id for the card-fields SDK.
// Without it the card form stays off and the wallet keeps the gateway redirect.
export function normalizePaypalInfo(raw) {
  if (!isObject(raw)) return null
  const clientId = stringOrNull(raw.client_id) || stringOrNull(raw.clientId)
  if (!clientId) return null
  const environment = stringOrNull(raw.environment)?.toLowerCase()
  return { clientId, environment: environment === 'live' ? 'live' : 'sandbox' }
}

// The quote carries the PUBLIC Mercado Pago key for the browser Brick. It is
// never an environment variable in this bundle: the backend owns the key and
// advertises it with the quote.
export function normalizeMercadoPagoInfo(raw) {
  if (!isObject(raw)) return null
  const publicKey = stringOrNull(raw.public_key) || stringOrNull(raw.publicKey)
  if (!publicKey) return null
  const environment = stringOrNull(raw.environment)?.toLowerCase() || null
  return { publicKey, environment }
}

// Provider methods belong to the client. The backend publishes provider keys
// per currency; it deliberately does not declare whether each rail redirects
// or renders fields in the browser.
const PAYMENT_PROVIDER_METHODS = Object.freeze({
  flow: 'redirect',
  paypal: 'card',
  mercadopago: 'card',
})

export function paymentProviderMethod(provider) {
  return PAYMENT_PROVIDER_METHODS[stringOrNull(provider)?.toLowerCase()] || null
}

// Normalizes the provider keys advertised for one currency. Unknown or
// malformed values are ignored: the wallet never invents an unsupported rail.
export function normalizeProviderKeys(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  return raw.map(value => {
    if (typeof value !== 'string') return null
    const key = value.trim().toLowerCase()
    if (!key || !paymentProviderMethod(key) || seen.has(key)) return null
    seen.add(key)
    return key
  }).filter(Boolean)
}

// The card rail is available only when both facts are present for the selected
// currency: the backend advertises it and the quote carries the public key.
export function hasMercadoPagoRail(providers, mercadopago) {
  const advertised = Array.isArray(providers) && providers.includes('mercadopago')
  const info = isObject(mercadopago) ? mercadopago : {}
  const publicKey = stringOrNull(info.publicKey) || stringOrNull(info.public_key)
  return advertised && !!publicKey
}

// The IVA breakdown is optional. A partial breakdown is treated as absent so
// the UI never displays an incomplete tax calculation.
export function normalizeIva(raw) {
  if (!isObject(raw)) return null
  const net = numberOrNull(raw.net)
  const iva = numberOrNull(raw.iva)
  const total = numberOrNull(raw.total)
  return net == null || iva == null || total == null ? null : { net, iva, total }
}

function normalizeCurrency(raw) {
  if (!isObject(raw)) return null
  const currency = currencyCode(raw.currency) || currencyCode(raw.currency_code) || currencyCode(raw.code)
  if (!currency) return null
  const rawPresets = Array.isArray(raw.presets) ? raw.presets : Array.isArray(raw.amounts) ? raw.amounts : []
  const rawVariants = Array.isArray(raw.variants) ? raw.variants : Array.isArray(raw.prices) ? raw.prices : []
  return {
    currency,
    available: booleanOrNull(raw.available) ?? booleanOrNull(raw.enabled) ?? true,
    reason: stringOrNull(raw.reason),
    minClp: numberOrNull(raw.min_clp) ?? numberOrNull(raw.min),
    maxClp: numberOrNull(raw.max_clp) ?? numberOrNull(raw.max),
    presets: rawPresets.map(Number).filter(n => Number.isFinite(n) && n > 0).map(n => Math.round(n)),
    variants: rawVariants.map(normalizeVariant).filter(Boolean),
    // null means the quote predates per-currency provider keys; [] means the
    // backend explicitly advertised no available provider for this currency.
    providers: Array.isArray(raw.providers) ? normalizeProviderKeys(raw.providers) : null,
  }
}

// The platform may answer with the current currencies[] contract or the earlier
// options[] contract. Both become the same small, UI-ready shape here; malformed
// data becomes null so the wallet can keep its existing CLP-only behaviour.
export function normalizeQuote(data) {
  const source = isObject(data) && isObject(data.data) && !Array.isArray(data.currencies) && !Array.isArray(data.options)
    ? data.data
    : data
  if (!isObject(source)) return null
  const rows = Array.isArray(source.currencies) ? source.currencies : Array.isArray(source.options) ? source.options : []
  const currencies = rows.map(normalizeCurrency).filter(Boolean)
  if (!currencies.length) return null
  const detectedCurrency = currencyCode(source.detected_currency)
  const paypal = normalizePaypalInfo(source.paypal)
  const mercadopago = normalizeMercadoPagoInfo(source.mercadopago)
  return {
    detectedCountry: stringOrNull(source.detected_country)?.toUpperCase() || null,
    detectedCurrency,
    defaultCurrency: currencyCode(source.default_currency),
    selectedProvider: stringOrNull(source.selected_provider)?.toLowerCase() || null,
    providers: normalizeProviderKeys(source.providers),
    paypal,
    mercadopago,
    iva: normalizeIva(source.iva),
    currencies,
  }
}

// The platform default currency is the only source for the initial selection.
// detected_currency is just a hint and must never route a buyer away from the
// rail the platform selected for everyone.
export function selectInitialCurrency(quote) {
  if (!isObject(quote) || !Array.isArray(quote.currencies)) return null
  const available = quote.currencies.filter(currency => currency && currency.available)
  return available.find(currency => currency.currency === quote.defaultCurrency) || available[0] || null
}

// Older quotes did not advertise providers per currency. Their previous wallet
// behaviour remains: USD used PayPal when it was configured; every other
// currency used the redirect rail.
export function availableProvidersForCurrency(currencyRow, quote) {
  if (!isObject(currencyRow)) return []
  if (Array.isArray(currencyRow.providers)) return currencyRow.providers
  if (currencyRow.currency === 'USD' && quote && quote.paypal) return ['paypal']
  return ['flow']
}

// The rail to name when the person chooses NOT to pay by card. A currency the
// heart bills through the in-app card form (Mercado Pago) has NO redirect
// alternative: naming one would charge through a gateway the heart never chose
// for that currency. null means "this currency has no other rail" — the wallet
// hides the alternative instead of inventing one.
export function alternativeRailProvider(currencyRow, quote) {
  const advertised = availableProvidersForCurrency(currencyRow, quote)
    .map(name => stringOrNull(name)?.toLowerCase())
    .filter(Boolean)
  if (advertised.includes('mercadopago')) return null
  return advertised.find(name => name !== 'fake') || null
}

// A missing quote endpoint is expected while the API is being deployed. Every
// failure is therefore quiet: null means "use the existing CLP-only recharge".
export async function fetchQuote(options = {}) {
  try {
    const provider = stringOrNull(options.provider)?.toLowerCase() || null
    const currency = currencyCode(options.currency)
    const query = new URLSearchParams()
    if (provider) query.set('provider', provider)
    if (currency) query.set('currency', currency)
    const path = '/payments/quote' + (query.size ? '?' + query.toString() : '')
    return normalizeQuote(await phttp(withHeartQuery(path), {}))
  } catch {
    return null
  }
}

// CLP keeps the app's current integer/separator treatment. USD uses the standard
// two-decimal US dollar notation so its cents are always visible.
export function formatMoney(amount, currency = 'CLP') {
  const value = Number(amount)
  const safe = Number.isFinite(value) ? value : 0
  if (currencyCode(currency) === 'USD') {
    return 'US$' + safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return fmtNum(Math.round(safe))
}

// Whole-dollar packs read as "US$5", not "US$5.00"; a price with real cents keeps
// them ("US$5.50"). Input is the integer cents the API owns.
export function formatUsdCents(cents) {
  const value = Number(cents)
  if (!Number.isFinite(value)) return null
  const whole = value % 100 === 0
  return 'US$' + (value / 100).toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

// One display price for a server-owned USD variant: cents first, older dollars
// payloads second, the server label last. The UI never parses the label.
export function usdPriceLabel(variant) {
  if (!isObject(variant)) return null
  if (numberOrNull(variant.priceUsdCents) != null) return formatUsdCents(variant.priceUsdCents)
  if (numberOrNull(variant.priceUsd) != null) return formatUsdCents(Math.round(variant.priceUsd * 100))
  return variant.label || null
}

// The USD pack row: the same list the CLP chips use, built from the quote so the
// client only renders what the server offers (price in dollars, credits below).
export function usdPacks(currencyRow) {
  const variants = isObject(currencyRow) && Array.isArray(currencyRow.variants) ? currencyRow.variants : []
  return variants.map(variant => ({
    variantId: variant.variantId,
    price: usdPriceLabel(variant) || '—',
    credits: variant.credits,
  }))
}

// The custom amount field is CLP-only: USD prices belong to the server variants.
export function showsCustomAmount(currency) {
  return currencyCode(currency) === 'CLP'
}

/* ============================ movements ============================ */

// English keys, translated through t() in the component (locale packs come later).
export const MOVEMENT_LABELS = {
  WELCOME_CREDIT: 'Welcome credit',
  PURCHASE_CREDIT: 'Credit purchase',
  USAGE_DEBIT: 'AI usage',
  REFUND: 'Refund',
  ADMIN_ADJUSTMENT: 'Balance adjustment',
  REFERRAL_CREDIT: 'Referral credit',
}

// Unknown types still read as text, never as a code dump: GYM_BONUS → "Gym bonus".
const humanize = code => String(code || '').toLowerCase().replace(/_/g, ' ').trim()
export function movementLabel(type) {
  return MOVEMENT_LABELS[type] || (type ? humanize(type).replace(/^\w/, c => c.toUpperCase()) : 'Movement')
}

// Direction: money OUT is a negative amount OR a debit type — whichever signal the
// row carries. Only rows that are neither (unknown type, bare positive amount)
// default to credit, so nothing ever reads as a debit by accident.
export function movementDirection(type, amount) {
  if ((typeof amount === 'number' && amount < 0) || type === 'USAGE_DEBIT' || type === 'DEBIT') return -1
  return 1
}

// Accepts { movements: [...] } (+ optional has_more), { items: [...] }, or a bare array.
export function normalizeMovements(data) {
  const env = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const src = Array.isArray(data) ? data : Array.isArray(env.movements) ? env.movements : Array.isArray(env.items) ? env.items : []
  const hasMore = typeof env.has_more === 'boolean' ? env.has_more : env.hasMore === true
  const items = src.map(m => {
    m = m && typeof m === 'object' ? m : {}
    const type = m.type || m.operation || m.kind || ''
    const amount = typeof m.amount === 'number' ? m.amount : typeof m.credits === 'number' ? m.credits : null
    return {
      type,
      label: movementLabel(type),
      amount: amount == null ? null : Math.abs(amount),
      dir: movementDirection(type, amount),
      date: m.created_at || m.date || m.ts || null,
    }
  })
  return { items, hasMore }
}

export async function fetchMovements(page = 1) {
  const data = await phttp(withHeartQuery('/credits/movements?page=' + encodeURIComponent(page)), {})
  return normalizeMovements(data)
}

// server movement rows carry full ISO timestamps; the day is the calendar part.
function movementDay(date) {
  if (!date) return null
  const s = String(date).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00')) ? s : null
}

// Groups the loaded movements by calendar day, preserving the newest-first order
// the API returned. Each group carries its signed net and one entry per movement
// type, so the header can say "net +8.000 · purchase +10.000 · use −2.000".
// Undated rows stay visible in a single trailing group instead of disappearing.
export function groupMovements(items) {
  const groups = []
  const byDay = new Map()
  for (const movement of Array.isArray(items) ? items : []) {
    if (!isObject(movement)) continue
    const day = movementDay(movement.date)
    const key = day || ''
    let group = byDay.get(key)
    if (!group) {
      group = { day, items: [], net: 0, types: [] }
      byDay.set(key, group)
      groups.push(group)
    }
    group.items.push(movement)
    const amount = typeof movement.amount === 'number' ? Math.abs(movement.amount) : 0
    const signed = movementDirection(movement.type, movement.amount) * amount
    group.net += signed
    const type = movement.type || ''
    let typeRow = group.types.find(row => row.type === type)
    if (!typeRow) {
      typeRow = { type, label: movement.label, total: 0 }
      group.types.push(typeRow)
    }
    typeRow.total += signed
  }
  return groups
}

/* ============================ tariffs ============================ */

export const TARIFF_LABELS = {
  chat_simple: 'AI chat question',
  chat_doc: 'AI document question',
  // Pre-mapped: the gym's own tariff row the backend module registers in T6.
  gym_ai_chat: 'AI assistant',
}
export function tariffLabel(code) {
  return TARIFF_LABELS[code] || (code ? humanize(code).replace(/^\w/, c => c.toUpperCase()) : 'Operation')
}

// The shared platform's tariff table is global and /tariffs returns every product's rows.
// This app owns the gym_ namespace, so foreign operations are excluded here and a future
// gym operation appears automatically as soon as the platform registers it.
export function normalizeTariffs(data) {
  const env = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  const src = Array.isArray(data) ? data : Array.isArray(env.tariffs) ? env.tariffs : Array.isArray(env.operations) ? env.operations : []
  return src
    .map(r => {
      r = r && typeof r === 'object' ? r : {}
      const code = r.operation || r.code || r.op || r.slug || r.name || ''
      const cost = typeof r.cost_credits === 'number' ? r.cost_credits
        : typeof r.cost === 'number' ? r.cost
        : typeof r.credits === 'number' ? r.credits
        : typeof r.price === 'number' ? r.price : null
      return { code, label: tariffLabel(code), cost }
    })
    .filter(x => typeof x.code === 'string' && x.code.startsWith('gym_'))
}

export async function fetchTariffs(opts = {}) {
  return normalizeTariffs(await phttp(withHeartQuery('/tariffs'), opts))
}

/* ============================ order creation ============================ */

function normalizeLegalConsent(value) {
  if (!isObject(value)) return null
  return { terms: value.terms === true, privacy: value.privacy === true }
}

const newKey = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'k-' + Date.now() + '-' + Math.random()

// Boleta (document_type 46) is the default; factura 33 keeps the seam right here —
// it will pass documentType: 33 plus buyer fiscal fields in a later task.
// CLP sends the chosen amount. USD sends only the server-owned variant: the
// client never invents a price or a credits amount for a fixed-price option.
export async function createOrder(amountClp, { currency = 'CLP', variantId, documentType = 46, genKey, legalConsent, provider } = {}) {
  const key = genKey ? genKey() : newKey()
  const selectedCurrency = String(currency || 'CLP').toUpperCase()
  const body = selectedCurrency === 'USD'
    ? { currency: 'USD', variant_id: variantId, document_type: documentType }
    : { amount_clp: amountClp, currency: 'CLP', document_type: documentType }
  // A rail the person chose explicitly travels with the order: the server then
  // charges that one instead of the heart's default (the card rail, which a
  // redirect checkout can never complete).
  const namedProvider = stringOrNull(provider)?.toLowerCase()
  if (namedProvider) body.provider = namedProvider
  const consent = normalizeLegalConsent(legalConsent)
  if (consent) body.legal_consent = consent
  const opts = {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(withHeart(body)),
  }
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { order: await phttp('/payments/orders', opts), idempotencyKey: key }
    } catch (e) {
      // A status means the server ANSWERED — its decision stands, never retry an
      // answered call (that is how a rejected order becomes a double charge).
      if (e && typeof e.status === 'number') throw e
      lastErr = e   // network-level failure: same key, same body, try again
    }
  }
  throw lastErr
}

/* ============================ payment gateway ============================ */

// A recharge ALWAYS continues in this same window. The gateway replaces the app
// for the time the person pays; coming back is detected by the boot breadcrumb
// (TOPUP_RECORD_KEY + checkReturnedTopUp), which speaks once the app is open again.
// No new tab, no popup, no window.open — the owner requires one window end to end.
// Returns false when the browser gives us no location to navigate (the caller then
// tells the truth instead of staying silent).
export function goToPayment(url) {
  if (typeof window === 'undefined' || !url) return false
  const location = window.location
  if (!location) return false
  if (typeof location.assign === 'function') {
    location.assign(url)
    return true
  }
  location.href = url
  return true
}

/* ============================ card provider SDKs ============================ */

// The hosted PayPal account page is not acceptable for the USD rail: the buyer
// types the card inside this sheet. PayPal's JS SDK renders the fields and hands
// back a token; only that token reaches our API — never the card number, expiry
// or CVV (they live inside PayPal's iframes, not in our state).

const PAYPAL_SDK = {
  sandbox: 'https://www.sandbox.paypal.com/sdk/js',
  live: 'https://www.paypal.com/sdk/js',
}
const sdkLoads = new Map()

// The exact script URL, or null when there is no usable client id.
export function paypalSdkUrl(paypal) {
  const info = isObject(paypal) ? paypal : {}
  const id = stringOrNull(info.clientId)
  if (!id) return null
  const host = PAYPAL_SDK[info.environment === 'live' ? 'live' : 'sandbox']
  return host + '?client-id=' + encodeURIComponent(id) + '&components=card-fields&currency=USD'
}

// Loads the SDK lazily, once per URL, straight from PayPal (no npm dependency).
// Every failure resolves null: the wallet then says the card form is unavailable
// and keeps the same-window redirect as the honest fallback.
export function loadPaypalSdk(paypal) {
  const url = paypalSdkUrl(paypal)
  if (!url || typeof document === 'undefined') return Promise.resolve(null)
  if (typeof window !== 'undefined' && window.paypal && typeof window.paypal.CardFields === 'function') {
    return Promise.resolve(window.paypal)
  }
  if (sdkLoads.has(url)) return sdkLoads.get(url)
  const load = new Promise(resolve => {
    let settled = false
    const finish = paypal => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(paypal)
    }
    // A script that never answers must not leave the card button disabled forever:
    // after this window the wallet falls back to the same-window redirect.
    const timer = setTimeout(() => finish(null), 12000)
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => finish(
      window && window.paypal && typeof window.paypal.CardFields === 'function' ? window.paypal : null
    )
    script.onerror = () => finish(null)
    document.head.appendChild(script)
  }).then(paypal => {
    // A failed load must not poison the cache: a later attempt may work.
    if (!paypal) sdkLoads.delete(url)
    return paypal
  })
  sdkLoads.set(url, load)
  return load
}

/* ============================ Mercado Pago Brick ============================ */

// Mercado Pago only accepts a complete RUT identification. Keep the value in
// the shape the provider expects and reject an invalid check digit before a
// card form can be submitted.
export function normalizeMercadoPagoRut(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[^0-9Kk-]/g, '').toUpperCase()
}

export function isValidMercadoPagoRut(value) {
  const normalized = normalizeMercadoPagoRut(value)
  const match = /^(\d{1,10})-?([0-9K])$/.exec(normalized)
  if (!match) return false

  let sum = 0
  let factor = 2
  for (let index = match[1].length - 1; index >= 0; index -= 1) {
    sum += Number(match[1][index]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  let expected = 11 - (sum % 11)
  if (expected === 11) expected = 0
  if (expected === 10) expected = 'K'
  return String(expected) === match[2]
}

// Builds the Brick initialization without ever sending an identification that
// has no number. A missing or invalid RUT is simply omitted so the Brick can
// still mount; the wallet asks for a valid RUT before submission instead.
export function buildMercadoPagoInitialization(amount, email, rut) {
  const initialization = { amount }
  const payerEmail = stringOrNull(email)
  if (!payerEmail) return initialization

  const payer = { email: payerEmail }
  const normalizedRut = normalizeMercadoPagoRut(rut)
  if (isValidMercadoPagoRut(normalizedRut)) {
    payer.identification = { type: 'RUT', number: normalizedRut }
  }
  initialization.payer = payer
  return initialization
}

// Builds the payer sent with the card order. A valid RUT is mandatory here;
// the Brick's own RUT wins when it is valid, otherwise the wallet value is used.
export function buildMercadoPagoPayer(email, rut, brickPayer) {
  const normalizedRut = normalizeMercadoPagoRut(rut)
  if (!isValidMercadoPagoRut(normalizedRut)) return null

  const source = isObject(brickPayer) ? brickPayer : {}
  const payerEmail = stringOrNull(source.email) || stringOrNull(email)
  if (!payerEmail) return null

  const sourceIdentification = isObject(source.identification) ? source.identification : {}
  const sourceNumber = stringOrNull(sourceIdentification.number)
  const sourceType = stringOrNull(sourceIdentification.type)?.toUpperCase()
  const identification = sourceType === 'RUT' && isValidMercadoPagoRut(sourceNumber)
    ? { type: 'RUT', number: normalizeMercadoPagoRut(sourceNumber) }
    : { type: 'RUT', number: normalizedRut }

  return { email: payerEmail, identification }
}

// The official Checkout Bricks SDK v2. The public key comes from the quote;
// the script itself is the same for test and production credentials.
const MERCADOPAGO_SDK_URL = 'https://sdk.mercadopago.com/js/v2'
const MERCADOPAGO_CSP_NONCE_META = 'metalgym88-csp-nonce'
const mercadoPagoSdkLoads = new Map()

export function mercadopagoSdkUrl(mercadopago) {
  const info = isObject(mercadopago) ? mercadopago : {}
  return stringOrNull(info.publicKey) ? MERCADOPAGO_SDK_URL : null
}

// The Pages middleware publishes the per-response CSP nonce in a dedicated
// meta element. A host without that middleware simply omits the option.
export function mercadoPagoCspNonce() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null
  const meta = document.querySelector(`meta[name="${MERCADOPAGO_CSP_NONCE_META}"]`)
  const nonce = meta && typeof meta.getAttribute === 'function' ? meta.getAttribute('content') : null
  return stringOrNull(nonce)
}

function mercadoPagoBuilder(publicKey) {
  if (typeof window === 'undefined' || typeof window.MercadoPago !== 'function') return null
  try {
    // deviceProfileCspNonce is implemented by the official Mercado Pago SDK v2
    // bundle, but it is absent from the vendor's public TypeScript definitions.
    const nonce = mercadoPagoCspNonce()
    const sdk = nonce
      ? new window.MercadoPago(publicKey, { deviceProfileCspNonce: nonce })
      : new window.MercadoPago(publicKey)
    return sdk && typeof sdk.bricks === 'function' ? sdk.bricks() : null
  } catch {
    return null
  }
}

// Loads the SDK lazily and once, then returns the documented Bricks builder.
// A failed load resolves null so the wallet can keep the existing alternatives.
export function loadMercadoPagoSdk(mercadopago) {
  const info = isObject(mercadopago) ? mercadopago : {}
  const publicKey = stringOrNull(info.publicKey)
  const url = mercadopagoSdkUrl(info)
  if (!url || !publicKey || typeof document === 'undefined') return Promise.resolve(null)

  const ready = mercadoPagoBuilder(publicKey)
  if (ready) return Promise.resolve(ready)
  if (mercadoPagoSdkLoads.has(url)) return mercadoPagoSdkLoads.get(url)

  const load = new Promise(resolve => {
    let settled = false
    const finish = builder => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(builder)
    }
    const timer = setTimeout(() => finish(null), 12000)
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => finish(mercadoPagoBuilder(publicKey))
    script.onerror = () => finish(null)
    document.head.appendChild(script)
  }).then(builder => {
    // Keep only pending loads in the cache. Once the script has settled, the
    // global constructor is the source of truth and avoids a second request.
    mercadoPagoSdkLoads.delete(url)
    return builder
  })
  mercadoPagoSdkLoads.set(url, load)
  return load
}

// The SDK may hand the token as a plain string or inside a paymentSource/card
// object. Anything else (including a raw card number) is refused: no token, no API
// call. Never log the value; it is single-use and card-linked.
export function extractCardToken(data) {
  if (typeof data === 'string') return stringOrNull(data)
  if (!isObject(data)) return null
  const source = isObject(data.paymentSource) ? data.paymentSource : null
  const card = isObject(data.card) ? data.card : source && isObject(source.card) ? source.card : null
  const candidates = [
    card && card.token,
    card && card.id,
    source && source.token,
    typeof data.paymentSource === 'string' ? data.paymentSource : null,
    data.token,
    data.card_token,
    data.cardToken,
  ]
  for (const candidate of candidates) {
    const token = stringOrNull(candidate)
    if (token) return token
  }
  return null
}

// Keeps only the opaque token and the metadata documented by the Card Payment
// Brick. Card number, security code and expiry stay inside the provider iframe.
export function normalizeMercadoPagoCardData(data) {
  if (!isObject(data)) return null
  const token = extractCardToken(data)
  const issuerId = stringOrNull(data.issuer_id) || stringOrNull(data.issuerId)
  const paymentMethodId = stringOrNull(data.payment_method_id) || stringOrNull(data.paymentMethodId)
  const installments = numberOrNull(data.installments)
  const payer = isObject(data.payer) ? data.payer : null
  const email = payer ? stringOrNull(payer.email) : null
  const identification = payer && isObject(payer.identification) ? payer.identification : null
  const type = identification ? stringOrNull(identification.type)?.toUpperCase() : null
  const number = identification ? stringOrNull(identification.number) : null
  if (!token || !issuerId || !paymentMethodId || installments == null || installments < 1 || !email) return null
  return {
    token,
    issuerId,
    paymentMethodId,
    installments: Math.round(installments),
    payer: { email, identification: type && number ? { type, number } : null },
  }
}

// The API answers a captured card order with the order, its provider id, the
// final status and the credits it delivered. All optional-read, so a partial
// answer still reaches the UI honestly.
export function normalizeCardOrder(data) {
  const source = isObject(data) && isObject(data.order) ? data.order : data
  if (!isObject(source)) return null
  return {
    orderId: stringOrNull(source.order_id) || stringOrNull(source.orderId) || stringOrNull(source.id),
    providerOrderId: stringOrNull(source.provider_order_id) || stringOrNull(source.providerOrderId),
    providerPaymentId: stringOrNull(source.provider_payment_id) || stringOrNull(source.providerPaymentId),
    status: String(source.status || '').toUpperCase(),
    statusDetail: stringOrNull(source.status_detail) || stringOrNull(source.statusDetail),
    credits: numberOrNull(source.credits),
    redirectUrl: stringOrNull(source.redirect_url) || stringOrNull(source.redirectUrl),
  }
}

// Sends the opaque token and the server-owned variant. One Idempotency-Key per
// submit attempt: a network retry reuses it, so the platform replays instead of
// capturing the card twice. A status means the server answered — never retry it.
export async function createCardOrder(variantId, cardToken, {
  genKey,
  provider,
  issuerId,
  paymentMethodId,
  installments,
  payer,
  legalConsent,
} = {}) {
  const key = genKey ? genKey() : newKey()
  const body = { variant_id: variantId, card_token: cardToken }
  const selectedProvider = stringOrNull(provider)?.toLowerCase()
  if (selectedProvider === 'mercadopago') {
    body.provider = selectedProvider
    body.issuer_id = stringOrNull(issuerId)
    body.payment_method_id = stringOrNull(paymentMethodId)
    body.installments = numberOrNull(installments)
    if (isObject(payer)) {
      body.payer = { email: stringOrNull(payer.email) }
      const identification = isObject(payer.identification) ? payer.identification : null
      const type = identification ? stringOrNull(identification.type)?.toUpperCase() : null
      const number = identification ? stringOrNull(identification.number) : null
      if (type && number) body.payer.identification = { type, number }
    }
  } else if (selectedProvider) {
    body.provider = selectedProvider
  }
  const consent = normalizeLegalConsent(legalConsent)
  if (consent) body.legal_consent = consent
  const opts = {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(withHeart(body)),
  }
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const order = normalizeCardOrder(await phttp('/payments/orders/card', opts))
      return { order, idempotencyKey: key }
    } catch (e) {
      if (e && typeof e.status === 'number') throw e
      lastErr = e
    }
  }
  throw lastErr
}

/* ============================ return from the gateway ============================ */

// Small boot breadcrumb: the order we navigated away for. Assume the checkout page
// can take minutes — the TTL keeps a stale record from speaking up days later.
export const TOPUP_RECORD_KEY = 'mg_last_topup_order'
export const TOPUP_TTL_MS = 24 * 60 * 60 * 1000

export function saveTopupRecord(orderId, now = Date.now()) {
  try { localStorage.setItem(TOPUP_RECORD_KEY, JSON.stringify({ order_id: orderId, ts: now })) } catch { /* storage full/blocked — the check just never fires */ }
}

// Purges an expired record as a side effect of reading it — no separate sweep to forget.
export function readTopupRecord(now = Date.now()) {
  try {
    const raw = localStorage.getItem(TOPUP_RECORD_KEY)
    if (!raw) return null
    const rec = JSON.parse(raw)
    if (!rec || !rec.order_id || !rec.ts || now < rec.ts - 5 * 60 * 1000 || now - rec.ts > TOPUP_TTL_MS) {
      localStorage.removeItem(TOPUP_RECORD_KEY)
      return null
    }
    return rec
  } catch { return null }
}

export function clearTopupRecord() {
  try { localStorage.removeItem(TOPUP_RECORD_KEY) } catch { /* */ }
}

// The voucher's status field may sit on the root, the order, or a nested voucher.
export function orderStatus(v) {
  const s = v && typeof v === 'object'
    ? v.status || (v.order && v.order.status) || (v.voucher && v.voucher.status) || ''
    : ''
  return String(s).toUpperCase()
}

export function orderStatusDetail(v) {
  const source = v && typeof v === 'object'
    ? v.status_detail || v.statusDetail || (v.order && (v.order.status_detail || v.order.statusDetail)) || (v.voucher && (v.voucher.status_detail || v.voucher.statusDetail))
    : ''
  return stringOrNull(source)
}

// The mapping table every gateway status reads through. Unknown statuses land on
// 'pending' on purpose: "still being confirmed" is honest and never scary.
export const STATUS_KINDS = {
  APPROVED: 'approved',
  COMPLETED: 'approved',
  AUTHORIZED: 'pending',
  IN_PROCESS: 'pending',
  PENDING: 'pending',
  PENDING_PAYMENT: 'pending',
  PENDING_REVIEW: 'pending_review',
  PENDING_CHALLENGE: 'pending_review',
  IN_REVIEW: 'pending_review',
  REVIEWING: 'pending_review',
  REJECTED: 'rejected',
  FAILED: 'rejected',
  CANCELED: 'canceled',
  CANCELLED: 'canceled',
}
export function statusKind(status) {
  return STATUS_KINDS[String(status || '').toUpperCase()] || 'pending'
}

const PAYMENT_OUTCOMES = {
  APPROVED: ['Your recharge went through', 'The credits are already in your balance. Nothing else to do.'],
  AUTHORIZED: ['Your recharge is being confirmed', 'The card payment was authorized. The credits will appear once the bank confirms the payment.'],
  IN_PROCESS: ['Your recharge is being processed', 'The payment is on its way. The credits appear once it clears, usually within minutes.'],
  PENDING: ['Your recharge is registered', 'The payment is being confirmed — the credits appear in your balance as soon as it clears, usually within minutes.'],
  PENDING_CHALLENGE: ['Your bank needs one more step', "The bank is asking for an extra verification. Complete it on your bank's page; your balance changes only after the payment is approved."],
  REJECTED: ['The payment could not be completed', 'Your balance was not touched. You can start this recharge again whenever you like.'],
}

const REJECTION_MESSAGES = {
  CC_REJECTED_INSUFFICIENT_AMOUNT: "The card didn't have enough available funds for this purchase. You can try another card or continue on the payment site.",
  CC_REJECTED_BAD_FILLED_CARD_NUMBER: 'The card number looks incomplete. Check it and try again.',
  CC_REJECTED_BAD_FILLED_SECURITY_CODE: 'The security code looks incomplete. Check it and try again.',
  CC_REJECTED_BAD_FILLED_DATE: 'The expiration date looks incomplete. Check it and try again.',
  CC_REJECTED_HIGH_RISK: "This payment could not be completed for security reasons. You can try another card or continue on the payment site.",
  CC_REJECTED_DUPLICATED_PAYMENT: 'This payment was already registered. Check your balance before trying again.',
  CC_REJECTED_3DS_MANDATORY: "Your bank is asking for one more verification. Complete it on your bank's page and try again.",
  REJECTED_BY_BANK: "The bank didn't approve this payment. You can try another card or continue on the payment site.",
  CC_REJECTED_OTHER_REASON: "The bank couldn't approve this payment. You can try another card or continue on the payment site.",
}

// Converts provider states into buyer-facing copy. Raw gateway codes never
// leave this module: the component only receives translation keys and a kind.
export function paymentOutcome(status, statusDetail) {
  const state = String(status || '').toUpperCase()
  const detail = String(statusDetail || '').toUpperCase()
  const rejection = REJECTION_MESSAGES[detail]
  if (rejection || state === 'REJECTED' || state === 'FAILED') {
    return {
      kind: 'rejected',
      titleKey: PAYMENT_OUTCOMES.REJECTED[0],
      messageKey: rejection || PAYMENT_OUTCOMES.REJECTED[1],
    }
  }
  const effectiveState = detail === 'PENDING_CHALLENGE' ? 'PENDING_CHALLENGE' : state
  const copy = PAYMENT_OUTCOMES[effectiveState] || PAYMENT_OUTCOMES.PENDING
  return { kind: statusKind(effectiveState), titleKey: copy[0], messageKey: copy[1] }
}

// The gateway redirect is the first place where a cancellation is visible; the
// voucher can still be pending until the provider webhook arrives. Only the states
// in the platform contract have an opinion here, so an unknown value leaves the
// voucher in charge.
const RETURN_STATES = new Set([
  'APPROVED',
  'REJECTED',
  'CANCELED',
  'CANCELLED',
  'PENDING',
  'PENDING_REVIEW',
])

function returnParam(source, name) {
  const search = typeof source === 'string'
    ? source
    : source && typeof source.search === 'string'
      ? source.search
      : ''
  try {
    return new URLSearchParams(search).get(name)
  } catch {
    return null
  }
}

// Reads ?pago= from a query string or a location-like value. Unknown and missing
// states return null, meaning that this helper has no opinion about the outcome.
export function topUpReturnKind(source = '') {
  const state = String(returnParam(source, 'pago') || '').trim().toUpperCase()
  return RETURN_STATES.has(state) ? STATUS_KINDS[state] : null
}

function topUpReturnOrderId(source = '') {
  const orderId = String(returnParam(source, 'orden') || '').trim()
  return orderId || null
}

// Removes only the gateway return markers. The route, its fragment and unrelated
// query parameters stay exactly where the person expects them.
function clearTopUpReturnParams() {
  try {
    if (typeof window === 'undefined') return
    const location = window.location
    const history = window.history
    if (!location || !history || typeof history.replaceState !== 'function') return
    const params = new URLSearchParams(String(location.search || ''))
    if (!params.has('pago') && !params.has('orden')) return
    params.delete('pago')
    params.delete('orden')
    const query = params.toString()
    const pathname = String(location.pathname || '')
    const hash = String(location.hash || '')
    history.replaceState(history.state ?? null, '', pathname + (query ? '?' + query : '') + hash)
  } catch { /* no history (tests, exotic webviews): nothing to clean */ }
}

// Reads the breadcrumb, asks the platform how that order ended, and — only when it
// got an answer — consumes the record so the same result never speaks twice. A failed
// lookup keeps the record: it will be tried again on the next boot until the TTL ends it.
// Concurrent callers (boot check + wallet open) share ONE in-flight request: the record
// is consumed once, so the result can never be announced twice.
let returnedInflight = null
export function checkReturnedTopUp() {
  if (returnedInflight) return returnedInflight
  returnedInflight = checkReturnedTopUpOnce().finally(() => { returnedInflight = null })
  return returnedInflight
}

async function checkReturnedTopUpOnce() {
  const location = typeof window !== 'undefined' ? window.location : null
  const returnKind = topUpReturnKind(location)
  const rec = readTopupRecord()
  const orderId = (rec && rec.order_id) || topUpReturnOrderId(location)
  if (!orderId) return null
  let v
  try {
    v = await phttp(withHeartQuery('/payments/orders/' + encodeURIComponent(orderId) + '/voucher'), {})
  } catch (e) {
    return null
  }
  clearTopupRecord()
  clearTopUpReturnParams()
  const status = orderStatus(v)
  return { orderId, voucher: v, status, statusDetail: orderStatusDetail(v), kind: returnKind || statusKind(status) }
}
