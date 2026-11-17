// S8 — the credit burn: what a welcome account really costs to serve.
//
// This is the only scenario that SPENDS. It registers a brand-new account
// through the visible UI, opens the coach, holds a human, training-related
// conversation in Spanish and measures every answer: wall-clock latency,
// characters sent, tokens in/out (when the platform reports them), credits
// debited from the balance, and the derived cost per message and per credit
// against the platform's own price list.
//
// Because it spends REAL AI tokens and the account's welcome credits on the
// deployed platform, it is opt-in twice over:
//   · it runs only with E2E_ALLOW_SPEND=1, and
//   · it stops on a balance of zero, a 402, a message cap and a wall-clock cap.
// Without the opt-in it returns a BLOCKED "skipped" verdict with the reason —
// it never spends silently and it never invents a measurement.
//
// The report lands next to the suite's other evidence (artifacts/e2e/):
// s8-credit-burn.md (for humans) and s8-credit-burn.json (machine-readable).
// Nothing here is hardcoded about prices: the credits come from the balance
// deltas, the published tariff from GET /tariffs, the recharge bounds from
// GET /payments/limits and the CLP-per-credit conversion from the quote, all
// observed in the wallet the front itself opens.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { blocked, fail } from '../runner.js'
import { StepTimeout } from '../page.js'
import { API_HOST, BASE_URL, HEART, TEXT } from '../config.js'
import { Mailbox, extractTokenUrls } from '../lib/mailbox.js'
import { openApp, platformResponse, redeemLatestLink } from './helpers.js'
import { redactValue } from '../redact.js'

// The visible strings this scenario needs. They are S8-only, so they live here
// instead of growing the shared config for a single journey. They are the
// product's own Spanish locale strings (src/locales/es.js).
const WALLET_OPEN = 'Ver mi billetera'
const ASSISTANT_OPEN = 'Abrir el asistente'
const COACH_SHEET = '.sheet-coach'
const WALLET_SHEET = '.sheet'
const COMPOSER = 'Pregunta sobre tu entrenamiento, plan o progreso…'
const SEND = 'Enviar'
const THINKING = 'Pensando…'
const INSUFFICIENT = 'Tu saldo necesita una recarga para esto'
const COACH_COST_LINE = 'créditos por pregunta'
const WALLET_MOVEMENTS = 'Movimientos'

// The platform pauses a wallet that crosses the welcome-bonus threshold
// (heart_settings.reverify_bonus_threshold): the account must confirm its
// email again before it can spend more. This is the notice it mails.
const REVERIFY_SUBJECT = /Confirma tu correo/i

const SPEND_FLAG = 'E2E_ALLOW_SPEND'
const DEFAULT_MAX_MESSAGES = 40
const DEFAULT_MAX_SECONDS = 900
const DEFAULT_ANSWER_TIMEOUT_MS = 120000
const RENDER_TIMEOUT_MS = 30000

// The conversation. Real questions about gym training — routines, progression,
// technique, recovery, nutrition around training — with varying length and
// phrasing, so the model is not answering the same prompt with a template.
// The first one carries the person's name (the app would otherwise prepend
// "My name is …"), which is also what a person would type.
const CORPUS = [
  'Hola. Quiero empezar a entrenar en el gimnasio y no sé por dónde partir. ¿Me ayudas a ordenar las primeras semanas?',
  'Tengo 34 años y llevo dos años sin entrenar. ¿Cómo debería repartir los días entre fuerza y cardio?',
  '¿Cuántas series y repeticiones conviene hacer para hipertrofia si recién empiezo?',
  '¿Es mejor entrenar tres días seguidos y descansar cuatro, o alternar un día sí y uno no?',
  'Estoy haciendo sentadilla con barra y siento que se me va la espalda hacia adelante al subir. ¿Qué podría corregir?',
  '¿Cómo sé si el peso que estoy usando en press banca es el adecuado para trabajar bien sin llegar al fallo?',
  '¿Cuánto debería descansar entre series de un ejercicio grande como peso muerto y cuánto en uno pequeño como curl de bíceps?',
  '¿Qué significa subir la carga de forma progresiva sin arriesgar la técnica?',
  'Llevo tres semanas estancado con el mismo peso en press militar. ¿Qué ajustes puedo probar?',
  '¿Conviene entrenar al fallo en todos los ejercicios o solo en el último set?',
  'Entreno por la noche después del trabajo. ¿Hay algún problema con eso o rindo igual que en la mañana?',
  '¿Cómo caliento antes de una sesión de piernas para no llegar frío a la sentadilla?',
  'Me duelen los codos cuando hago fondos en paralelas. ¿Puedo cambiar la técnica o mejor busco otro ejercicio?',
  '¿Cuánta proteína necesito al día si peso 72 kilos y entreno cuatro veces por semana?',
  '¿Da lo mismo tomar un batido de proteína antes o después de entrenar?',
  '¿Qué puedo comer una hora antes de entrenar si no quiero sentirme pesado?',
  '¿Es cierto que hay que comer justo después de entrenar para aprovechar la ventana anabólica?',
  'Quiero bajar grasa sin perder fuerza. ¿Cómo ajusto las calorías sin quedarme sin energía en el gimnasio?',
  '¿El cardio en ayunas ayuda a quemar más grasa o es un mito?',
  '¿Cómo organizo una rutina de cuatro días para trabajar empuje, tracción y piernas sin repetir demasiado?',
  'Tengo poco tiempo: ¿me sirve una sesión de cuarenta minutos con cuatro ejercicios?',
  '¿Qué diferencia hay entre una rutina full body y una dividida por grupos musculares?',
  'Estoy saliendo de una gripe y todavía tengo tos. ¿Vuelvo con la misma carga o empiezo más suave?',
  '¿Cómo sé que necesito una semana de descarga y cómo la estructuro?',
  'Duermo alrededor de seis horas de lunes a viernes. ¿Cómo afecta eso a la recuperación muscular?',
  '¿Sirve estirar después de entrenar para reducir las agujetas?',
  'Me levanté con el hombro cargado después de una sesión de press. ¿Entreno igual o descanso?',
  '¿Qué ejercicios puedo hacer en casa si esta semana no alcanzo a ir al gimnasio?',
  '¿Cómo progreso en dominadas si todavía no logro hacer una completa?',
  '¿Cuál es una buena forma de aprender el peso muerto desde cero con seguridad?',
  'En remo con mancuerna noto que tiro con el brazo y no con la espalda. ¿Cómo cambio eso?',
  '¿Cuántos pasos diarios conviene sumar si quiero complementar el entrenamiento de fuerza?',
  '¿El entrenamiento de abdominales todos los días es demasiado o puedo hacerlo?',
  '¿Cómo adapto la rutina si solo tengo mancuernas y una banda elástica?',
  'Quiero correr una vez por semana además de la fuerza. ¿Qué día conviene y cómo evito llegar cansado?',
  '¿Qué hago si una semana solo puedo entrenar dos días? ¿Priorizo fuerza o cardio?',
  '¿Cómo registro mis series para saber si estoy progresando?',
  '¿Es normal que la fuerza suba rápido al principio y después se frene?',
  '¿Cuánto peso debería agregar en sentadilla cuando completo todas las repeticiones?',
  '¿Cómo afecta el alcohol del fin de semana al entrenamiento del lunes?',
  '¿Qué señales me indican que estoy sobreentrenando?',
  '¿Cómo puedo mejorar el agarre para peso muerto y dominadas?',
  'Estoy pensando en tomar creatina. ¿Qué debería saber antes y cómo se relaciona con la retención de líquido?',
  '¿Cómo cierro una sesión si me queda poco tiempo y no alcancé a hacer los últimos ejercicios?',
  '¿Puedo entrenar fuerza y salir a trotar el mismo día sin que uno arruine al otro?',
  '¿Qué hago con el calentamiento cuando el gimnasio está lleno y no tengo máquinas libres?',
]

/* ============================ small pure helpers ============================ */

const normalise = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim()

