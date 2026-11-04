import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The store is replaced BEFORE it is loaded: the real module touches `document` while
// it is imported (the test environment has no DOM), and the builders only ever need
// getState(). The mock is installed through vi.hoisted so it exists before the
// imports below run.
const { store } = vi.hoisted(() => ({ store: { S: null } }))

vi.mock('../store/useStore.js', () => ({
  useStore: { getState: () => ({ S: store.S }) },
}))

import {
  pushCoachContext, popCoachContext, currentCoachContext,
  buildCoachPayload, useCoachContext, VIEW_BUILDERS, libraryCoachContext,
} from './coach-context.js'
import { todayISO } from './format.js'

// A small but complete state: two routines, a weekly plan, one weigh-in and two
// finished sessions. Ids 0001/0002/0003 are real catalogue entries, so the exercise
// names in the payload are the ones the user sees.
function baseState() {
  return {
    unit: 'kg',
    routines: [
      { id: 'r-push', name: 'Push', emoji: 'arm', ex: [{ id: '0001', sets: 3, reps: 10, weight: 40 }, { id: '0002', sets: 3, reps: 12, weight: 0 }] },
      { id: 'r-pull', name: 'Pull', emoji: 'pullup', ex: [{ id: '0003', sets: 4, reps: 8, weight: 50 }] },
    ],
    week: { 1: 'r-push', 3: 'r-pull', 5: 'r-push' },
    // The routine of TODAY is pinned, so the test does not depend on the weekday.
    dayPlan: { [todayISO()]: 'r-push' },
    bodyweight: [{ d: '2026-11-01', w: 81.4, t: 1 }],
    workouts: [
      { id: 'w1', d: '2026-11-02', name: 'Push', vol: 4820, entries: [] },
      { id: 'w2', d: '2026-11-04', name: 'Pull', vol: 5100, entries: [] },
    ],
    active: null,
    exWeights: {},
    customEx: [],
  }
}

function activeSession() {
  return {
    id: 'a1', d: todayISO(), start: 1, name: 'Push', routineId: 'r-push', cur: 0,
    entries: [
      { id: '0001', target: { sets: 3, reps: 10, weight: 40 }, sets: [{ w: 40, r: 10, done: true }, { w: 40, r: 9, done: true }, { w: 40, r: 8, done: false }] },
      { id: '0002', target: { sets: 2, reps: 12, weight: 0 }, sets: [{ w: 0, r: 12, done: false }] },
    ],
  }
}

// The stack lives in the module, so every test leaves it as it found it.
const pushed = []
const push = entry => { const id = pushCoachContext(entry); pushed.push(id); return id }

beforeEach(() => { store.S = baseState() })
afterEach(() => { while (pushed.length) popCoachContext(pushed.pop()) })

describe('the coach context stack', () => {
  it('has no context before anything registers one', () => {
    expect(currentCoachContext()).toBe(null)
    expect(buildCoachPayload()).toBe(null)
  })

  it('the entry on top wins — the exercise sheet over the list underneath', () => {
    push({ view: 'library', title: 'Exercises', lines: ['12 exercises visible'] })
    const sheet = push({ view: 'exercise', title: '3/4 sit-up', lines: ['Muscle group: waist'] })
    expect(currentCoachContext().view).toBe('exercise')
    expect(currentCoachContext().title).toBe('3/4 sit-up')
    // Closing the sheet brings the list back.
    popCoachContext(sheet)
    expect(currentCoachContext().view).toBe('library')
    expect(currentCoachContext().title).toBe('Exercises')
  })

  it('popping an unknown id is harmless', () => {
    expect(() => popCoachContext('not-a-context')).not.toThrow()
  })

  it('a provider is read when the context is read, not when it was pushed', () => {
    let value = 'first'
    push({ view: 'home', provider: () => ({ title: 'Home', lines: [value] }) })
    expect(buildCoachPayload().lines).toEqual(['first'])
    value = 'second'
    expect(buildCoachPayload().lines).toEqual(['second'])
  })

  it('a provider that throws costs the context, never the coach', () => {
    push({ view: 'home', provider: () => { throw new Error('boom') } })
    expect(buildCoachPayload()).toEqual({ view: 'home', title: '', lines: [] })
  })
})

