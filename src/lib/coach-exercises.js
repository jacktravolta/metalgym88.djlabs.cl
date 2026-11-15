// The exercise catalogue, as an artifact for the AI coach.
//
// The catalogue (1.324 exercises, see lib/exercises-data.js) is already in the
// front and already searchable. This module is the bridge between what the
// person TYPED and the exercises that actually exist:
//
//   resolveExercises(question)  → the catalogue exercises that fit the question
//   buildExerciseArtifact(…)    → compact lines the coach request carries
//   exerciseCards(…)            → what the chat renders under the answer
//
// Two rules shape everything here:
//
//  1. The cards come from the CATALOGUE, never from the model's text. The
//     model cannot invent an exercise, and the front cannot show one the
//     catalogue does not have.
//  2. The artifact travels in the request's context.lines, which the platform
//     caps hard (200 characters per line, 1.200 in total), so it is small,
//     bounded and always complete — never a truncated URL.
import { EXDB, gifSrc, imgSrc } from './exercises.js'
import { searchExercises } from './exercise-search.js'
import { EXERCISE_LABELS } from './exercises-vocab.es.js'

// The platform's own caps for the coach context (see the backend's Assistant):
// at most four exercises, one line each, under 200 characters per line.
export const MAX_COACH_ARTIFACT_EXERCISES = 4
export const MAX_COACH_ARTIFACT_LINE_CHARS = 200
export const MAX_COACH_CONTEXT_CHARS = 1200

// Where a card goes: the library, filtered by the exercise name. The library
// reads that query (see views/Library.jsx), so the destination always shows
// the exercise the card is about.
export const LIBRARY_PATH = '/library'

const CATALOG = new Map(EXDB.map(ex => [ex.id, ex]))
const CATALOG_ORDER = new Map(EXDB.map((ex, index) => [ex.id, index]))

/* ============================== text ============================== */

// Case and accents never change what a person meant: "biceps" and "bíceps"
// are the same muscle, and phones drop accents on their own.
const fold = value => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const words = value => fold(value).split(' ').filter(Boolean)

// The folded words of every exercise, built once: the resolver walks the
// catalogue for every phrase of the question.
const EX_WORDS = new WeakMap()
function exerciseWords(ex) {
  let w = EX_WORDS.get(ex)
  if (!w) {
    w = { name: words(ex.n), bp: words(ex.bp), tg: words(ex.tg), eq: words(ex.eq) }
    EX_WORDS.set(ex, w)
  }
  return w
}

// True when the phrase's words sit, in order and WHOLE, inside the text.
// "tal" is not inside "toques de talón": a plain substring match would say it
// is, and that is how a greeting ends up carrying four random exercises.
function hasWords(textWords, phraseWords) {
  if (!phraseWords.length || phraseWords.length > textWords.length) return false
  for (let i = 0; i + phraseWords.length <= textWords.length; i++) {
    let fits = true
    for (let j = 0; j < phraseWords.length; j++) {
      if (textWords[i + j] !== phraseWords[j]) { fits = false; break }
    }
    if (fits) return true
  }
  return false
}

/* ========================= the screen vocabulary ========================= */

// Every catalogue value, with the exercises that carry it (body part, target
// muscle, equipment and the secondary muscles).
const BY_VALUE = new Map()
EXDB.forEach(ex => {
  const values = new Set([ex.bp, ex.tg, ex.eq, ...(ex.sm || [])])
  values.forEach(value => {
    if (!value) return
    const list = BY_VALUE.get(value) || []
    list.push(ex)
    BY_VALUE.set(value, list)
  })
})

// The labels the person READS on screen ("pecho", "bíceps", "barra") point at
// the catalogue's own values ("chest", "biceps", "barbell"). Both spellings
// are indexed, so the coach answers the question the screen taught the person
// to ask — and the singular too, because people write "hombro" for "hombros".
const ALIAS = new Map()
const singular = label => {
  const s = String(label || '')
  return s.length > 4 && s.endsWith('s') ? s.slice(0, -1) : s
}
const addAlias = (label, value) => {
  const key = fold(label)
  if (!key) return
  const list = ALIAS.get(key) || []
  if (!list.includes(value)) list.push(value)
  ALIAS.set(key, list)
}
Object.entries(EXERCISE_LABELS).forEach(([value, label]) => {
  addAlias(value, value)
  addAlias(label, value)
  addAlias(singular(label), value)
})