function positiveInt(name, fallback) {
  const raw = process.env[name]
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function numberFrom(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

// The platform wraps almost every answer in { success, data }. The assistant
// route also tolerates the flat shape; accept both.
function payload(body) {
  if (!body || typeof body !== 'object') return {}
  if (body.success === true && body.data && typeof body.data === 'object') return body.data
  if (typeof body.answer === 'string' || typeof body.reply === 'string') return body
  if (body.data && typeof body.data === 'object') return body.data
  return body
}

function readError(body) {
  const data = payload(body)
  const outer = body && typeof body === 'object' ? body : {}
  const inner = data.error && typeof data.error === 'object' ? data.error
    : outer.error && typeof outer.error === 'object' ? outer.error : null
  return {
    code: (inner && inner.code) || data.code || outer.code || null,
    message: (inner && inner.message) || (typeof data.error === 'string' ? data.error : null)
      || data.message || outer.message || null,
  }
}

// The token figure is reported under whichever name the platform chose this
// week. Read the documented one first, then the common aliases; if nothing is
// there, the report says "not reported" instead of inventing a number.
function readTokens(body) {
  const data = payload(body)
  const usage = data.usage && typeof data.usage === 'object' ? data.usage : {}
  const merged = { ...data, ...usage }
  const pick = keys => {
    for (const key of keys) {
      if (typeof merged[key] === 'number' && Number.isFinite(merged[key])) return { value: merged[key], key }
    }
    return null
  }
  const input = pick(['prompt_tokens', 'input_tokens', 'tokens_in', 'tokensIn'])
  const output = pick(['completion_tokens', 'output_tokens', 'tokens_out', 'tokensOut'])
  const total = pick(['usage_tokens', 'total_tokens', 'tokens_total', 'totalTokens'])
  const inValue = input ? input.value : null
  const outValue = output ? output.value : null
  let totalValue = total ? total.value : null
  let derivedTotal = false
  if (totalValue == null && inValue != null && outValue != null) {
    totalValue = inValue + outValue
    derivedTotal = true
  }
  const keys = [input && input.key, output && output.key, total && total.key].filter(Boolean)
  return {
    in: inValue,
    out: outValue,
    total: totalValue,
    reported: keys.length > 0,
    source: keys.length ? keys.join(' / ') : 'not reported',
    derivedTotal,
  }
}

function readAssistant(body) {
  const data = payload(body)
  const answer = typeof data.answer === 'string' && data.answer.trim() ? data.answer
    : typeof data.reply === 'string' && data.reply.trim() ? data.reply : ''
  return {
    answer,
    conversationId: data.conversation_id || data.conversationId || null,
    operationId: data.operation_id || data.operationId || null,
    balance: numberFrom(data.balance),
    tokens: readTokens(body),
  }
}

function readBalance(body) {
  const data = payload(body)
  const user = data.user && typeof data.user === 'object' ? data.user : {}
  return numberFrom(data.balance, user.balance)
}

function readLimits(body) {
  const data = payload(body)
  const source = data.limits && typeof data.limits === 'object' ? data.limits : data
  return {
    min: numberFrom(source.min_clp, source.min),
    max: numberFrom(source.max_clp, source.max),
    provider: source.provider || null,
    unitPrice: readUnitPrice(source),
  }
}

// Some platforms publish the CLP price of one credit next to the recharge
// bounds. Read it when it is there, and name the exact field it came from.
function readUnitPrice(source) {
  for (const key of ['clp_per_credit', 'price_per_credit', 'credit_clp', 'unit_price_clp', 'credit_price_clp']) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key])) return { value: source[key], key }
  }
  return null
}

function readTariffs(body) {
  const data = payload(body)
  const rows = Array.isArray(data) ? data
    : Array.isArray(data.tariffs) ? data.tariffs
      : Array.isArray(data.operations) ? data.operations : []
  return rows.map(row => {
    const code = row.operation || row.code || row.op || row.slug || row.name || ''
    const cost = numberFrom(row.cost_credits, row.cost, row.credits, row.price)
    const clp = numberFrom(row.price_clp, row.clp, row.amount_clp, row.cost_clp)
    return {
      code,
      cost,
      clp: clp == null ? null : { value: clp, key: 'the tariff row' },
    }
  }).filter(row => typeof row.code === 'string' && row.code.startsWith('gym_'))
}

// A quote only tells us the CLP price of a credit when it pairs an amount with
// a credit count. A bare preset amount is not a conversion, so it is not used.
function readQuote(body) {
  const data = payload(body)
  const rows = Array.isArray(data.currencies) ? data.currencies
    : Array.isArray(data.options) ? data.options : []
  const offers = []
  for (const row of rows) {
    const currency = String(row.currency || row.currency_code || row.code || '').toUpperCase()
    if (currency !== 'CLP') continue
    const variants = Array.isArray(row.variants) ? row.variants
      : Array.isArray(row.prices) ? row.prices : []
    for (const variant of variants) {
      const amountClp = numberFrom(variant.amount_clp, variant.amountClp)
      const credits = numberFrom(variant.credits)
      if (amountClp == null || amountClp <= 0 || credits == null || credits <= 0) continue
      offers.push({
        currency,
        label: variant.label || variant.variant_id || variant.variantId || variant.id || null,
        amountClp,
        credits,
        clpPerCredit: amountClp / credits,
      })
    }
  }
  const values = offers.map(o => o.clpPerCredit)
  const consistent = values.length > 0 && values.every(v => Math.abs(v - values[0]) < 1e-9)
  return {
    offers,
    clpPerCredit: offers.length ? offers[0].clpPerCredit : null,
    clpPerCreditSource: offers.length
      ? `the first CLP offer that pairs an amount with a credit count (${offers[0].amountClp} CLP = ${offers[0].credits} credits)`
      : null,
    consistent,
    currenciesSeen: rows.map(row => String(row.currency || row.currency_code || row.code || '').toUpperCase()).filter(Boolean),
  }
}

function readMovements(body) {
  const data = payload(body)
  const rows = Array.isArray(data) ? data
    : Array.isArray(data.movements) ? data.movements
      : Array.isArray(data.items) ? data.items : []
  const hasMore = data && (data.has_more === true || data.hasMore === true)
  const items = rows.map(row => ({
    type: row.type || row.operation || row.kind || '',
    amount: numberFrom(row.amount, row.credits),
    date: row.created_at || row.date || row.ts || null,
  }))
  const debits = items.filter(item => item.type === 'USAGE_DEBIT')
  return {
    items,
    hasMore: hasMore === true,
    usageDebits: debits.length,
    creditsDebited: debits.reduce((sum, item) => sum + Math.abs(item.amount == null ? 0 : item.amount), 0),
  }
}

function readWelcomeBonus(body) {
  const data = payload(body)
  const raw = data.welcome_bonus || (data.data && data.data.welcome_bonus)
    || (body && body.welcome_bonus) || null
  if (!raw || typeof raw !== 'object') return null
  const creditsAdded = numberFrom(raw.credits_added)
  if (creditsAdded == null || creditsAdded < 0) return null
  return { creditsAdded, alreadyAwarded: raw.already_awarded === true }
}

/* ============================ the fresh inbox ============================ */

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

