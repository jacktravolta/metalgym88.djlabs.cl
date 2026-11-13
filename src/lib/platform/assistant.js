// AI assistant calls against the djlabs platform, scoped to the metalgym88 heart.
//
// The assistant is the metered paid feature: POST /opengym/ai debits credits per
// operation server-side (CreditService, idempotent operation_id) and the response
// carries the remaining balance, so the UI can refresh "Saldo restante" after every
// completion. Conversation continuity rides on the platform's /chat/completions
// contract shape: the server hands back a conversation_id and every follow-up sends
// it again — transcripts live server-side only.
//
// The request body carries three things: the question, the conversation it belongs to
// and the heart. A fourth one is OPTIONAL — `context`, the summary of the screen the
// user opened the coach from ({ view, title, lines[] }, built by lib/coach-context.js).
// It is only sent when there is one: a question without a screen behind it is a normal
// question and must not grow an empty context field.
//
// PRE-T6 reality: the backend module is packaged (T6), not applied. The live platform
// legitimately answers 404/501 on /opengym/ai, and offline there is nothing to call at
// all — the same silent-keep philosophy as gym-data sync. Everything here CLASSIFIES
// outcomes into kinds instead of throwing raw; the component speaks, gently.
//
// No console.* anywhere in this module: questions and answers are personal content.
import { phttp } from './http.js'
import { HEART } from './config.js'
import { fetchTariffs } from './wallet.js'
import { buildExerciseArtifact, MAX_COACH_CONTEXT_CHARS } from '../coach-exercises.js'

export const ASSISTANT_PATH = '/opengym/ai'

/* ============================ offline ============================ */

// The browser's own signal. The entry point checks this BEFORE rendering as
// tappable, so the paid feature never silently eats a dead tap while offline.
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/* ============================ classification ============================ */

const INSUFFICIENT_CODES = ['INSUFFICIENT']

function classify(status, code) {
  if (status === 402 || INSUFFICIENT_CODES.some(c => String(code || '').toUpperCase().includes(c))) {
    return 'insufficient_credits'
  }
  if (status === 401) return 'auth'
  // Welcome-bonus gate: the platform stops spending BEFORE any charge until the
  // email is confirmed again (CreditService's reverify threshold). Same code the
  // sign-in screen keys on — say "confirm your email", never a generic retry that
  // hides the only next step.
  if (String(code || '').toUpperCase().includes('EMAIL_REVERIFY_REQUIRED')) return 'reverify'
  // Not applied (yet) or unreachable: 404/501 on a not-yet-applied module, and a
  // network-level failure (no numeric status — offline, DNS, CORS, server down).
  // Both read the same to the user: not available right now, never scary.
  if (status === 404 || status === 501 || typeof status !== 'number') return 'not_available'
  return 'error'
}

/* ============================ response normalization ============================ */

// The platform contract is `{ answer, conversation_id, balance, ... }`, but envelope
// habits differ across endpoints — accept the bare fields or a nested { data } wrap.
// Resolved ONCE here so every field reads from the same place.
function resolveEnvelope(d) {
  if (d && typeof d.answer === 'string') return d
  if (d && d.data && typeof d.data === 'object') return d.data
  return d || {}
}

function readBalance(d) {
  return typeof d.balance === 'number' ? d.balance : null
}

function readConversationId(d) {
  return d.conversation_id || d.conversationId || null
}

function readOperationId(d) {
  return d.operation_id || d.operationId || null
}

/* ============================ the call ============================ */

// The platform's own caps for the context it receives (40 characters for the
// view, 120 for the title, 200 per line, 1.200 for the whole context). They
// are restated here on purpose: this layer talks to the platform and must not
// import the front's context builder (lib/coach-context.js), which pulls the
// store — and a DOM — into a module that has to stay testable on its own.
const MAX_CONTEXT_LINES = 40
const MAX_CONTEXT_LINE_CHARS = 200
const MAX_CONTEXT_VIEW_CHARS = 40
const MAX_CONTEXT_TITLE_CHARS = 120