// The folded words of each label, built once.
const LABEL_WORDS = new Map()
function labelWordsOf(value) {
  let w = LABEL_WORDS.get(value)
  if (!w) {
    w = words(EXERCISE_LABELS[value] || value)
    LABEL_WORDS.set(value, w)
  }
  return w
}

/* ============================ the question ============================ */

// Framing words are not exercise terms. They are removed only from the EDGES
// of a candidate phrase, so a useful phrase such as "press de banca" keeps
// its interior connector and still matches the catalogue name.
const QUESTION_FILLER = new Set([
  'a', 'al', 'algo', 'alguno', 'alguna', 'algunas', 'algunos', 'an', 'and',
  'como', 'con', 'cual', 'cuales', 'de', 'del',
  'dame', 'deberia', 'do', 'ejercicio', 'ejercicios', 'el', 'en',
  'exercise', 'exercises', 'for', 'haz', 'hazme', 'how', 'i', 'la', 'las',
  'lo', 'los', 'me', 'mi', 'mis', 'my', 'need', 'necesito', 'of', 'or',
  'para', 'please', 'por', 'puedo', 'quiero', 'que', 'recomienda',
  'recomiendame', 'routine', 'rutina', 'search', 'show',
  'sin', 'some', 'te', 'the', 'to', 'tu', 'tus', 'un', 'una', 'unas', 'unos',
  'want', 'workout', 'with', 'without', 'work',
])

// The phrases worth looking up: the meaningful word sequences of the
// question, longest first. "press de banca" and "banca" are both worth a
// lookup; "de" alone is not.
function phraseCandidates(tokens) {
  const candidates = []
  const seen = new Set()
  const maxLength = Math.min(6, tokens.length)

  for (let length = maxLength; length >= 1; length--) {
    for (let start = 0; start + length <= tokens.length; start++) {
      const first = tokens[start]
      const last = tokens[start + length - 1]
      if (QUESTION_FILLER.has(first) || QUESTION_FILLER.has(last)) continue

      const phrase = tokens.slice(start, start + length).join(' ')
      if (seen.has(phrase)) continue
      seen.add(phrase)
      candidates.push({ phrase, length, chars: phrase.length, start })
    }
  }

  return candidates
}

function boundedLimit(limit) {
  const requested = Number.isFinite(limit) ? Math.trunc(limit) : MAX_COACH_ARTIFACT_EXERCISES
  return Math.max(0, Math.min(MAX_COACH_ARTIFACT_EXERCISES, requested))
}

// The best score wins. A name match beats a vocabulary match ("Press de
// banca" over every exercise of the "espalda" group), a longer phrase beats
// a shorter one, and among name matches the shorter, more canonical name
// comes first ("Press de banca con barra" before "Press de banca declinado…").
// A vocabulary match has no such hint, so it follows the catalogue's order.
function isBetterScore(next, previous) {
  if (!previous) return true
  if (next.nameHit !== previous.nameHit) return next.nameHit > previous.nameHit
  if (next.aliasHit !== previous.aliasHit) return next.aliasHit > previous.aliasHit
  if (next.nameMentions !== previous.nameMentions) return next.nameMentions > previous.nameMentions
  if (next.length !== previous.length) return next.length > previous.length
  if (next.chars !== previous.chars) return next.chars > previous.chars
  if (next.nameHit && previous.nameHit && next.nameLen !== previous.nameLen) return next.nameLen < previous.nameLen
  if (next.start !== previous.start) return next.start < previous.start
  return next.order < previous.order
}

/**
 * Resolves the catalogue exercises that fit the question the person wrote.
 *
 * The question is read as meaningful word sequences, looked up in the same
 * search the library uses (accent-insensitive: people type "biceps" for
 * "bíceps"), and completed with the screen's own vocabulary, so "el abdomen"
 * finds the group the screen calls "abdomen".
 *
 * The result is bounded, holds catalogue exercises only, and is empty when
 * the question names nothing the catalogue has.
 */
