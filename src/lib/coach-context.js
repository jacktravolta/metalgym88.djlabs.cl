// What the AI coach is told about the page the user is standing on.
//
// The owner's rule: the coach is always one tap away, and what it receives as context
// is the data of the screen the user is on. This file is the ONLY place that decides
// WHAT that data is — a view registers WHICH screen it is, and the builders below turn
// the store into the lines the coach reads.
//
// A STACK, not a single value: an exercise sheet opens on top of the library list, and
// the sheet is the more specific answer. The top of the stack wins; closing it (the
// sheet goes away) brings the list back underneath.
//
// The entries keep a GETTER, not a snapshot: a view registers once, when it mounts, and
// the data is read at the moment the coach opens — so the context describes what is on
// screen RIGHT NOW, not what was on screen when the view appeared.
import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from './i18n.js'
import { fmtNum, fmtDate, fmtVol, todayISO, DAYN, exCount } from './format.js'
import { effectiveRoutine, streakWeeks, lastBW, setsDoneActive } from './history.js'
import { exName, allExercises } from './exercises.js'

// The payload is a summary, not a dump: the coach needs the shape of the screen, not
// every number in the account. Forty lines and two hundred characters per line is
// enough to describe a screen and small enough to stay cheap to send.
export const MAX_COACH_LINES = 40
export const MAX_COACH_LINE_CHARS = 200

/* ============================== the stack ============================== */

const stack = []
let seq = 0

// Pushes a context and returns its id (the id is what unregisters it later).
// `entry` is either { view, title, lines } or { view, provider } — a provider is a
// getter, so the entry always reads the CURRENT data instead of a stale copy.
export function pushCoachContext(entry) {
  const id = 'coach-' + (++seq)
  stack.push({ ...(entry || {}), id })
  return id
}

// Removes a context. Unknown ids are ignored — unregistering twice must not throw.
export function popCoachContext(id) {
  const i = stack.findIndex(e => e.id === id)
  if (i >= 0) stack.splice(i, 1)
}

// The context on top of the stack (the most specific one), resolved. null when there
// is none — the coach then simply gets no context, which is a normal state.
export function currentCoachContext() {
  const top = stack.length ? stack[stack.length - 1] : null
  if (!top) return null
  return resolveEntry(top)
}

function resolveEntry(entry) {
  let raw = entry
  if (typeof entry.provider === 'function') {
    // A provider that throws must not take the whole coach down: an empty context is
    // always better than a broken button.
    try { raw = entry.provider() || {} } catch (e) { raw = {} }
  }
  if (!raw || typeof raw !== 'object') raw = {}
  const lines = Array.isArray(raw.lines) ? raw.lines.filter(l => typeof l === 'string') : []
  return {
    view: entry.view || raw.view || '',
    title: raw.title ? String(raw.title) : '',
    lines,
  }
}

/* ============================ the React hook ============================ */

// Registers a screen's context while it is mounted.
//
// The provider is optional: without one the view's builder (below) is used. With one,
// the provider is called every time the context is READ — that is what keeps the data
// fresh without re-registering on every render, which would scramble the stack order
// (the entry would jump above the sheets opened on top of it).
export function useCoachContext(view, provider) {
  const ref = useRef(provider)
  // Refresh the getter after every render; the registration below stays put.
  useEffect(() => { ref.current = provider })
  useEffect(() => {
    const id = pushCoachContext({ view, provider: () => (ref.current ? ref.current() : null) })
    return () => popCoachContext(id)
  }, [view])
}

/* ============================== the payload ============================= */

// What travels with the question: the screen, its title and its lines.
export function buildCoachPayload() {
  const ctx = currentCoachContext()
  if (!ctx) return null
  const lines = ctx.lines
    .map(l => l.trim())
    .filter(l => l !== '')
    .slice(0, MAX_COACH_LINES)
    .map(l => (l.length > MAX_COACH_LINE_CHARS ? l.slice(0, MAX_COACH_LINE_CHARS) : l))
  return { view: ctx.view, title: ctx.title, lines }
}

/* ============================ per-view builders ============================ */

const state = () => useStore.getState().S || {}

