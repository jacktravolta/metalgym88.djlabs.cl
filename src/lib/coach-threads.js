// The coach's conversation threads, kept on THIS device only.
//
// The transcript never belongs in the store's S blob: S is mirrored to the
// platform. It lives under its own localStorage key, in a small bounded shape,
// and every storage operation is defensive — a blocked or full storage means
// "no memory", never a broken coach.
//
// Exercise cards are stored as catalogue ids. The names, images and links are
// rebuilt from the current catalogue when a thread is restored, so a renamed
// exercise stays current and an exercise removed from the catalogue disappears
// instead of rendering as a broken card.
//
// No console.* anywhere in this module: questions and answers are personal content.
import { exerciseCards, MAX_COACH_ARTIFACT_EXERCISES } from './coach-exercises.js'
import { COACH_THREADS_KEY } from './coach-threads-key.js'

export { COACH_THREADS_KEY } from './coach-threads-key.js'

export const MAX_THREADS = 10
export const MAX_THREAD_MSGS = 30
export const THREAD_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_THREAD_TITLE_CHARS = 64

const emptyMemory = () => ({
  version: 1,
  activeConversationId: null,
  threads: [],
})

function resolveStorage(injected) {
  try {
    const candidate = injected === undefined ? globalThis.localStorage : injected
    if (!candidate ||
      typeof candidate.getItem !== 'function' ||
      typeof candidate.setItem !== 'function' ||
      typeof candidate.removeItem !== 'function') return null
    return candidate
  } catch {
    return null
  }
}

function readRaw(store) {
  try { return store.getItem(COACH_THREADS_KEY) } catch { return null }
}