// The platform renders the context as text (a few labels of its own around
// the lines) and caps the WHOLE thing at 1.200 characters. This reserve is
// what that rendering costs on top of the lines themselves: guessing the
// exact wording would be a guess, so the budget keeps room for it instead.
const CONTEXT_LABEL_RESERVE = 80

function cleanContextValue(value, max) {
  return String(value || '')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// What the context costs once the platform renders it.
function contextCost(view, title, lines) {
  return view.length + title.length + CONTEXT_LABEL_RESERVE + lines.reduce((n, line) => n + line.length + 2, 0)
}

// The exercise artifact goes FIRST: the platform truncates the tail, and the
// artifact is the part tied to THIS question — the screen context can wait.
function contextWithExercises(context, matches) {
  const artifact = buildExerciseArtifact(matches)
  if (artifact.length === 0) return context

  const source = context && typeof context === 'object' ? context : {}
  const view = cleanContextValue(source.view, MAX_CONTEXT_VIEW_CHARS)
  const title = cleanContextValue(source.title, MAX_CONTEXT_TITLE_CHARS)
  const existing = Array.isArray(source.lines) ? source.lines : []
  const candidates = [...artifact, ...existing]
  const lines = []

  for (const candidate of candidates) {
    if (lines.length >= MAX_CONTEXT_LINES) break
    const line = cleanContextValue(candidate, MAX_CONTEXT_LINE_CHARS)
    if (!line) continue
    if (contextCost(view, title, [...lines, line]) <= MAX_COACH_CONTEXT_CHARS) {
      lines.push(line)
    }
  }

  return { view: view || 'coach', title, lines }
}

// askAssistant('…', { conversationId, context, exerciseMatches }) → one of:
//   { kind: 'ok', answer, conversationId, balance, operationId, status: null }
//   { kind: 'not_available' | 'insufficient_credits' | 'auth' | 'error', status, … }
// Never throws: every failure is a classified kind the UI can speak kindly.
// `context` is the optional screen summary. `exerciseMatches` are catalogue
// exercises resolved from THIS question; their compact artifact is added to
// the request context here, at send time, and never when the panel opens.
export async function askAssistant(question, { conversationId = null, context = null, exerciseMatches = [] } = {}) {
  const requestContext = contextWithExercises(context, exerciseMatches)
  const body = JSON.stringify({
    question,
    conversation_id: conversationId || null,
    heart: HEART,
    ...(requestContext ? { context: requestContext } : {}),
  })
  let d, status = null
  try {
    d = await phttp(ASSISTANT_PATH, { method: 'POST', body })
  } catch (e) {
    status = e && typeof e.status === 'number' ? e.status : null
    return { kind: classify(status, e && e.code), answer: '', conversationId: null, balance: null, operationId: null, status }
  }
  const src = resolveEnvelope(d)
  const answer = typeof src.answer === 'string' && src.answer.trim() ? src.answer
    : typeof src.reply === 'string' && src.reply.trim() ? src.reply : ''
  if (!answer) return { kind: 'error', answer: '', conversationId: null, balance: null, operationId: null, status: 200 }
  return {
    kind: 'ok',
    answer,
    conversationId: readConversationId(src),
    balance: readBalance(src),
    operationId: readOperationId(src),
    status: null,
  }
}

/* ============================ tariff before sending ============================ */

// The gym's own AI operation row: the backend module registers `gym_ai_chat` in T6,
// but any gym_* key the platform serves is accepted — the client never invents a
// number it was not given. Tariffs come from the wallet module's normalizer.
export function findGymTariff(tariffs) {
  if (!Array.isArray(tariffs)) return null
  return tariffs.find(r => r && typeof r.code === 'string' && r.code.startsWith('gym_') && r.cost != null) || null
}

// null = nothing usable served (the UI then says the cost is shown on confirm).
export async function fetchAssistantTariff() {
  try {
    return findGymTariff(await fetchTariffs())
  } catch (e) {
    return null
  }
}