describe('buildCoachPayload', () => {
  it('drops the empty lines', () => {
    push({ view: 'home', title: 'Home', lines: ['a', '', '   ', 'b'] })
    expect(buildCoachPayload().lines).toEqual(['a', 'b'])
  })

  it('keeps at most 40 lines', () => {
    const lines = Array.from({ length: 60 }, (_, i) => 'line ' + i)
    push({ view: 'home', title: 'Home', lines })
    const payload = buildCoachPayload()
    expect(payload.lines).toHaveLength(40)
    expect(payload.lines[0]).toBe('line 0')
  })

  it('cuts every line at 200 characters', () => {
    push({ view: 'home', title: 'Home', lines: ['x'.repeat(500)] })
    expect(buildCoachPayload().lines[0]).toHaveLength(200)
  })

  it('carries the view and the title along with the lines', () => {
    push({ view: 'exercise', title: '3/4 sit-up', lines: ['Muscle group: waist'] })
    expect(buildCoachPayload()).toEqual({ view: 'exercise', title: '3/4 sit-up', lines: ['Muscle group: waist'] })
  })
})

describe('the per-view builders', () => {
  it('home: the routine of the day, its exercises, the streak and the weight', () => {
    const out = VIEW_BUILDERS.home()
    expect(out.title).toBeTruthy()
    expect(out.lines.join(' | ')).toContain('Push')
    expect(out.lines.join(' | ')).toContain('3/4 sit-up')
  })

  it('plan: the routines and what each day of the week holds', () => {
    const out = VIEW_BUILDERS.plan()
    expect(out.title).toBeTruthy()
    expect(out.lines.join(' | ')).toContain('Push')
    expect(out.lines.join(' | ')).toContain('Pull')
  })

  it('library: how many exercises the catalogue holds', () => {
    const out = VIEW_BUILDERS.library()
    expect(out.title).toBeTruthy()
    expect(out.lines.length).toBeGreaterThan(0)
  })

  it('workout: the session in progress — its exercises and their sets', () => {
    store.S.active = activeSession()
    const out = VIEW_BUILDERS.workout()
    expect(out.title).toBeTruthy()
    expect(out.lines.join(' | ')).toContain('3/4 sit-up')
    expect(out.lines.join(' | ')).toContain('2')
  })

  it('workout: no session, no lines (and no crash)', () => {
    const out = VIEW_BUILDERS.workout()
    expect(out.title).toBeTruthy()
    expect(out.lines).toEqual([])
  })

  it('stats: the aggregates and the last sessions', () => {
    const out = VIEW_BUILDERS.stats()
    expect(out.title).toBeTruthy()
    expect(out.lines.length).toBeGreaterThan(1)
    expect(out.lines.join(' | ')).toContain('Pull')
  })

  it('history: the last sessions with their date and volume', () => {
    const out = VIEW_BUILDERS.history()
    expect(out.title).toBeTruthy()
    expect(out.lines.join(' | ')).toContain('Push')
    expect(out.lines.join(' | ')).toContain('Pull')
  })

  it('an empty state never throws — every builder answers with a context', () => {
    store.S = { unit: 'kg', routines: [], week: {}, dayPlan: {}, bodyweight: [], workouts: [], active: null, exWeights: {}, customEx: [] }
    for (const key of Object.keys(VIEW_BUILDERS)) {
      const out = VIEW_BUILDERS[key]()
      expect(out, key).toHaveProperty('title')
      expect(Array.isArray(out.lines), key).toBe(true)
    }
  })
})

describe('the library context (the filters live in the view)', () => {
  it('says what is filtered and how many exercises are visible', () => {
    const provider = libraryCoachContext({ q: 'bench', bp: 'chest', eq: 'barbell', visible: 7 })
    const out = provider()
    expect(out.title).toBeTruthy()
    expect(out.lines.join(' | ')).toContain('bench')
    expect(out.lines.join(' | ')).toContain('7')
  })

  it('leaves out the filters that are not set', () => {
    const out = libraryCoachContext({ q: '', bp: '', eq: '', visible: 3 })()
    expect(out.lines).toHaveLength(1)
  })
})

describe('the hook', () => {
  it('is exported for the views to register their screen', () => {
    expect(typeof useCoachContext).toBe('function')
  })
})