function writeRaw(store, value) {
  try {
    store.setItem(COACH_THREADS_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function removeRaw(store) {
  try {
    store.removeItem(COACH_THREADS_KEY)
    return true
  } catch {
    return false
  }
}

function finiteTime(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

// A conversation is NAMED, not quoted. The greeting and everything after the
// first sentence are dropped, so the automatic question from the exercise sheet
// ("Hola Don Jack, resume el ejercicio…") can never become the title of the
// chat: a title is a handle for the person, not the question itself.
const TITLE_GREETING = /^(hola|hey|hi|buenas|buenos días|buenas tardes|buenas noches|querido|querida)\b[\s,:!¡]*/i

function cleanTitle(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const greeted = TITLE_GREETING.test(raw)
  let s = raw.replace(TITLE_GREETING, '')
  // The name that came right after the greeting is not part of the title either.
  if (greeted) s = s.replace(/^[^,.!?¿¡]{1,40},\s*/, '')
  // The first sentence is the topic; the rest is noise.
  const cut = s.search(/[.!?¿¡](\s|$)/)
  if (cut > 0) s = s.slice(0, cut + 1)
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > MAX_THREAD_TITLE_CHARS ? s.slice(0, MAX_THREAD_TITLE_CHARS).trimEnd() : s
}

/**
 * A short, factual title made from the first question in the thread. No model
 * call and no invented wording: it is the person's own words, compacted.
 */
export function deriveThreadTitle(messages) {
  const list = Array.isArray(messages) ? messages : []
  const first = list.find(message => message && message.role === 'user' && typeof message.text === 'string')
  return first ? cleanTitle(first.text) : ''
}

function exerciseIdsOf(message) {
  const ids = []
  const add = value => {
    if (typeof value !== 'string' || !value || ids.includes(value)) return
    ids.push(value)
  }
  if (Array.isArray(message.exerciseIds)) message.exerciseIds.forEach(add)
  if (Array.isArray(message.exercises)) message.exercises.forEach(card => {
    if (card && typeof card.id === 'string') add(card.id)
  })
  return ids.slice(0, MAX_COACH_ARTIFACT_EXERCISES)
}

function normalizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  const normalized = []
  for (const message of list) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
    if (typeof message.text !== 'string' || !message.text.trim()) continue
    const stored = { role: message.role, text: message.text }
    if (message.role === 'assistant') {
      const exerciseIds = exerciseIdsOf(message)
      if (exerciseIds.length) stored.exerciseIds = exerciseIds
    }
    normalized.push(stored)
  }
  return normalized.slice(-MAX_THREAD_MSGS)
}

function normalizeThread(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId.trim() : ''
  if (!conversationId) return null

  const messages = normalizeMessages(raw.messages)
  if (!messages.length) return null

  const createdAt = finiteTime(raw.createdAt, now)
  const updatedAt = finiteTime(raw.updatedAt, createdAt)
  return {
    conversationId,
    title: cleanTitle(raw.title) || deriveThreadTitle(messages),
    messages,
    createdAt,
    updatedAt,
  }
}

function newestFirst(threads) {
  return [...threads].sort((a, b) =>
    (b.updatedAt - a.updatedAt) ||
    (b.createdAt - a.createdAt) ||
    b.conversationId.localeCompare(a.conversationId))
}

function expired(thread, now) {
  return now >= thread.updatedAt + THREAD_TTL_MS
}

function normalizeMemory(raw, now) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const rawThreads = Array.isArray(source.threads) ? source.threads : []
  const threads = rawThreads
    .map(thread => normalizeThread(thread, now))
    .filter(Boolean)
    .filter(thread => !expired(thread, now))
  const kept = newestFirst(threads).slice(0, MAX_THREADS)
  const activeConversationId = kept.some(thread => thread.conversationId === source.activeConversationId)
    ? source.activeConversationId
    : null
  return { version: 1, activeConversationId, threads: kept }
}

/**
 * Reads the whole local memory. Expired threads disappear here, and a malformed
 * or unreadable value degrades to an empty memory without throwing.
 */
export function readCoachMemory({ storage, now = Date.now() } = {}) {
  const store = resolveStorage(storage)
  if (!store) return emptyMemory()

  const rawText = readRaw(store)
  if (rawText == null) return emptyMemory()

  let parsed
  try { parsed = JSON.parse(rawText) } catch {
    removeRaw(store)
    return emptyMemory()
  }

  const memory = normalizeMemory(parsed, now)
  const canonical = JSON.stringify(memory)
  if (canonical !== JSON.stringify(parsed)) {
    if (memory.threads.length) writeRaw(store, memory)
    else removeRaw(store)
  }
  return memory
}

/** The stored threads, newest first. */
export function listCoachThreads(options = {}) {
  return readCoachMemory(options).threads
}

/**
 * Creates or updates the thread for a platform conversation id. The active
 * thread becomes this one. The title comes from the first user message unless
 * an explicit title is supplied.
 */
export function upsertCoachThread(conversationId, messages, { storage, title = '', now = Date.now() } = {}) {
  const before = readCoachMemory({ storage, now })
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  const normalizedMessages = normalizeMessages(messages)
  if (!id || !normalizedMessages.length) return before

  const existing = before.threads.find(thread => thread.conversationId === id)
  const thread = {
    conversationId: id,
    title: cleanTitle(title) || (existing && existing.title) || deriveThreadTitle(normalizedMessages),
    messages: normalizedMessages,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  }
  const others = before.threads.filter(item => item.conversationId !== id)
  const memory = {
    version: 1,
    activeConversationId: id,
    threads: newestFirst([thread, ...others]).slice(0, MAX_THREADS),
  }

  const store = resolveStorage(storage)
  if (!store || !writeRaw(store, memory)) return before
  return memory
}

/** Removes one conversation from this device. */
export function removeCoachThread(conversationId, { storage, now = Date.now() } = {}) {
  const before = readCoachMemory({ storage, now })
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  if (!id || !before.threads.some(thread => thread.conversationId === id)) return before

  const memory = {
    version: 1,
    activeConversationId: before.activeConversationId === id ? null : before.activeConversationId,
    threads: before.threads.filter(thread => thread.conversationId !== id),
  }
  const store = resolveStorage(storage)
  if (!store || !writeRaw(store, memory)) return before
  return memory
}

/** Erases every coach conversation from this device. */
export function clearCoachThreads({ storage } = {}) {
  const before = readCoachMemory({ storage })
  const store = resolveStorage(storage)
  if (!store || !removeRaw(store)) return before
  return emptyMemory()
}

/** Marks a stored conversation as active; null starts a fresh conversation. */
export function setActiveCoachThread(conversationId, { storage, now = Date.now() } = {}) {
  const before = readCoachMemory({ storage, now })
  const id = typeof conversationId === 'string' ? conversationId.trim() : ''
  const activeConversationId = id || null
  if (activeConversationId && !before.threads.some(thread => thread.conversationId === activeConversationId)) {
    return before
  }
  if (before.activeConversationId === activeConversationId) return before

  const memory = { ...before, activeConversationId }
  const store = resolveStorage(storage)
  if (!store || !writeRaw(store, memory)) return before
  return memory
}

/**
 * Rebuilds the panel messages from their stored shape. Exercise cards come
 * from the current catalogue, and an id the catalogue no longer has is skipped.
 */
export function restoreThreadMessages(messages) {
  return normalizeMessages(messages).map(message => {
    if (message.role !== 'assistant') return { role: message.role, text: message.text }
    const exerciseIds = Array.isArray(message.exerciseIds) ? message.exerciseIds : []
    const exercises = exerciseCards(exerciseIds.map(id => ({ id })))
    return { role: message.role, text: message.text, exercises }
  })
}
