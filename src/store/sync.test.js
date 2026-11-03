import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { decideSync, SYNC_DATA_PATH, unwrapBlob } from './sync.js'

// sync.js is pure (no browser globals), but the tests that exercise the real store below
// import useStore.js, which touches localStorage and document at module evaluation time.
// The stubs therefore have to exist BEFORE that import runs — plain top-level statements,
// not beforeAll (which runs after the test module itself has been evaluated).
const data = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    removeItem: k => { data.delete(k) },
    clear: () => { data.clear() },
  },
  configurable: true
})
Object.defineProperty(globalThis, 'document', {
  value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  configurable: true
})

const { useStore, DEF } = await import('./useStore.js')

const BASE = 'https://api.djlabs.cl'
const KEY = 'gym_state_v1'
const DIRTY = 'gym_dirty'

// Minimal Response stand-in: phttp only reads .ok, .status and .json().
const res = (status, body) => ({
  ok: status < 400 && status !== 401,
  status,
  json: () => Promise.resolve(body)
})

// 'network' means the fetch itself rejects. Records URL/opts of every call.
function mockFetch(responses) {
  const seen = []
  const impl = vi.fn((url, opts) => {
    seen.push({ url, opts: opts || {} })
    const i = seen.length - 1
    if (responses[i] === 'network') return Promise.reject(new Error('network down'))
    return Promise.resolve(responses[i])
  })
  return { impl, seen }
}

// A state blob shaped like a real profile.
const blob = (ts, wins, extra = {}) => ({
  unit: 'kg', lang: 'en', week: {}, bodyweight: [], routines: [], customEx: [],
  workouts: wins, _ts: ts, ...extra
})
const localOf = (ts, wins, extra = {}) => Object.assign(blob(ts, wins), extra)
const setState = S => useStore.setState({ S })
const user = () => useStore.setState({ user: { id: 'u1' } })
const asUser = json => JSON.parse(localStorage.getItem(KEY))

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, balance: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decideSync — pull decision (pure)', () => {
  const localEmpty = localOf(0, [])
  const localData = localOf(100, [{ id: 'w1' }])

  it('adopts the server blob when the local profile is empty', () => {
    const d = decideSync(localEmpty, { state: localOf(50, [{ id: 's1' }]) }, false)
    expect(d).toEqual({ action: 'adopt', state: { ...localOf(50, [{ id: 's1' }]) } })
  })

  it('adopts even when dirty — an empty local copy has nothing to lose', () => {
    const remote = { state: localOf(50, [{ id: 's1' }]) }
    expect(decideSync(localEmpty, remote, true).action).toBe('adopt')
  })

  it('server newer wins over local data (last-write-wins by _ts)', () => {
    expect(decideSync(localData, { state: localOf(200, [{ id: 's1' }]) }, false).action).toBe('adopt')
  })

  it('a tie adopts the server copy (>= is the legacy rule)', () => {
    expect(decideSync(localData, { state: localOf(100, [{ id: 's1' }]) }, false).action).toBe('adopt')
  })

  it('local data newer than the server wins → push', () => {
    expect(decideSync(localData, { state: localOf(50, [{ id: 's1' }]) }, false).action).toBe('push')
  })

  it('dirty overrides a newer server blob → push (unsynced edits are never clobbered)', () => {
    expect(decideSync(localData, { state: localOf(200, [{ id: 's1' }]) }, true).action).toBe('push')
  })

  it('no server copy + local data → push', () => {
    expect(decideSync(localData, null, false).action).toBe('push')
  })

  it('no server copy + empty local → nothing to do', () => {
    expect(decideSync(localEmpty, null, false)).toEqual({ action: 'none' })
  })

  it('local data is fed straight: the dirty flag and local data force a push', () => {
    expect(decideSync(localData, localOf(200, [{ id: 's1' }]), true).action).toBe('push')
  })
})

describe('unwrapBlob — response envelope', () => {
  it('unwraps the documented { state } envelope', () => {
    expect(unwrapBlob({ state: { _ts: 1, workouts: [] } })).toEqual({ _ts: 1, workouts: [] })
  })

  it('accepts the bare blob at top level (defensive, per document-store contract)', () => {
    expect(unwrapBlob({ _ts: 7, workouts: [] })).toEqual({ _ts: 7, workouts: [] })
    expect(unwrapBlob({ workouts: [] })).toEqual({ workouts: [] })
  })

  it('rejects shapes that are clearly not a state document', () => {
    expect(unwrapBlob(null)).toBe(null)
    expect(unwrapBlob([1, 2])).toBe(null)
    expect(unwrapBlob({ ok: 1 })).toBe(null)
    expect(unwrapBlob({ state: null })).toBe(null)
    expect(unwrapBlob({ state: [1] })).toBe(null)
  })
})