export function resolveExercises(question, { state = {}, limit = MAX_COACH_ARTIFACT_EXERCISES } = {}) {
  const max = boundedLimit(limit)
  if (max === 0) return []

  const tokens = fold(question).split(' ').filter(Boolean)
  if (!tokens.length) return []

  const scored = new Map()
  const keep = (ex, score) => {
    const previous = scored.get(ex.id)
    if (isBetterScore(score, previous)) scored.set(ex.id, score)
  }

  for (const candidate of phraseCandidates(tokens)) {
    const phraseWords = candidate.phrase.split(' ')

    // 1) the library's own search, with the one difference that matters to a
    //    person typing on a phone: an accent typed or omitted is the same word.
    const matches = searchExercises(state, candidate.phrase, { accents: 'ignore' })
    for (const found of matches) {
      const ex = CATALOG.get(found.id)
      if (!ex) continue
      const w = exerciseWords(ex)
      const nameHit = hasWords(w.name, phraseWords)
      const fieldHit = !nameHit && [w.bp, w.tg, w.eq].some(field => hasWords(field, phraseWords))
      if (!nameHit && !fieldHit) continue
      keep(ex, {
        ex,
        nameHit: nameHit ? 1 : 0,
        aliasHit: 0,
        nameMentions: 0,
        nameLen: w.name.length,
        ...candidate,
        order: CATALOG_ORDER.get(ex.id) || 0,
      })
    }

    // 2) the screen's vocabulary: "abdomen" is the label of the catalogue's
    //    "waist", and no substring of the catalogue carries it.
    const values = ALIAS.get(candidate.phrase)
    if (!values) continue
    for (const value of values) {
      const labelWords = labelWordsOf(value)
      for (const ex of BY_VALUE.get(value) || []) {
        const nameWords = exerciseWords(ex).name
        keep(ex, {
          ex,
          nameHit: 0,
          aliasHit: 1,
          nameMentions: hasWords(nameWords, labelWords) ? 1 : 0,
          nameLen: nameWords.length,
          ...candidate,
          order: CATALOG_ORDER.get(ex.id) || 0,
        })
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => (isBetterScore(a, b) ? -1 : 1))
    .slice(0, max)
    .map(item => item.ex)
}

/* ============================== the artifact ============================== */

const cleanField = value => String(value || '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim()

// The muscle group the coach reads: the same label the screen shows.
function muscleLabel(ex) {
  return cleanField(EXERCISE_LABELS[ex.tg] || EXERCISE_LABELS[ex.bp] || ex.tg || ex.bp).slice(0, 24)
}

function artifactLine(ex) {
  const id = cleanField(ex.id)
  const name = cleanField(ex.n)
  const muscle = muscleLabel(ex)
  const image = imgSrc(ex)
  if (!id || !name || !muscle || !image) return null

  // The backend accepts at most 200 characters per context line. The image URL
  // is kept whole; the readable fields give way around it, so the line stays
  // valid instead of ending in a broken URL.
  const fixedLength = id.length + muscle.length + image.length + 3
  const nameLimit = MAX_COACH_ARTIFACT_LINE_CHARS - 1 - fixedLength
  if (nameLimit < 1) return null

  const line = `${id}|${name.slice(0, nameLimit)}|${muscle}|${image}`
  return line.length < MAX_COACH_ARTIFACT_LINE_CHARS ? line : null
}

/**
 * The compact lines the coach request carries: id, name, muscle group and
 * image URL, one exercise per line. At most four lines, each under the
 * backend's 200-character line limit.
 */
export function buildExerciseArtifact(matches) {
  const list = Array.isArray(matches) ? matches : []
  const seen = new Set()
  const lines = []

  for (const match of list) {
    if (!match || seen.has(match.id)) continue
    const ex = CATALOG.get(match.id)
    if (!ex) continue

    const line = artifactLine(ex)
    if (!line) continue
    seen.add(ex.id)
    lines.push(line)
    if (lines.length >= MAX_COACH_ARTIFACT_EXERCISES) break
  }

  return lines
}

/* ================================ the cards ================================ */

/**
 * What the chat renders under the answer: the exercise ANIMATION (and the still
 * picture as its fallback), its name and a link that really works (the library,
 * filtered by that exact name).
 */
export function exerciseCards(matches) {
  const list = Array.isArray(matches) ? matches : []
  const seen = new Set()
  const cards = []

  for (const match of list) {
    if (!match || seen.has(match.id)) continue
    const ex = CATALOG.get(match.id)
    if (!ex || !ex.img) continue

    seen.add(ex.id)
    cards.push({
      id: ex.id,
      name: ex.n,
      imageUrl: imgSrc(ex),
      // The animation is what the person actually asked about ("how do I do
      // this?"). The still picture stays as the fallback for an exercise the
      // catalogue has no animation for.
      gifUrl: ex.gif ? gifSrc(ex) : null,
      link: `${LIBRARY_PATH}?q=${encodeURIComponent(ex.n)}`,
    })
    if (cards.length >= MAX_COACH_ARTIFACT_EXERCISES) break
  }

  return cards
}
