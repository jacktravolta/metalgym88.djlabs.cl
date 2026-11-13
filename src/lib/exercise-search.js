import { allExercises } from './exercises.js'

// Shared exercise lookup for the library and the AI coach.
//
// The matching rules are the library's original rules, unchanged: the query and
// exercise names are case-insensitive, while the target-muscle and equipment
// fields are compared exactly as the catalogue stores them. Keeping that
// behaviour here means the coach and the visible library can never disagree
// about what a search returns.
//
// `accents: 'ignore'` is the ONE opt-in difference, and the library does not
// use it: half the catalogue's Spanish names carry an accent ("Elevación",
// "bíceps") and people type without one ("elevacion", "biceps"). The coach
// asks for the folded comparison; the library keeps the exact one.

// Case and accent folding, memoized per exercise: the folded copy is only
// built for the exercises a folded search actually looks at.
const FOLDED = new WeakMap()

function foldText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function foldedFields(ex) {
  let fields = FOLDED.get(ex)
  if (!fields) {
    fields = {
      n: foldText(ex.n),
      tg: foldText(ex.tg),
      eq: foldText(ex.eq),
      desc: foldText(ex.desc || ''),
    }
    FOLDED.set(ex, fields)
  }
  return fields
}

// searchExercises(state, query, { bp, limit, accents }) → the catalogue
// exercises that match, custom ones first (the library's order).
//   bp      — body part to keep ('' keeps every one)
//   limit   — how many to return (Infinity keeps every one)
//   accents — 'exact' (default, the library's behaviour) or 'ignore'
export function searchExercises(state, query, { bp = '', limit = Infinity, accents = 'exact' } = {}) {
  const raw = String(query || '').toLowerCase().trim()
  const ql = accents === 'ignore' ? foldText(raw) : raw
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Infinity
  if (max === 0) return []

  return allExercises(state || {})
    .filter(e => {
      const f = accents === 'ignore' ? foldedFields(e) : e
      return (!bp || e.bp === bp) && (!ql ||
        f.n.toLowerCase().includes(ql) ||
        f.tg.includes(ql) ||
        f.eq.includes(ql) ||
        (f.desc || '').toLowerCase().includes(ql))
    })
    .slice(0, max)
}