describe('pushState — platform document store', () => {
  it('PUTs the full blob to /opengym/data with the heart slug and clears the dirty flag', async () => {
    const m = mockFetch([res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(10, [{ id: 'w1' }]))
    user()
    localStorage.setItem(DIRTY, '1')
    await useStore.getState().pushState()
    expect(m.impl).toHaveBeenCalledTimes(1)
    expect(m.seen[0].url).toBe(BASE + SYNC_DATA_PATH)
    expect(m.seen[0].opts.method).toBe('PUT')
    expect(m.seen[0].opts.credentials).toBe('include')
    const body = JSON.parse(m.seen[0].opts.body)
    expect(body.heart).toBe('metalgym88')
    expect(body.state.workouts).toEqual([{ id: 'w1' }])
    expect(localStorage.getItem(DIRTY)).toBe(null)
  })

  for (const [label, failure] of [['404', res(404, { error: 'no module' })], ['501', res(501, {})], ['offline', 'network']]) {
    it(`on ${label} → keeps the local state, keeps/re-marks the dirty flag, never throws`, async () => {
      const m = mockFetch([failure])
      vi.stubGlobal('fetch', m.impl)
      setState(localOf(10, [{ id: 'w1' }]))
      user()
      const before = JSON.stringify(useStore.getState().S)
      await expect(useStore.getState().pushState()).resolves.toBeUndefined()
      expect(localStorage.getItem(DIRTY)).toBe('1')
      expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
      expect(JSON.stringify(useStore.getState().S)).toBe(before)
      // Even the localStorage mirror is untouched by a failed push.
      expect(localStorage.getItem(KEY)).toBe(null)
    })
  }
})

describe('pullState — platform document store', () => {
  it('GETs /opengym/data?heart=metalgym88', async () => {
    const m = mockFetch([res(200, { state: localOf(5, [{ id: 's1' }]) })])
    vi.stubGlobal('fetch', m.impl)
    setState({ ...JSON.parse(JSON.stringify(DEF)), _ts: 1 })
    await useStore.getState().pullState()
    expect(m.seen[0].url).toBe(BASE + '/opengym/data?heart=metalgym88')
    expect(m.seen[0].opts.method).toBeUndefined()
    expect(m.seen[0].opts.credentials).toBe('include')
  })

  it('adopt on empty local: writes the blob (and persists it to localStorage)', async () => {
    const m = mockFetch([res(200, { state: localOf(5, [{ id: 's1' }]) })])
    vi.stubGlobal('fetch', m.impl)
    await useStore.getState().pullState()
    expect(useStore.getState().S.workouts).toEqual([{ id: 's1' }])
    expect(asUser(KEY).workouts).toEqual([{ id: 's1' }])
    // Only the GET happened — the merge must never schedule a PUT of its own.
    expect(m.impl).toHaveBeenCalledTimes(1)
  })

  it('keeps the local active workout when adopting', async () => {
    const m = mockFetch([res(200, { state: localOf(500, [{ id: 's1' }], { active: { id: 'srv' } }) })])
    vi.stubGlobal('fetch', m.impl)
    setState({ ...localOf(5, [], { active: { id: 'mine', exercise: '0025' } }) })
    localStorage.setItem(DIRTY, '1')  // dirty + empty local still adopts (nothing to lose)
    await useStore.getState().pullState()
    const S = useStore.getState().S
    expect(S.active).toEqual({ id: 'mine', exercise: '0025' })
    expect(S.workouts).toEqual([{ id: 's1' }])
  })

  it('local newer and clean → pushes the local copy instead of adopting', async () => {
    const m = mockFetch([res(200, { state: localOf(1, [{ id: 'old-srv' }]) }), res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(999, [{ id: 'w1' }]))
    user()
    await useStore.getState().pullState()
    expect(m.impl).toHaveBeenCalledTimes(2)
    expect(m.seen[1].opts.method).toBe('PUT')
    expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
    expect(localStorage.getItem(DIRTY)).toBe(null)   // successful push clears it
  })

  it('dirty forces a push of the unsynced local copy over a newer server blob', async () => {
    const m = mockFetch([res(200, { state: localOf(500, [{ id: 'new-srv' }]) }), res(200, { ok: 1 })])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(10, [{ id: 'w1' }]))
    user()
    localStorage.setItem(DIRTY, '1')
    await useStore.getState().pullState()
    expect(m.seen[1].opts.method).toBe('PUT')
    expect(JSON.parse(m.seen[1].opts.body).state.workouts).toEqual([{ id: 'w1' }])
    expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
  })

  it('on 404 (module not applied yet) → local copy untouched, no error surfaced', async () => {
    const m = mockFetch([res(404, {})])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(10, [{ id: 'w1' }]))
    user()
    await expect(useStore.getState().pullState()).resolves.toBeUndefined()
    expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
    expect(m.impl).toHaveBeenCalledTimes(1)   // no fallback PUT from the catch path
  })

  it('on offline pull → local copy untouched, re-marked dirty only via an eventual push', async () => {
    const m = mockFetch(['network'])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(10, [{ id: 'w1' }]))
    user()
    localStorage.setItem(DIRTY, '1')
    await expect(useStore.getState().pullState()).resolves.toBeUndefined()
    expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])
    expect(localStorage.getItem(DIRTY)).toBe('1')
  })

  it('on 401 after the refresh attempt → session flips via onAuthExpired, data survives', async () => {
    const m = mockFetch([res(401, {}), res(401, { error: 'no session' })])
    vi.stubGlobal('fetch', m.impl)
    setState(localOf(10, [{ id: 'w1' }]))
    user()
    await expect(useStore.getState().pullState()).resolves.toBeUndefined()
    expect(useStore.getState().user).toBe(null)                       // signed out…
    expect(useStore.getState().S.workouts).toEqual([{ id: 'w1' }])    // …but data kept
    expect(useStore.getState().S._ts).toBe(10)
  })
})