// A plus-addressed local part, derived from the environment, on the domain the
// harness's mailbox helper can actually read. `E2E_BURN_EMAIL` supplies the
// recognisable local part; the tag and the helper's random suffix make every
// run a different address (and therefore a brand-new account with its welcome
// credits). If the provider refuses the plus form, a plain fresh address is
// used and the report says so — the account is still brand new.
async function createFreshInbox({ log, shared = null, reuseShared = false }) {
  const raw = String(process.env.E2E_BURN_EMAIL || '').trim()
  const base = (raw.includes('@') ? raw.split('@')[0] : raw).replace(/[^a-zA-Z0-9._-]/g, '') || 'mg88e2e'
  const plusPrefix = `${base}+s8${stamp()}`
  const failures = []
  try {
    const mailbox = await Mailbox.create({ prefix: plusPrefix })
    log(`fresh plus-addressed inbox: ${mailbox.address}`)
    return { mailbox, address: mailbox.address, plusAddressed: true, note: null }
  } catch (e) {
    const firstError = e && e.message ? e.message : String(e)
    failures.push(`plus-addressed attempt — ${firstError}`)
    log(`the plus-addressed inbox was refused (${firstError})`)
  }

  // mail.tm allows about one new account per short window, and the harness has
  // already created its own inbox for this run. Reusing that one is safe only
  // when no other scenario registered it, i.e. when S8 is the only one selected.
  if (reuseShared && shared) {
    log(`reusing the harness's fresh inbox instead: ${shared.address}`)
    return {
      mailbox: shared,
      address: shared.address,
      plusAddressed: false,
      note:
        `the mailbox provider refused a new account (${failures[0]}); the harness's own inbox for this run was ` +
        `reused instead. It is a brand-new address (S8 was the only scenario selected), but not plus-addressed`,
    }
  }

  log('trying a plain fresh address')
  try {
    const mailbox = await Mailbox.create({ prefix: base })
    return {
      mailbox,
      address: mailbox.address,
      plusAddressed: false,
      note: `the mailbox provider refused the plus-addressed form (${failures[0]}); a fresh plain address was used instead`,
    }
  } catch (e) {
    const secondError = e && e.message ? e.message : String(e)
    failures.push(`plain attempt — ${secondError}`)
  }

  throw blocked(
    `the mailbox could not create a fresh inbox for this run (${failures.join('; ')}), so the real magic link ` +
    `cannot be read. Nothing was registered and nothing was spent`,
    { failures }
  )
}

/* ============================ reading the wallet ============================ */

// Opens the wallet the way a person does and waits for the calls it makes on
// its own. Returns the fresh requests, not a verdict: every caller reads what
// Is this the platform's welcome-bonus pause (the account has to confirm its
// email again) and not any other 403?
function isReverifyPause(error) {
  if (!error) return false
  const code = String(error.code || '').toUpperCase()
  const message = String(error.message || '')
  return code.includes('EMAIL_REVERIFY_REQUIRED')
    || message.includes('EMAIL_REVERIFY_REQUIRED')
    || /confirmar tu correo/i.test(message)
}

// The platform pauses a wallet that crosses the welcome-bonus threshold and
// mails a verification notice. A person opens that link; this does the same
// thing with the same token: the notice is read from the run's own inbox and
// redeemed through the platform's public contract (POST /auth/reverify).
async function completeReverification(page, context) {
  const mailbox = context.mailbox
  if (!mailbox) {
    return { ok: false, detail: 'this run has no inbox to read the re-verification notice from' }
  }
  let mail
  try {
    mail = await mailbox.latestWithSubject(REVERIFY_SUBJECT, {
      timeoutMs: 120000,
      since: context.sentAt || null,
    })
  } catch (e) {
    return { ok: false, detail: `no re-verification email arrived: ${e && e.message ? e.message : String(e)}` }
  }
  const urls = extractTokenUrls(mail.body)
  if (!urls.length) {
    return { ok: false, detail: 'the re-verification email carried no verification URL' }
  }
  const link = urls.find(url => /kind=reverify/.test(url)) || urls[0]
  const token = new URL(link).searchParams.get('token')
  if (!token) return { ok: false, detail: 'the re-verification URL carried no token' }
  const endpoint = `https://${API_HOST}/auth/reverify`
  const answer = await page.evaluate(
    `const response = await fetch(__args.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: __args.token }),
    })
    const body = await response.json().catch(() => null)
    return { status: response.status, body }`,
    { timeoutMs: 30000, args: { endpoint, token } }
  )
  const confirmed = Boolean(answer && answer.status === 200 && answer.body && answer.body.success === true)
  let linkHost = null
  try { linkHost = new URL(link).host } catch { /* the link was odd; the host stays unknown */ }
  return {
    ok: confirmed,
    detail: confirmed
      ? 'the account confirmed its email again through the mailed notice'
      : `POST /auth/reverify answered ${answer ? answer.status : 'no answer'}`,
    subject: mail.message && mail.message.subject ? mail.message.subject : null,
    linkHost,
    endpoint: '/auth/reverify',
    status: answer ? answer.status : null,
  }
}

// it needs and reports the missing pieces as "not reported".
async function openWalletAndCollect(page, log) {
  await openApp(page, '/home')
  await page.expectText(WALLET_OPEN, 20000)

  // The mark is taken BEFORE the click: the wallet fires its calls on mount, and
  // a slice taken afterwards would miss the fast ones (/auth/me, /tariffs).
  const since = page.requests.length
  await page.clickText(WALLET_OPEN, { timeoutMs: 25000 })
  // The panel is mounted when its own "Movimientos" heading is on screen; the
  // entry card's "Billetera" wording is already present on /home and would pass
  // before the sheet exists.
  const deadlinePanel = Date.now() + 25000
  let panelSeen = false
  while (Date.now() < deadlinePanel) {
    const heading = await page.textContaining(WALLET_MOVEMENTS, { scope: WALLET_SHEET }).catch(() => null)
    if (heading) { panelSeen = true; break }
    await delay(150)
  }
  if (!panelSeen) {
    log('the wallet sheet never showed its "Movimientos" heading; the price list is read from whatever calls it did make')
  }

  const wanted = ['/auth/me', '/payments/limits', '/tariffs', '/payments/quote', '/credits/movements']
  const deadline = Date.now() + 30000
  let fresh = []
  // A call is settled when it carries a status or a network error; an endpoint
  // the deployment does not serve fails at the network level, and waiting for a
  // status that will never arrive would only burn the whole window.
  const settled = r => r.status != null || r.errorText != null
  while (Date.now() < deadline) {
    fresh = page.requests.slice(since)
    const pending = wanted.filter(path => !fresh.some(r => r.path === path && settled(r)))
    if (!pending.length) break
    await delay(120)
  }
  fresh = page.requests.slice(since)
  const read = async path => {
    const candidates = fresh.filter(r => r.path === path && settled(r))
    // A CORS preflight answers 204 with no body: the answer that carries the
    // numbers is the real request that follows it.
    const withBody = candidates.filter(r => r.status === 200)
    const request = (withBody.length ? withBody : candidates).pop() || null
    if (!request) return { status: null, body: null, request: null }
    return { status: request.status, body: await page.responseJson(request.id), request }
  }
  const snapshot = {
    me: await read('/auth/me'),
    limits: await read('/payments/limits'),
    tariffs: await read('/tariffs'),
    quote: await read('/payments/quote'),
    movements: await read('/credits/movements'),
  }
  log(`wallet opened: ${wanted.map(path => `${path} ${snapshotFor(snapshot, path).status == null ? 'no answer' : snapshotFor(snapshot, path).status}`).join(' · ')}`)
  return snapshot
}

function snapshotFor(snapshot, path) {
  if (path === '/auth/me') return snapshot.me
  if (path === '/payments/limits') return snapshot.limits
  if (path === '/tariffs') return snapshot.tariffs
  if (path === '/payments/quote') return snapshot.quote
  if (path === '/credits/movements') return snapshot.movements
  return { status: null, body: null, request: null }
}

function summariseWallet(snapshot) {
  const limits = readLimits(snapshot.limits.body)
  if (limits.min == null || limits.max == null) {
    limits.bodyReadable = snapshot.limits.body != null
    limits.status = snapshot.limits.status
  } else {
    limits.bodyReadable = true
    limits.status = snapshot.limits.status
  }
  const tariffs = readTariffs(snapshot.tariffs.body)
  const quote = readQuote(snapshot.quote.body)
  return {
    me: {
      status: snapshot.me.status,
      balance: readBalance(snapshot.me.body),
      bodyReadable: snapshot.me.body != null,
    },
    limits: { ...limits, status: snapshot.limits.status, bodyReadable: snapshot.limits.body != null },
    tariffs: {
      status: snapshot.tariffs.status,
      bodyReadable: snapshot.tariffs.body != null,
      rows: tariffs,
    },
    quote: {
      status: snapshot.quote.status,
      bodyReadable: snapshot.quote.body != null,
      ...quote,
    },
    movements: {
      status: snapshot.movements.status,
      bodyReadable: snapshot.movements.body != null,
      ...readMovements(snapshot.movements.body),
    },
  }
}

