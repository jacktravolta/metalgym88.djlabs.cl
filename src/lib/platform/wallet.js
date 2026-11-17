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
  return {
    detectedCountry: stringOrNull(source.detected_country)?.toUpperCase() || null,
    detectedCurrency,
    defaultCurrency: currencyCode(source.default_currency) || detectedCurrency,
    paypal: normalizePaypalInfo(source.paypal),
    currencies,
  }
}

// A missing quote endpoint is expected while the API is being deployed. Every
// failure is therefore quiet: null means "use the existing CLP-only recharge".
export async function fetchQuote() {
  try {
    return normalizeQuote(await phttp(withHeartQuery('/payments/quote'), {}))
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

const newKey = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'k-' + Date.now() + '-' + Math.random()

// Boleta (document_type 46) is the default; factura 33 keeps the seam right here —
// it will pass documentType: 33 plus buyer fiscal fields in a later task.
// CLP sends the chosen amount. USD sends only the server-owned variant: the
// client never invents a price or a credits amount for a fixed-price option.
export async function createOrder(amountClp, { currency = 'CLP', variantId, documentType = 46, genKey } = {}) {
  const key = genKey ? genKey() : newKey()
  const selectedCurrency = String(currency || 'CLP').toUpperCase()
  const body = selectedCurrency === 'USD'
    ? { currency: 'USD', variant_id: variantId, document_type: documentType }
    : { amount_clp: amountClp, currency: 'CLP', document_type: documentType }
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

/* ============================ PayPal card fields ============================ */

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

// The API answers a captured card order with the order, its provider id, the
// final status and the credits it delivered. All optional-read, so a partial
// answer still reaches the UI honestly.
export function normalizeCardOrder(data) {
  const source = isObject(data) && isObject(data.order) ? data.order : data
  if (!isObject(source)) return null
  return {
    orderId: stringOrNull(source.order_id) || stringOrNull(source.orderId) || stringOrNull(source.id),
    providerOrderId: stringOrNull(source.provider_order_id) || stringOrNull(source.providerOrderId),
    status: String(source.status || '').toUpperCase(),
    credits: numberOrNull(source.credits),
    redirectUrl: stringOrNull(source.redirect_url) || stringOrNull(source.redirectUrl),
  }
}

// Sends ONLY the variant id and the card token. One Idempotency-Key per submit
// attempt: a network retry reuses it, so the platform replays instead of capturing
// the card twice. A status means the server answered — never retry that.
export async function createCardOrder(variantId, cardToken, { genKey } = {}) {
  const key = genKey ? genKey() : newKey()
  const opts = {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(withHeart({ variant_id: variantId, card_token: cardToken })),
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

// The mapping table every gateway status reads through. Unknown statuses land on
// 'pending' on purpose: "still being confirmed" is honest and never scary.
export const STATUS_KINDS = {
  APPROVED: 'approved',
  COMPLETED: 'approved',
  PENDING: 'pending',
  PENDING_PAYMENT: 'pending',
  PENDING_REVIEW: 'pending_review',
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
  const rec = readTopupRecord()
  if (!rec) return null
  let v
  try {
    v = await phttp(withHeartQuery('/payments/orders/' + encodeURIComponent(rec.order_id) + '/voucher'), {})
  } catch (e) {
    return null
  }
  clearTopupRecord()
  const status = orderStatus(v)
  return { orderId: rec.order_id, voucher: v, status, kind: statusKind(status) }
}
