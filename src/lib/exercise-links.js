// The coach's answer, made of two things: the bold the model wrote, and the
// links to the exercises it named.
//
// The owner asked for exactly this — "al coach le faltó indicarle el link en el
// mismo chat ya que el ejercicio está disponible": when the coach names an
// exercise the app HAS, the chat shows a link to its sheet (the picture, the
// tags, "Añadir a mi plan"), instead of leaving the reader with a name in a
// wall of text.
//
// SAFETY FIRST. A link to the WRONG exercise is worse than no link at all — the
// reader lands on a movement they never asked for and stops trusting the
// coach — so a name is only linked when ALL of this holds:
//
//   1. it resolves to exactly ONE exercise: an ambiguous name is never linked;
//   2. it is SPECIFIC enough to be recognised as an exercise in a sentence
//      (see isSpecific below);
//   3. it appears in the text as WHOLE WORDS, never inside a longer word.
//
// Nothing here renders anything: the result is plain data ({ type, text, … })
// and the chat builds it as React nodes. HTML is never injected.
import { EXDB } from './exercises.js'

// The library route, and the exercise's sheet inside it. The app runs on a
// HashRouter, so the route lives INSIDE the hash: '#/library?ex=0001'.
export const LIBRARY_ROUTE = '/library'

// The link of an exercise: the library with the exercise in the query, so the
// sheet opens on top of the list when the route is read.
export const exHref = id => `#${LIBRARY_ROUTE}?ex=${encodeURIComponent(id)}`

/* -------------------------------------------------------------- the names -- */

const MARKS = /[\u0300-\u036f]/g
const WORD_CHAR = /[\p{L}\p{N}]/u
const NOT_WORD = /[^\p{L}\p{N}]+/gu
const TRAILING_PUNCT = /[^\p{L}\p{N}\s]+$/u

// The name as the matcher sees it: lower case, without diacritics, with every
// run of punctuation or spaces collapsed to ONE space. The catalogue names are
// already in Spanish (lib/exercises.js translates the dataset's English names),
// so "Abdominal 3/4", "abdominal 3-4" and "ABDOMINAL 3 / 4" are the same name.
export function normName(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(NOT_WORD, ' ')
    .trim()
}

// The punctuation a name ends with ("Abdominal (hands overhead)", "45°"). The
// matcher drops it to compare words, so a match is extended over it again when
// the original text carries it: the link reads like the catalogue, closing
// parenthesis and degree sign included.
const tailOf = name => {
  const m = String(name == null ? '' : name).trim().match(TRAILING_PUNCT)
  return m ? m[0] : ''
}

// Words of an ordinary sentence. A single-word exercise name that is also an
// ordinary word is never linked: the coach answers in sentences, and a
// sentence uses those words for their everyday meaning ("me duele el
// cuádriceps", "la dominada" — which in Spanish is not even about the gym).
const ORDINARY_WORDS = new Set([
  'abdominal', 'bandera', 'capullos', 'carrera', 'cuadriceps', 'dominada',
  'elevador', 'esfinge', 'flexion', 'hiperextension', 'oruga',
])

// A single-word name shorter than this is a word, not a name.
const MIN_SINGLE_WORD = 10

// Is this name SPECIFIC enough to be linked? Two rules, both conservative:
//
//   * two words or more → specific. A movement plus its equipment, its
//     variation or its position is a NAME: nobody writes "press arnold con
//     mancuernas" about anything but that exercise;
//   * one single word → only when it is long (MIN_SINGLE_WORD characters or
//     more) AND it is not an ordinary word.
//
// The single-word rule is what keeps prose clean: "abdominal" (9 characters)
// and "hiperextensión" (an ordinary gym word) stay plain text, while a made-up
// word of ten characters is a name only a catalogue has. Today every
// single-word name in the catalogue is either ordinary or shared by two
// exercises, so none of them is linked; the rule still documents the boundary
// for the next name that arrives.
export function isSpecific(key) {
  const words = String(key == null ? '' : key).split(' ').filter(Boolean)
  if (words.length === 0) return false
  if (words.length > 1) return true
  const w = words[0]
  return w.length >= MIN_SINGLE_WORD && !ORDINARY_WORDS.has(w)
}

// The names that MAY be linked: unique (one exercise each) and specific.
const LINKABLE = (() => {
  const byKey = new Map()
  for (const ex of EXDB) {
    const key = normName(ex.n)
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, { key, ids: new Set(), name: ex.n, tail: tailOf(ex.n) })
    }
    byKey.get(key).ids.add(ex.id)
  }
  const out = []
  for (const row of byKey.values()) {
    if (row.ids.size !== 1) continue       // ambiguous → never linked
    if (!isSpecific(row.key)) continue     // too ordinary → never linked
    out.push({ key: row.key, id: [...row.ids][0], tail: row.tail })
  }
  return out
})()

