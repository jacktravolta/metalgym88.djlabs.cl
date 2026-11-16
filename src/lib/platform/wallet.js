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
  return {
    variantId,
    priceUsd: numberOrNull(raw.price_usd) ?? numberOrNull(raw.priceUsd) ?? numberOrNull(raw.price),
    credits: numberOrNull(raw.credits),
    amountClp: numberOrNull(raw.amount_clp) ?? numberOrNull(raw.amountClp),
    label: stringOrNull(raw.label),
  }
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

// A recharge must never take the person out of the app: the gateway opens in a NEW
// tab and this app stays exactly where it is, watching the order.
//
// Two browser rules shape the code:
//   · a window opened after an await loses the user-gesture context, and pop-up
//     blockers then refuse it — so the tab is opened FIRST (openPaymentTab, called
//     from the click handler) and pointed at the gateway once the URL is known;
//   · 'noopener' as a window feature makes window.open return null, so the opener
//     is cut by hand instead.
//
// If the browser refuses the window, the payment continues in the same tab — the old
// behaviour — and the breadcrumb still tells us what happened when they come back.
export function openPaymentTab() {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null
  let w = null
  try { w = window.open('', '_blank') } catch { w = null }
  if (!w) return null
  try { w.opener = null } catch { /* a browser that refuses the write is still fine */ }
  return w
}

// Sends the payment tab to the gateway. `tab` is the window openPaymentTab() already
// opened (optional — when it is missing, one is opened here). Returns 'tab' when the
// gateway got its own tab and 'same-tab' when this app had to navigate instead.
export function goToPayment(url, tab) {
  if (typeof window === 'undefined' || !url) return 'same-tab'
  let w = tab || null
  if (!w) {
    try { w = window.open('', '_blank') } catch { w = null }
    if (w) { try { w.opener = null } catch { /* ignore */ } }
  }
  if (w) {
    try {
      w.location.href = url
      return 'tab'
    } catch {
      try { w.close() } catch { /* the window cannot be closed either — nothing to do */ }
    }
  }
  window.location.href = url
  return 'same-tab'
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

// Asks the platform how ONE order ended, WITHOUT touching the breadcrumb: the wallet
// keeps asking while the person pays, so the record stays available for the boot check
// if they never come back to that sheet. A failed lookup is not an answer — it returns
// null so the caller keeps waiting quietly instead of announcing a wrong result.
export async function checkTopupOrder(orderId) {
  if (!orderId) return null
  let v
  try {
    v = await phttp(withHeartQuery('/payments/orders/' + encodeURIComponent(orderId) + '/voucher'), {})
  } catch (e) {
    return null
  }
  const status = orderStatus(v)
  return { orderId, voucher: v, status, kind: statusKind(status) }
}