// The wallet's own visible line, used only when the body cannot be read. Mirrors
// S5's fallback: the UI publishes the same numbers.
async function limitsFromUi(page) {
  const line = await page.textContaining(TEXT.limitsLine, { scope: WALLET_SHEET }).catch(() => null)
  const numbers = line ? (line.match(/[\d.]+/g) || []) : []
  const values = numbers.map(n => Number(String(n).replace(/\./g, ''))).filter(n => !Number.isNaN(n))
  if (values.length < 2) return null
  return { min: values[0], max: values[1], source: 'the wallet UI (the answer body was not readable)' }
}

/* ============================ the conversation ============================ */

async function readChip(page) {
  const label = await page.ariaLabelWithText(TEXT.balance).catch(() => null)
  if (!label) return { label: null, value: null }
  const digits = label.replace(/[^\d]/g, '')
  return { label, value: digits ? Number(digits) : null }
}

// Waits until the answer is on screen, not merely on the wire. The front writes
// a long answer out progressively, so the measurement is: the typing bubble is
// gone, the answer's opening is in the transcript, and the transcript stopped
// changing. Returns whether the render was actually observed.
async function waitForAnswerRendered(page, answer) {
  const needle = normalise(answer).slice(0, 60)
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  let last = null
  let stable = 0
  while (Date.now() < deadline) {
    const state = await page.evaluate(`
      const el = document.querySelector(__args.selector);
      if (!el) return null;
      const text = __norm(el.innerText);
      return { text, typing: text.includes(__args.typing) };
    `, { args: { selector: COACH_SHEET, typing: THINKING } }).catch(() => null)
    if (state) {
      if (state.typing) {
        last = null
        stable = 0
      } else if (!needle || state.text.includes(needle)) {
        if (state.text === last) {
          stable++
          if (stable >= 2) return true
        } else {
          last = state.text
          stable = 0
        }
      }
    }
    await delay(120)
  }
  return false
}

async function openCoach(page, log) {
  await openApp(page, '/home')
  await page.clickText(ASSISTANT_OPEN, { timeoutMs: 25000 })
  const heading = await page.waitForText('Coach con IA', 20000)
  if (!heading) {
    throw new StepTimeout('the coach panel never rendered its heading', {
      pageText: await page.bodyText(4000).catch(() => ''),
    })
  }
  const tariffLine = await page.textContaining(COACH_COST_LINE, { scope: COACH_SHEET }).catch(() => null)
  const panelCost = tariffLine ? Number((tariffLine.match(/(\d+)/) || [])[1]) : null
  log(`coach open${panelCost != null ? ` (the panel publishes ${panelCost} credit(s) per question)` : ' (the panel published no per-question cost)'}`)
  return { tariffLine, panelCost }
}

// One question through the real composer, one answer waited for. Returns the
// payment/answer evidence; it never retries, because a retry would spend twice.
async function askOnce(page, question, answerTimeoutMs) {
  await page.fill(COMPOSER, question, { scope: COACH_SHEET, timeoutMs: 20000 })
  const before = new Set(page.requests.map(r => r.id))
  const submittedAt = Date.now()
  await page.clickText(SEND, { exact: true, scope: COACH_SHEET, timeoutMs: 20000 })
  const request = await page.waitForRequest(
    r => !before.has(r.id) && r.method === 'POST' && r.path === '/opengym/ai',
    30000
  )
  const response = await platformResponse(page, request, {
    timeoutMs: answerTimeoutMs,
    label: 'POST /opengym/ai',
  })
  let sentQuestion = question
  try {
    const body = JSON.parse(request.postData || '{}')
    if (typeof body.question === 'string') sentQuestion = body.question
  } catch { /* the typed question is the fallback */ }
  return { request, response, submittedAt, sentQuestion }
}

/* ============================ the report ============================ */

// The same shape the scenario builds at the end, but honest about what a run cut
// short by an exception never got to compute: nothing is invented, every field
// stays null and the table above still carries the messages that were measured.
function partialTotals(messages) {
  const answered = messages.filter(message => message.outcome === 'answered')
  return {
    elapsedMs: null,
    attempts: messages.length,
    answered: answered.length,
    charsSent: answered.length ? answered.reduce((sum, message) => sum + (message.charsSent || 0), 0) : null,
    tokens: { in: null, out: null, total: null, reported: false, messagesWithTokens: 0, source: 'not reported' },
    credits: { observed: null, fromBalances: null, messagesWithDebit: 0, before: null, after: null },
    latency: { meanRenderedMs: null, samples: 0 },
    perMessage: { credits: null, creditsSource: 'not reported', chars: null, latencyMs: null, tokensTotal: null },
    cost: {
      clpPerCredit: null,
      publishedCreditsPerQuestion: null,
      publishedClpPerQuestion: null,
      publishedClpPerQuestionSource: null,
      observedClpPerMessage: null,
    },
  }
}

