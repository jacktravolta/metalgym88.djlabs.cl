import { EXDB as RAW_EXDB } from './exercises-data.js'
import { translateExerciseName } from './exercises-names.es.js'
import { t } from './i18n.js'

// The catalogue arrives with 1.324 names in English. The product is Spanish, so
// the name a person reads must be Spanish too — and the SAME name everywhere:
// the library, the exercise sheet, the routine, the synced document and the
// context the coach receives.
export const EXDB = RAW_EXDB.map(e => ({ ...e, n: translateExerciseName(e.n) }))
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// The readable name of an exercise, by id. The exercise dictionary lives ONLY in
// the client, so anything that leaves the device (the synced document, the AI
// assistant's context) must carry the name itself — an id alone means nothing to
// a reader that has never seen the catalogue.
export const exName = id => (EXIDX[id] && EXIDX[id].n) || String(id || '')

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...EXDB]

// The exercise media (~140 MB of pictures and animations) is NOT in this
// repository: it comes from the public dataset the catalogue comes from, and
// the default points at its CDN — so every build shows the pictures and the
// animations instead of a screen full of broken images. A build can point
// somewhere else (a local copy, your own CDN) with VITE_IMG_BASE / VITE_GIF_BASE.
const DATASET_CDN = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd'
const IMG_BASE = import.meta.env.VITE_IMG_BASE || DATASET_CDN + '/images/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || DATASET_CDN + '/videos/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
