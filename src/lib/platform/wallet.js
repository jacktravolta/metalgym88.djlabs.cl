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

// Renders whatever the platform returns; the gym adds its own rows server-side.
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
    .filter(x => x.code)
}

export async function fetchTariffs() {
  return normalizeTariffs(await phttp(withHeartQuery('/tariffs'), {}))
}

/* ============================ order creation ============================ */

const newKey = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'k-' + Date.now() + '-' + Math.random()

// Boleta (document_type 46) is the default; factura 33 keeps the seam right here —
// it will pass documentType: 33 plus buyer fiscal fields in a later task.
export async function createOrder(amountClp, { documentType = 46, genKey } = {}) {
  const key = genKey ? genKey() : newKey()
  const opts = {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(withHeart({ amount_clp: amountClp, document_type: documentType })),
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

// Full-page navigation to the gateway. The calling code persists the order record
// BEFORE navigating, so coming back can be detected even if the browser discards
// the page state.
export function goToPayment(url) {
  if (typeof window !== 'undefined' && url) window.location.href = url
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
export async function checkReturnedTopUp() {
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