function entryLines(report) {
  const lines = []
  lines.push('# Credit burn report — metalgym88')
  lines.push('')
  lines.push(`- Generated: ${report.generatedAt}`)
  lines.push(`- Host: ${report.environment.host}`)
  lines.push(`- Heart: \`${report.environment.heart}\``)
  lines.push(`- Platform API host: ${report.environment.apiHost}`)
  lines.push(`- Chrome: ${report.environment.chrome || 'unknown'}`)
  lines.push(`- Account under test: \`${report.account.address || 'not created'}\``)
  lines.push(`- Spend opt-in: \`E2E_ALLOW_SPEND=${report.optIn.value}\``)
  lines.push(`- Guardrails: ${report.guardrails.maxMessages} messages · ${report.guardrails.maxSeconds}s wall clock · ${report.guardrails.answerTimeoutMs}ms per answer`)
  lines.push('')
  if (report.stop) {
    lines.push(`**Stopped:** ${report.stop.reason} — ${report.stop.detail || 'no detail'}`)
    lines.push('')
  }
  lines.push('## Per message')
  lines.push('')
  lines.push('| # | Chars sent | Latency | Tokens in | Tokens out | Credits debited | Balance after | Outcome |')
  lines.push('|---|-----------:|--------:|----------:|-----------:|----------------:|--------------:|---------|')
  for (const message of report.messages) {
    lines.push(`| ${message.index} | ${message.charsSent == null ? 'not reported' : message.charsSent} | ${formatMs(message.latencyMs)} | ${formatNumber(message.tokens && message.tokens.in)} | ${formatNumber(message.tokens && message.tokens.out)} | ${formatNumber(message.creditsDebited)} | ${formatNumber(message.balanceAfter)} | ${message.outcome}${message.httpStatus && message.httpStatus !== 200 ? ` (HTTP ${message.httpStatus})` : ''} |`)
  }
  lines.push('')
  if (report.reverifications && report.reverifications.length) {
    lines.push('## Re-verifications (the welcome-bonus pause)')
    lines.push('')
    for (const event of report.reverifications) {
      lines.push(`- After message ${event.afterMessage}: ${event.detail}${event.linkHost ? ` (the notice pointed at ${event.linkHost})` : ''}`)
    }
    lines.push('')
  }
  const totals = report.totals || partialTotals(report.messages || [])
  lines.push('## Totals')
  lines.push('')
  lines.push(`- Elapsed: ${formatDuration(totals.elapsedMs)}`)
  lines.push(`- Attempts: ${totals.attempts} · answered: ${totals.answered} · refused/stopped: ${totals.attempts - totals.answered}`)
  lines.push(`- Characters sent: ${totals.charsSent == null ? 'not reported' : totals.charsSent}`)
  lines.push(`- Tokens: ${totals.tokens.reported ? `${formatNumber(totals.tokens.in)} in / ${formatNumber(totals.tokens.out)} out (${formatNumber(totals.tokens.total)} total) over ${totals.tokens.messagesWithTokens} of ${totals.answered} answers` : 'not reported by the platform'}`)
  lines.push(`- Credits consumed: ${creditsLine(totals)}`)
  lines.push(`- Average per answered message: ${formatNumber(totals.perMessage.credits, 2)} credits · ${formatNumber(totals.perMessage.chars, 1)} characters · ${formatMs(totals.perMessage.latencyMs)}`)
  lines.push('')
  lines.push('## Published price list (observed, not hardcoded)')
  lines.push('')
  lines.push(`- Welcome bonus (the magic-link answer): ${report.account.welcomeBonus ? `${report.account.welcomeBonus.creditsAdded} credit(s)${report.account.welcomeBonus.alreadyAwarded ? ', already awarded' : ''}` : 'not reported'}`)
  lines.push(`- Initial balance: ${formatNumber(report.account.initialBalance)} (${report.account.initialBalanceSource})`)
  lines.push(`- Recharge bounds (GET /payments/limits): ${report.priceList.limits.min == null && report.priceList.limits.max == null ? 'not reported' : `${formatNumber(report.priceList.limits.min)}–${formatNumber(report.priceList.limits.max)} CLP`} (${report.priceList.limits.source})`)
  lines.push(`- Tariff (GET /tariffs): ${report.priceList.tariff ? `${report.priceList.tariff.code} = ${formatNumber(report.priceList.tariff.cost)} credit(s) per question` : 'not served'} (${report.priceList.tariffSource})`)
  lines.push(`- CLP per credit (the quote): ${report.priceList.clpPerCredit == null ? 'not derivable — the platform did not pair a CLP amount with a credit count' : `${formatNumber(report.priceList.clpPerCredit, 4)} CLP/crédito (${report.priceList.clpPerCreditSource})`}`)
  lines.push(`- Observed credits per answered message: ${formatNumber(totals.perMessage.credits, 2)} (${totals.perMessage.creditsSource || 'not reported'})`)
  lines.push(`- Published credits per question: ${report.priceList.tariff ? formatNumber(report.priceList.tariff.cost) : 'not served'}`)
  lines.push(`- Derived CLP per answered message: ${totals.cost.observedClpPerMessage == null ? 'not derivable' : `${formatNumber(totals.cost.observedClpPerMessage, 2)} CLP`}`)
  lines.push(`- Derived CLP per published question: ${totals.cost.publishedClpPerQuestion == null ? 'not derivable' : `${formatNumber(totals.cost.publishedClpPerQuestion, 2)} CLP`}`)
  lines.push('')
  lines.push('## How each number was obtained')
  lines.push('')
  lines.push('- Latency: from the click on "Enviar" to the answer fully rendered in the transcript (the API time is in the JSON).')
  lines.push('- Characters: the `question` field of the request the platform received.')
  lines.push('- Tokens: the platform response, when it reports them; otherwise "not reported". Nothing is estimated.')
  lines.push('- Credits: the balance before minus the balance after each answer (the answer body first, the on-screen chip as fallback).')
  lines.push('- Price list: the calls the front itself makes when the wallet and the coach open, read from the response bodies.')
  if (report.ledger) {
    lines.push(`- Ledger cross-check: ${report.ledger.usageDebits} USAGE_DEBIT row(s) worth ${formatNumber(report.ledger.creditsDebited)} credit(s) on the first movements page${report.ledger.hasMore ? ' (the page reports more rows)' : ''}.`)
  }
  lines.push('')
  lines.push(`Artifacts: \`${report.artifacts.json || 'not written'}\` · \`${report.artifacts.markdown || 'not written'}\``)
  return lines
}

function creditsLine(totals) {
  const credits = totals.credits || {}
  const observed = credits.observed
  const delta = credits.fromBalances
  if (delta != null) {
    return `${formatNumber(delta)} credit(s) (balance ${formatNumber(credits.before)} → ${formatNumber(credits.after)}; ` +
      `the per-message deltas add up to ${observed == null ? 'not reported' : formatNumber(observed)} over ` +
      `${credits.messagesWithDebit || 0} of ${totals.answered} answer(s))`
  }
  if (observed != null) return `${formatNumber(observed)} credit(s) (sum of the per-message deltas over ${credits.messagesWithDebit || 0} answer(s))`
  return 'not reported'
}

function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return 'not reported'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function formatMs(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'not reported'
  return `${Math.round(value)} ms`
}