// One line per finished session: name, date and volume — and nothing that the log
// does not actually hold (a session without a volume says only what it knows).
function workoutLine(w, unit) {
  const date = fmtDate(w.d, true)
  const vol = typeof w.vol === 'number' ? fmtVol(w.vol, unit) : null
  if (w.name && vol) return t('{0} — {1} — {2}', w.name, date, vol)
  if (w.name) return t('{0} — {1}', w.name, date)
  if (vol) return t('{0} — {1}', date, vol)
  return date
}

export const VIEW_BUILDERS = {
  // What to do today, what it touches, the streak and the current weight.
  home: () => {
    const st = state()
    const lines = []
    const routine = effectiveRoutine(st, todayISO())
    if (st.active) lines.push(t('Session in progress: {0}', st.active.name))
    else if (routine) lines.push(t("Today's routine: {0}", routine.name))
    else lines.push(t('Rest day — no routine scheduled'))
    if (routine) routine.ex.forEach(e => lines.push(t('Exercise: {0}', exName(e.id))))
    const streak = streakWeeks(st)
    lines.push(t(streak === 1 ? '{0} week streak' : '{0} weeks streak', streak))
    const bw = lastBW(st)
    if (bw) lines.push(t('Current weight: {0} {1}', fmtNum(bw.w), st.unit))
    return { title: t('Home'), lines }
  },

  // The routines and what each day of the week holds.
  plan: () => {
    const st = state()
    const lines = []
    st.routines.forEach(r => lines.push(t('{0} — {1}', r.name, exCount(r.ex.length))))
    ;[1, 2, 3, 4, 5, 6, 0].forEach(d => {
      const r = st.routines.find(x => x.id === st.week[d])
      lines.push(t('{0}: {1}', t(DAYN[d]), r ? r.name : t('Rest')))
    })
    return { title: t('Plan'), lines }
  },

  // The library without filters (the view supplies its own — see libraryCoachContext).
  library: () => {
    const st = state()
    return { title: t('Exercises'), lines: [t('{0} exercises', allExercises(st).length)] }
  },

  // The session in progress: its exercises and how far each of them got.
  workout: () => {
    const st = state()
    const A = st.active
    if (!A) return { title: t('Workout'), lines: [] }
    const lines = [t('Session in progress: {0}', A.name)]
    A.entries.forEach(e => {
      const done = e.sets.filter(s => s.done).length
      lines.push(t('{0} — {1}', exName(e.id), t('{0}/{1} sets', done, e.sets.length)))
    })
    lines.push(t('Sets completed: {0}', setsDoneActive(A)))
    return { title: t('Workout'), lines }
  },

  // The aggregates plus the last few sessions.
  stats: () => {
    const st = state()
    const lines = [t('{0} workouts total', st.workouts.length)]
    const streak = streakWeeks(st)
    lines.push(t(streak === 1 ? '{0} week streak' : '{0} weeks streak', streak))
    const bw = lastBW(st)
    if (bw) lines.push(t('Current weight: {0} {1}', fmtNum(bw.w), st.unit))
    ;[...st.workouts].reverse().slice(0, 5).forEach(w => lines.push(workoutLine(w, st.unit)))
    return { title: t('Stats'), lines }
  },

  // The last sessions with their date and volume.
  history: () => {
    const st = state()
    const lines = []
    ;[...st.workouts].reverse().slice(0, 10).forEach(w => lines.push(workoutLine(w, st.unit)))
    return { title: t('History'), lines }
  },
}

// The library's filters are per-session UI state (they live in the view, not in the
// store), so the view hands them over and the RULE of what to say about them stays
// here — same contract as a builder: it returns { title, lines }.
export function libraryCoachContext({ q = '', bp = '', eq = '', visible = 0 } = {}) {
  return () => {
    const lines = []
    const search = String(q || '').trim()
    if (search) lines.push(t('Search: {0}', search))
    if (bp) lines.push(t('Muscle group filter: {0}', t(bp)))
    if (eq) lines.push(t('Equipment filter: {0}', t(eq)))
    lines.push(t('{0} exercises visible', visible))
    return { title: t('Exercises'), lines }
  }
}