/* ------------------------------------------------------------- the matcher -- */

// The text as the matcher sees it: lower case, without diacritics, with every
// punctuation/space run collapsed to one space. `map[i]` is the index in the
// ORIGINAL text of the character that produced the i-th canonical character,
// so a match can be cut out of the original text untouched.
function normalizeText(text) {
  let norm = ''
  const map = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]
    const folded = raw.normalize('NFD').replace(MARKS, '').toLowerCase()
    const chars = Array.from(folded).filter(c => WORD_CHAR.test(c))
    if (!chars.length) {
      if (norm && !pendingSpace) {
        norm += ' '
        map.push(i)
        pendingSpace = true
      }
      continue
    }
    for (const c of chars) {
      norm += c
      map.push(i)
    }
    pendingSpace = false
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1)
    map.pop()
  }
  return { norm, map }
}

// Whole words only: "abdominal" inside "abdominales" is not the exercise.
function bounded(text, start, end) {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  if (before && WORD_CHAR.test(before)) return false
  if (after && WORD_CHAR.test(after)) return false
  return true
}

// The chat re-renders the same answer on every keystroke of the box below, so
// the segments are remembered per text.
const CACHE = new Map()
const CACHE_MAX = 40

// Splits the coach's answer into segments: plain text and links to the
// exercises the app has. The segments cover the WHOLE original text (concatenate
// them and you get the text back, character by character).
//
//   { type: 'text', text }
//   { type: 'link', text, id, href }
export function linkifyExercises(text) {
  const src = String(text == null ? '' : text)
  if (src === '') return []
  if (CACHE.has(src)) return CACHE.get(src)

  const { norm, map } = normalizeText(src)
  const hits = []
  for (const { key, id, tail } of LINKABLE) {
    let pos = norm.indexOf(key)
    while (pos !== -1) {
      const start = map[pos]
      let end = map[pos + key.length - 1] + 1
      // The name's trailing punctuation ("(", "°") was dropped to compare
      // words; put it back into the link when the text carries it.
      if (tail && src.startsWith(tail, end)) end += tail.length
      if (bounded(src, start, end)) hits.push({ start, end, id })
      pos = norm.indexOf(key, pos + 1)
    }
  }

  // The earliest match wins. When two names start at the same place, the
  // LONGER one wins ("flexión lateral en polea" over "flexión lateral"); a name
  // contained in another one always starts later, so the containing — longer —
  // name is the one picked.
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const picked = []
  let cursor = 0
  for (const h of hits) {
    if (h.start < cursor) continue          // overlaps an earlier match
    picked.push(h)
    cursor = h.end
  }

  const segs = []
  let at = 0
  for (const h of picked) {
    if (h.start > at) segs.push({ type: 'text', text: src.slice(at, h.start) })
    segs.push({ type: 'link', text: src.slice(h.start, h.end), id: h.id, href: exHref(h.id) })
    at = h.end
  }
  if (at < src.length) segs.push({ type: 'text', text: src.slice(at) })

  CACHE.set(src, segs)
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
  return segs
}

/* -------------------------------------------------------------- the bold -- */

// The only markdown the chat understands: **bold**. The model writes it, and
// the chat shows it as a <strong> — as a NODE, never as HTML.
//
// The text is split into runs ({ text, bold }). A marker that is never closed
// is text again, not a lost character: everything from the unpaired marker on
// stays PLAIN, because the model never finished telling us where the bold ends.
export function splitBold(text) {
  const src = String(text == null ? '' : text)
  const runs = []
  const marks = []          // the start index of every ** in the text
  const rx = /\*\*/g
  let m
  while ((m = rx.exec(src)) !== null) marks.push(m.index)
  let plainFrom = 0
  // The markers pair up (open, close, open, close…): an even one opens a bold
  // run and the odd one after it closes it.
  for (let i = 0; i + 1 < marks.length; i += 2) {
    const open = marks[i]
    const closeAt = marks[i + 1]
    if (open > plainFrom) runs.push({ text: src.slice(plainFrom, open), bold: false })
    runs.push({ text: src.slice(open + 2, closeAt), bold: true })
    plainFrom = closeAt + 2
  }
  // What is left — including any marker without a pair — is plain text.
  if (plainFrom < src.length) runs.push({ text: src.slice(plainFrom), bold: false })
  return runs
}