function formatDuration(ms) {
  if (ms == null) return 'not reported'
  const seconds = ms / 1000
  return seconds < 90 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

async function writeArtifacts(page, report) {
  const dir = page.artifactDir
  if (!dir) return { json: null, markdown: null }
  await mkdir(dir, { recursive: true })
  const jsonPath = join(dir, 's8-credit-burn.json')
  const markdownPath = join(dir, 's8-credit-burn.md')
  // The Markdown names its own files, so the paths exist before it is rendered
  // (a partial report written from the `finally` block benefits too).
  report.artifacts = { json: jsonPath, markdown: markdownPath }
  const safe = redactValue(report)
  await writeFile(jsonPath, `${JSON.stringify(safe, null, 2)}\n`)
  await writeFile(markdownPath, `${entryLines(safe).join('\n')}\n`)
  return { json: jsonPath, markdown: markdownPath }
}

/* ============================ the scenario ============================ */

export default {
  id: 'S8',
  title: 'Credit burn — the real cost of a welcome account, measured message by message',
  async run({ page, context, log }) {
    const host = (() => {
      try { return new URL(BASE_URL).host } catch { return BASE_URL }
    })()
    const guardrails = {
      maxMessages: positiveInt('E2E_BURN_MAX_MESSAGES', DEFAULT_MAX_MESSAGES),
      maxSeconds: positiveInt('E2E_BURN_MAX_SECONDS', DEFAULT_MAX_SECONDS),
      answerTimeoutMs: positiveInt('E2E_BURN_ANSWER_TIMEOUT_MS', DEFAULT_ANSWER_TIMEOUT_MS),
    }
    const optInValue = process.env[SPEND_FLAG] == null ? 'unset' : process.env[SPEND_FLAG]

    // --- the gate ---------------------------------------------------------
    // Opt-in is checked first: without it the scenario must not even need the
    // mailbox, let alone create an account.
    if (process.env[SPEND_FLAG] !== '1') {
      return {
        status: 'BLOCKED',
        reason:
          `skipped — ${SPEND_FLAG}=1 is not set (value: ${optInValue}). This scenario spends real AI ` +
          `tokens and the account's welcome credits on ${host}, so it did not register, open the coach ` +
          `or send a single message`,
        evidence: [
          { label: 'opt-in', value: `${SPEND_FLAG}=${optInValue}` },
          { label: 'host', value: host },
          { label: 'guardrails that would apply', value: `${guardrails.maxMessages} messages · ${guardrails.maxSeconds}s · ${guardrails.answerTimeoutMs}ms per answer` },
        ],
      }
    }
    if (!context.mailbox) {
      // The harness's own inbox is down. That does not settle the question: S8
      // can still create its own, so it is attempted below and the exact error
      // is reported when it cannot.
      log(`the harness's shared inbox is unavailable (${context.mailboxError || 'no reason reported'}); trying this run's own inbox`)
    }

    log(`SPEND OPT-IN — real AI tokens and welcome credits will be consumed on ${host}`)

    const startedAt = Date.now()
    const generatedAt = new Date(startedAt).toISOString()
    const name = String(process.env.E2E_BURN_NAME || '').trim() || 'Camila'
    const messages = []
    const screenshots = []
    const evidence = []
    const report = {
      generatedAt,
      environment: { host, heart: HEART, apiHost: API_HOST, baseUrl: BASE_URL, chrome: context.chromeVersion || null },
      optIn: { flag: SPEND_FLAG, value: optInValue },
      guardrails,
      account: {
        name,
        address: null,
        plusAddressed: null,
        addressNote: null,
        registered: false,
        welcomeBonus: null,
        initialBalance: null,
        initialBalanceSource: 'not reported',
        initialBalanceUi: null,
        finalBalance: null,
        finalBalanceSource: 'not reported',
      },
      priceList: {
        limits: { min: null, max: null, status: null, bodyReadable: false, source: 'not read' },
        tariffs: { status: null, bodyReadable: false, rows: [] },
        tariff: null,
        tariffSource: 'not read',
        panelCost: null,
        clpPerCredit: null,
        clpPerCreditSource: null,
        quote: { status: null, bodyReadable: false, offers: [], currenciesSeen: [] },
      },
      messages,
      reverifications: [],
      stop: null,
      totals: null,
      ledger: null,
      artifacts: { json: null, markdown: null },
      screenshots,
    }
    let initialBalance = null
    let lastBalance = null
    let stop = null
    let answered = 0
    let registered = false

    try {
      // --- a brand-new account --------------------------------------------
      const selected = Array.isArray(context.selectedScenarios) ? context.selectedScenarios : []
      const onlyS8 = selected.length === 1 && String(selected[0]).toUpperCase() === 'S8'
      const inbox = await createFreshInbox({ log, shared: context.mailbox, reuseShared: onlyS8 })
      report.account.address = inbox.address
      report.account.plusAddressed = inbox.plusAddressed
      report.account.addressNote = inbox.note
      const accountContext = {
        ...context,
        mailbox: inbox.mailbox,
        email: inbox.address,
        sentAt: new Date().toISOString(),
      }

      await page.goto(`${BASE_URL}/`, { timeoutMs: 30000 })
      await page.expectText(TEXT.landingRegisterHeading, 20000)
      const scope = { heading: TEXT.landingRegisterHeading }
      await page.fill(TEXT.registerName, name, { scope })
      await page.fill(TEXT.contactEmail, inbox.address, { scope })
      const terms = await page.checkByText(TEXT.terms, { scope })
      if (!terms.checked) throw fail('the Terms checkbox did not get ticked, so the registration could not be requested')

      accountContext.sentAt = new Date().toISOString()
      await page.clickText(TEXT.registerSubmit, { scope })
      const magicRequest = await page.waitForRequest(
        r => r.method === 'POST' && r.path === '/auth/magic-link',
        20000
      )
      if (magicRequest.host !== API_HOST) {
        throw fail(`POST /auth/magic-link went to ${magicRequest.host}, expected ${API_HOST}`)
      }
      let magicBody = {}
      try { magicBody = JSON.parse(magicRequest.postData || '{}') } catch { /* kept empty */ }
      if (magicBody.heart !== HEART) {
        throw fail(`POST /auth/magic-link carried heart=${JSON.stringify(magicBody.heart)}, expected ${HEART}`)
      }
      if (magicBody.email !== inbox.address) {
        throw fail(`POST /auth/magic-link carried email=${JSON.stringify(magicBody.email)}, expected the fresh address`)
      }
      const magicResponse = await platformResponse(page, magicRequest)
      if (magicResponse.status !== 200) {
        throw fail(`POST /auth/magic-link answered HTTP ${magicResponse.status}, so no account could be created`)
      }
      const magicAnswer = await page.responseJson(magicRequest.id)
      report.account.welcomeBonus = readWelcomeBonus(magicAnswer)
      if (!(await page.waitForText(TEXT.linkSent, 20000))) {
        throw fail('the landing did not confirm that the access link was sent')
      }

      // The real email, the real token, the front's own redemption path.
      const { me } = await redeemLatestLink(page, accountContext)
      const meBody = await page.responseJson(me.id)
      registered = true
      report.account.registered = true
      evidence.push({ label: 'registration', value: `POST /auth/magic-link → HTTP ${magicResponse.status}; GET /auth/me → HTTP ${me.status}` })
      evidence.push({
        label: 'welcome bonus',
        value: report.account.welcomeBonus
          ? `${report.account.welcomeBonus.creditsAdded} credit(s)${report.account.welcomeBonus.alreadyAwarded ? ' (already awarded)' : ''}`
          : 'not reported by the magic-link answer',
      })

      await openApp(page, '/home')
      const chipAfterRegistration = await readChip(page)
      report.account.initialBalanceUi = chipAfterRegistration.value
      const apiInitial = readBalance(meBody)

      // --- the platform's own price list, through the wallet ---------------
      const wallet = summariseWallet(await openWalletAndCollect(page, log))
      if (wallet.limits.min == null || wallet.limits.max == null) {
        const uiLimits = await limitsFromUi(page)
        if (uiLimits) {
          wallet.limits.min = uiLimits.min
          wallet.limits.max = uiLimits.max
          wallet.limits.source = uiLimits.source
        } else {
          wallet.limits.source = 'not reported'
        }
      } else {
        wallet.limits.source = 'GET /payments/limits (response body)'
      }
      report.priceList.limits = {
        min: wallet.limits.min,
        max: wallet.limits.max,
        status: wallet.limits.status,
        bodyReadable: wallet.limits.bodyReadable,
        source: wallet.limits.source,
        unitPrice: wallet.limits.unitPrice || null,
      }
      report.priceList.tariffs = wallet.tariffs
      report.priceList.quote = wallet.quote
      const tariff = wallet.tariffs.rows.find(row => row.code === 'gym_ai_chat')
        || wallet.tariffs.rows.find(row => row.cost != null)
        || null
      report.priceList.tariff = tariff
      report.priceList.tariffSource = tariff
        ? 'GET /tariffs (response body)'
        : (wallet.tariffs.bodyReadable ? 'GET /tariffs served no gym_ tariff' : 'GET /tariffs: the answer body was not readable')
      report.priceList.clpPerCredit = wallet.quote.clpPerCredit
      report.priceList.clpPerCreditSource = wallet.quote.clpPerCreditSource

      // The balance: the API's own number first, the visible chip as fallback.
      initialBalance = apiInitial == null ? chipAfterRegistration.value : apiInitial
      if (wallet.me.balance != null) initialBalance = wallet.me.balance
      report.account.initialBalance = initialBalance
      report.account.initialBalanceSource = wallet.me.balance != null
        ? 'GET /auth/me (the wallet re-asks it)'
        : apiInitial != null ? 'GET /auth/me (the magic-link redemption)'
          : chipAfterRegistration.value != null ? 'the balance chip' : 'not reported'
      lastBalance = initialBalance
      evidence.push({ label: 'initial balance', value: report.account.initialBalance == null ? 'not reported' : `${initialBalance} credits` })

      if (initialBalance == null) {
        throw new StepTimeout(
          'the fresh account was signed in but no balance could be read from /auth/me or the balance chip, so no credit could be measured',
          { pageText: await page.bodyText(4000).catch(() => '') }
        )
      }
      if (initialBalance <= 0) {
        throw fail(
          `the fresh account showed ${initialBalance} credits before the first question, so the welcome bonus did not arrive and there was nothing to burn`,
          { initialBalance, welcomeBonus: report.account.welcomeBonus }
        )
      }

      // --- the coach ------------------------------------------------------
      const coach = await openCoach(page, log)
      report.priceList.panelCost = coach.panelCost
      if (report.priceList.tariff && report.priceList.tariff.cost != null) {
        evidence.push({
          label: 'published tariff',
          value: `${report.priceList.tariff.code} = ${report.priceList.tariff.cost} credit(s) per question (GET /tariffs)`,
        })
      } else if (coach.panelCost != null) {
        evidence.push({ label: 'published tariff', value: `${coach.panelCost} credit(s) per question (the coach panel line)` })
      } else {
        evidence.push({ label: 'published tariff', value: 'not published by this deployment' })
      }

      // The app introduces the person's name on the first prompt of a
      // conversation, so the corpus never repeats it.
      const corpus = CORPUS
      if (new Set(corpus).size !== corpus.length) {
        throw new Error('the conversation corpus contains a repeated question')
      }

      // --- the conversation ----------------------------------------------
      let cursor = 0
      while (cursor < corpus.length) {
        if (answered >= guardrails.maxMessages) {
          stop = {
            reason: 'max-messages',
            detail: `the message cap (${guardrails.maxMessages}) was reached with ${lastBalance} credit(s) left`,
          }
          break
        }
        if (Date.now() - startedAt >= guardrails.maxSeconds * 1000) {
          stop = {
            reason: 'max-seconds',
            detail: `the wall-clock cap (${guardrails.maxSeconds}s) was reached after ${answered} answer(s)`,
          }
          break
        }
        if (lastBalance != null && lastBalance <= 0) {
          stop = { reason: 'balance-zero', detail: `the balance reached ${lastBalance} after ${answered} answer(s)` }
          break
        }

        const question = corpus[cursor]
        cursor++
        const submitted = await askOnce(page, question, guardrails.answerTimeoutMs)
        const attempt = {
          index: messages.length + 1,
          corpusIndex: cursor,
          question,
          sentQuestion: submitted.sentQuestion,
          typedChars: question.length,
          charsSent: submitted.sentQuestion.length,
          submittedAt: new Date(submitted.submittedAt).toISOString(),
          httpStatus: submitted.response.status,
          latencyMs: null,
          apiMs: submitted.response.responseAt
            ? submitted.response.responseAt - submitted.submittedAt
            : null,
          renderedObserved: false,
          outcome: 'pending',
          tokens: { in: null, out: null, total: null, reported: false, source: 'not reported', derivedTotal: false },
          creditsDebited: null,
          balanceAfter: null,
          balanceSource: 'not reported',
          conversationId: null,
          operationId: null,
          answerChars: null,
          error: null,
        }

        if (submitted.response.status === 200) {
          const body = await page.responseJson(submitted.request.id)
          const parsed = readAssistant(body)
          attempt.tokens = parsed.tokens
          attempt.conversationId = parsed.conversationId
          attempt.operationId = parsed.operationId
          attempt.balanceAfter = parsed.balance
          attempt.answerChars = parsed.answer.length

          if (!parsed.answer) {
            const rendered = await waitForAnswerRendered(page, '')
            attempt.latencyMs = rendered ? Date.now() - submitted.submittedAt : null
            attempt.outcome = 'empty-answer'
            attempt.error = { code: 'NO_ANSWER', message: 'the 200 answer carried no text' }
            messages.push(attempt)
            stop = { reason: 'empty-answer', detail: 'the platform answered 200 but the body carried no answer text' }
            break
          }

          const rendered = await waitForAnswerRendered(page, parsed.answer)
          attempt.renderedObserved = rendered
          attempt.latencyMs = rendered ? Date.now() - submitted.submittedAt : attempt.apiMs
          const chip = await readChip(page)
          if (attempt.balanceAfter == null) attempt.balanceAfter = chip.value
          attempt.balanceSource = parsed.balance != null
            ? 'the answer body'
            : chip.value != null ? 'the balance chip' : 'not reported'
          if (lastBalance != null && attempt.balanceAfter != null) {
            attempt.creditsDebited = lastBalance - attempt.balanceAfter
          }
          attempt.outcome = 'answered'
          answered++
          messages.push(attempt)
          lastBalance = attempt.balanceAfter == null ? lastBalance : attempt.balanceAfter

          if (answered === 1) {
            const shot = await page.screenshot('s8-credit-burn-conversation')
            if (shot.path) screenshots.push(shot.path)
          }
          if (lastBalance != null && lastBalance <= 0) {
            stop = {
              reason: 'balance-zero',
              detail: `the balance reached ${lastBalance} after ${answered} answer(s)`,
            }
            break
          }
          continue
        }

        // Not a 200: nothing was answered. Read the platform's error, and stop —
        // a retry could spend twice or hide the real state.
        const body = await page.responseJson(submitted.request.id)
        attempt.error = readError(body)

        // The welcome-bonus pause: the platform asks the account to confirm its
        // email again before it can spend more. The refused turn was never
        // charged, so the account confirms the mailed notice and the same
        // question is sent again — exactly what a person would do.
        if (submitted.response.status === 403 && isReverifyPause(attempt.error)) {
          attempt.outcome = 'paused-for-reverify'
          messages.push(attempt)
          const reverify = await completeReverification(page, accountContext)
          report.reverifications.push({
            afterMessage: attempt.index,
            at: new Date().toISOString(),
            balanceBefore: lastBalance,
            ok: reverify.ok,
            detail: reverify.detail,
            subject: reverify.subject,
            linkHost: reverify.linkHost,
            endpoint: reverify.endpoint,
          })
          evidence.push({ label: 're-verification', value: reverify.detail })
          if (!reverify.ok) {
            stop = { reason: 'reverify-failed', detail: reverify.detail }
            break
          }
          cursor-- // the question was never answered: it goes back in the box
          continue
        }

        attempt.outcome = submitted.response.status === 402 ? 'refused' : 'error'
        messages.push(attempt)
        const uiState = submitted.response.status === 402
          ? await page.waitForText(INSUFFICIENT, 10000).catch(() => false)
          : submitted.response.status === 501 || submitted.response.status === 404
            ? await page.waitForText('El asistente aún no está disponible', 10000).catch(() => false)
            : false
        if (submitted.response.status === 402) {
          stop = {
            reason: 'insufficient-credits',
            detail: `POST /opengym/ai answered 402 after ${answered} answer(s)${uiState ? ' and the panel showed "Tu saldo necesita una recarga para esto"' : ''}`,
          }
        } else if (submitted.response.status === 401) {
          stop = { reason: 'session-expired', detail: 'the platform answered 401 in the middle of the conversation' }
        } else if (submitted.response.status === 429) {
          stop = { reason: 'rate-limited', detail: 'the platform answered 429 (chat rate limit); the conversation was not retried' }
        } else if (submitted.response.status === 501 || submitted.response.status === 404) {
          stop = {
            reason: 'assistant-not-available',
            detail: `the coach is not available on this deployment (HTTP ${submitted.response.status}${attempt.error.code ? `, ${attempt.error.code}` : ''}); nothing was charged`,
          }
        } else {
          stop = {
            reason: `http-${submitted.response.status}`,
            detail: attempt.error.message || `POST /opengym/ai answered HTTP ${submitted.response.status}`,
          }
        }
        break
      }

      if (!stop) {
        stop = answered >= guardrails.maxMessages
          ? { reason: 'max-messages', detail: `the message cap (${guardrails.maxMessages}) was reached` }
          : { reason: 'corpus-exhausted', detail: `the corpus ran out after ${answered} answer(s)` }
      }

      // --- the final balance and the ledger ------------------------------
      const finalShot = await page.screenshot('s8-credit-burn-conversation-final')
      if (finalShot.path) screenshots.push(finalShot.path)
      const finalWallet = summariseWallet(await openWalletAndCollect(page, log))

      // The wallet's first pass can answer before the platform has the heart's
      // prices ready (204 with no body). The final pass asks the same calls
      // with the session warm, so the price list is taken from whichever pass
      // actually carried the numbers.
      if (report.priceList.limits.min == null || report.priceList.tariff == null || !report.priceList.quote.bodyReadable) {
        if (report.priceList.limits.min == null && finalWallet.limits.min != null) {
          report.priceList.limits = {
            min: finalWallet.limits.min,
            max: finalWallet.limits.max,
            status: finalWallet.limits.status,
            bodyReadable: finalWallet.limits.bodyReadable,
            source: finalWallet.limits.source || 'GET /payments/limits (the final wallet pass)',
            unitPrice: finalWallet.limits.unitPrice || null,
          }
        }
        if (report.priceList.tariff == null && finalWallet.tariffs.rows.length) {
          const finalTariff = finalWallet.tariffs.rows.find(row => row.code === 'gym_ai_chat')
            || finalWallet.tariffs.rows.find(row => row.cost != null)
            || null
          report.priceList.tariff = finalTariff
          report.priceList.tariffSource = finalTariff
            ? 'GET /tariffs (the final wallet pass)'
            : report.priceList.tariffSource
        }
        if (!report.priceList.quote.bodyReadable && finalWallet.quote.bodyReadable) {
          report.priceList.quote = {
            status: finalWallet.quote.status,
            bodyReadable: finalWallet.quote.bodyReadable,
            offers: finalWallet.quote.offers,
            currenciesSeen: finalWallet.quote.currenciesSeen,
          }
          report.priceList.clpPerCredit = finalWallet.quote.clpPerCredit
          report.priceList.clpPerCreditSource = finalWallet.quote.clpPerCreditSource
        }
      }
      const finalChip = await readChip(page)
      const finalBalance = finalWallet.me.balance == null ? finalChip.value : finalWallet.me.balance
      report.account.finalBalance = finalBalance
      report.account.finalBalanceSource = finalWallet.me.balance != null ? 'GET /auth/me (the wallet re-asks it)'
        : finalChip.value != null ? 'the balance chip' : 'not reported'
      report.ledger = {
        status: finalWallet.movements.status,
        bodyReadable: finalWallet.movements.bodyReadable,
        usageDebits: finalWallet.movements.usageDebits,
        creditsDebited: finalWallet.movements.creditsDebited,
        hasMore: finalWallet.movements.hasMore,
        page: 1,
      }
      const walletShot = await page.screenshot('s8-credit-burn-wallet')
      if (walletShot.path) screenshots.push(walletShot.path)

      // --- totals ---------------------------------------------------------
      const answeredRows = messages.filter(message => message.outcome === 'answered')
      const knownCredits = answeredRows.filter(message => message.creditsDebited != null)
      const creditsObserved = knownCredits.length
        ? knownCredits.reduce((sum, message) => sum + message.creditsDebited, 0)
        : null
      const creditsFromBalances = initialBalance != null && finalBalance != null
        ? initialBalance - finalBalance
        : null
      const charsSent = answeredRows.reduce((sum, message) => sum + (message.charsSent || 0), 0)
      const withTokens = answeredRows.filter(message => message.tokens && message.tokens.reported)
      const sumToken = key => withTokens.reduce((sum, message) => sum + (message.tokens[key] == null ? 0 : message.tokens[key]), 0)
      const latencies = answeredRows.map(message => message.latencyMs).filter(value => value != null)
      const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
      const clpPerCredit = report.priceList.clpPerCredit
      // The average comes from the per-message deltas when they were readable;
      // otherwise from the run's own balance delta, and the report names which.
      const averageCredits = answeredRows.length === 0
        ? null
        : creditsObserved != null
          ? creditsObserved / answeredRows.length
          : creditsFromBalances != null
            ? creditsFromBalances / answeredRows.length
            : null
      const averageCreditsSource = averageCredits == null
        ? 'not reported'
        : creditsObserved != null
          ? 'the per-message balance deltas'
          : 'the run\'s balance delta (initial minus final)'
      const publishedClpPerQuestion = report.priceList.tariff && report.priceList.tariff.clp
        ? report.priceList.tariff.clp.value
        : report.priceList.tariff && report.priceList.tariff.cost != null && clpPerCredit != null
          ? report.priceList.tariff.cost * clpPerCredit
          : null
      report.totals = {
        elapsedMs: Date.now() - startedAt,
        attempts: messages.length,
        answered: answeredRows.length,
        charsSent,
        tokens: {
          in: withTokens.length ? sumToken('in') : null,
          out: withTokens.length ? sumToken('out') : null,
          total: withTokens.length ? sumToken('total') : null,
          reported: withTokens.length > 0,
          messagesWithTokens: withTokens.length,
          source: withTokens.length ? 'the platform response (see each message)' : 'the platform reported no token figure',
        },
        credits: {
          observed: creditsObserved,
          fromBalances: creditsFromBalances,
          messagesWithDebit: knownCredits.length,
          before: initialBalance,
          after: finalBalance,
        },
        latency: {
          meanRenderedMs: mean(latencies),
          samples: latencies.length,
        },
        perMessage: {
          credits: averageCredits,
          creditsSource: averageCreditsSource,
          chars: answeredRows.length ? charsSent / answeredRows.length : null,
          latencyMs: mean(latencies),
          tokensTotal: withTokens.length ? sumToken('total') / withTokens.length : null,
        },
        cost: {
          clpPerCredit,
          clpPerCreditSource: report.priceList.clpPerCreditSource,
          publishedCreditsPerQuestion: report.priceList.tariff ? report.priceList.tariff.cost : null,
          publishedClpPerQuestion,
          publishedClpPerQuestionSource: report.priceList.tariff && report.priceList.tariff.clp
            ? 'the tariff row already carries a CLP price'
            : publishedClpPerQuestion != null ? 'the tariff credits × the quote\'s CLP per credit' : null,
          observedClpPerMessage: averageCredits != null && clpPerCredit != null ? averageCredits * clpPerCredit : null,
        },
      }
      report.stop = stop

      // --- the artifact and the verdict ----------------------------------
      report.screenshots = screenshots
      report.artifacts = await writeArtifacts(page, report)
      evidence.push({ label: 'stop', value: `${stop.reason} — ${stop.detail}` })
      evidence.push({
        label: 'totals',
        value: `${answeredRows.length} answer(s), ${charsSent} character(s), ${creditsFromBalances == null ? 'credits not reported' : `${creditsFromBalances} credit(s) consumed`}, ${mean(latencies) == null ? 'latency not reported' : `${Math.round(mean(latencies))} ms average`}`,
      })
      evidence.push({
        label: 'price list',
        value: `limits ${report.priceList.limits.min == null ? 'not reported' : `${report.priceList.limits.min}–${report.priceList.limits.max} CLP`}; tariff ${report.priceList.tariff ? `${report.priceList.tariff.cost} credit(s)/question` : 'not served'}; CLP per credit ${clpPerCredit == null ? 'not derivable' : clpPerCredit.toFixed(4)}`,
      })
      evidence.push({ label: 'report', value: report.artifacts.markdown || 'not written (no artifact directory)' })
      evidence.push({ label: 'ledger cross-check', value: `${finalWallet.movements.usageDebits} USAGE_DEBIT row(s) worth ${finalWallet.movements.creditsDebited} credit(s) on page 1` })

      if (stop.reason === 'assistant-not-available') {
        return {
          status: 'BLOCKED',
          reason: `the coach is not available on ${host} — ${stop.detail}; the account was created but no credit was spent`,
          evidence,
          screenshots,
        }
      }
      if (stop.reason === 'session-expired' || stop.reason === 'rate-limited') {
        return {
          status: 'BLOCKED',
          reason: `the conversation stopped after ${answeredRows.length} answer(s) — ${stop.detail}`,
          evidence,
          screenshots,
        }
      }
      if (stop.reason === 'empty-answer' || String(stop.reason).startsWith('http-')) {
        return {
          status: 'FAIL',
          reason: `the conversation stopped after ${answeredRows.length} answer(s) — ${stop.detail}`,
          evidence: [...evidence, { label: 'platform state', value: JSON.stringify(messages[messages.length - 1].error || {}) }],
          screenshots,
        }
      }
      if (answeredRows.length === 0) {
        return {
          status: 'BLOCKED',
          reason: `the coach was opened but no answer was measured — ${stop.detail}`,
          evidence,
          screenshots,
        }
      }
      return {
        reason:
          `${answeredRows.length} answer(s) measured over ${(report.totals.elapsedMs / 1000).toFixed(1)}s; ` +
          `${creditsFromBalances == null ? 'credits not reported' : `${creditsFromBalances} of ${initialBalance} credit(s) consumed`}, ` +
          `${charsSent} character(s) sent, ` +
          `${report.totals.tokens.reported ? `${report.totals.tokens.total} token(s) reported` : 'no token figure reported'}; ` +
          `stopped because ${stop.detail || stop.reason}; the report is ${report.artifacts.markdown || 'not written'}`,
        evidence,
        screenshots,
      }
    } finally {
      // Whatever happened, the evidence of what WAS observed is written. A
      // blocked registration has no artifact (there is no measurement to keep).
      if (!report.artifacts.markdown && (registered || messages.length)) {
        try {
          report.stop = stop || { reason: 'interrupted', detail: 'the scenario ended before the loop finished' }
          report.totals = report.totals || null
          report.screenshots = screenshots
          report.artifacts = await writeArtifacts(page, report)
        } catch (e) {
          console.error(`[S8] the partial report could not be written: ${e && e.message ? e.message : e}`)
        }
      }
    }
  },
}
