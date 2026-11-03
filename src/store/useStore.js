import { create } from 'zustand'
import { me as platformMe, logout as platformLogout, onAuthExpired } from '../lib/platform/auth.js'
import { withHeart, withHeartQuery } from '../lib/platform/config.js'
import { phttp } from '../lib/platform/http.js'
import { decideSync, SYNC_DATA_PATH, hasData } from './sync.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'

const KEY = 'gym_state_v1'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  // If the platform's silent refresh hits a dead refresh cookie mid-session, the session is
  // over on this device — flip to the signed-out state so the gate UI shows again. Guest and
  // demo builds never call the platform, so the listener stays dormant there.
  onAuthExpired(() => { get().setUser(null); set({ balance: null }) })

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    balance: null,   // platform credits — refreshed at boot and on every credit-bearing call
    ready: false,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    // Mirror the state into the platform document store (PUT /opengym/data — backend
    // module ships in T6). localStorage stays the source of truth; this is a copy.
    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try {
        await phttp(SYNC_DATA_PATH, { method: 'PUT', body: JSON.stringify(withHeart({ state: { ...get().S } })) })
        localStorage.removeItem('gym_dirty')
      } catch (e) {
        // Silent on purpose, deliberately pre-T6 inclusive: until the owner applies the
        // backend module (T6), /opengym/data legitimately answers 404/501 on the live
        // platform, and offline there is nothing to sync against at all (offline-first =
        // full app minus AI). Neither state is an error for the user: the local copy is
        // kept as-is, the dirty flag survives so the next successful push reconciles the
        // mirror, and this function never throws. A 401 that survives the refresh attempt
        // has already flipped the session via onAuthExpired — again without touching the
        // data. Nothing is logged here (the body would carry legal/personal content).
        localStorage.setItem('gym_dirty', '1')
      }
    },
    async pullState() {
      try {
        const data = await phttp(withHeartQuery(SYNC_DATA_PATH), {})
        // Decision lifted into the pure decideSync helper (sync.js) so the merge
        // semantics are unit-testable: _ts last-write-wins, empty-local adopt, dirty
        // override. It also unwraps the blob envelope — `{ state: <blob> }` or the bare
        // blob at top level are both accepted.
        const { action, state } = decideSync(get().S, data, localStorage.getItem('gym_dirty') === '1')
        if (action === 'adopt') {
          // An active workout on this device outranks whatever the mirror says — same
          // rule the mobile mirror merge uses.
          const active = get().S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          persist(next, false)   // push=false: a pull-merge must never schedule a PUT itself
        } else if (action === 'push') {
          await get().pushState()
        }
      } catch (e) {
        // Same contract as pushState's catch: 404/501 (module not applied yet) and offline
        // are expected, not errors — keep the local copy, keep gym_dirty, keep the app
        // usable; a dead session is already handled by the onAuthExpired listener.
      }
    },

    async signOut() {
      try { await get().pushState(); await platformLogout() } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the legacy self-hosted server had a session-version bump that
    // reached every device. The platform exposes a single logout that ends the session at
    // hand, so this is the same call — still NOT swallowed: if it fails, wiping this device's
    // copy would look signed-out while the session is actually still alive elsewhere.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await platformLogout()
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Platform auth: the refresh cookie decides who we are. On success, pull the state
      // blob from the platform document store (GET /opengym/data) exactly as before; a
      // 401 means the refresh cookie is gone, so it's a plain signed-out device.
      try {
        const { user, balance } = await platformMe()
        get().setUser(user)
        set({ balance: balance ?? null })
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) { get().setUser(null); set({ balance: null }) }
      }
      set({ ready: true })
    }
  }
})

export { hasData }
