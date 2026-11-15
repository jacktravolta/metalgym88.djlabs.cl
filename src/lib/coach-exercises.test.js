import { describe, it, expect } from 'vitest'
import {
  resolveExercises,
  buildExerciseArtifact,
  exerciseCards,
  LIBRARY_PATH,
  MAX_COACH_ARTIFACT_EXERCISES,
  MAX_COACH_ARTIFACT_LINE_CHARS,
  MAX_COACH_CONTEXT_CHARS,
} from './coach-exercises.js'
import { EXDB, EXIDX, gifSrc, imgSrc } from './exercises.js'
import { EXERCISE_LABELS } from './exercises-vocab.es.js'

const state = { customEx: [] }
const catalogIds = new Set(EXDB.map(ex => ex.id))

describe('resolveExercises', () => {
  it('resolves only real catalogue exercises', () => {
    const matches = resolveExercises('Abdominal 3/4', { state })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every(ex => catalogIds.has(ex.id) && EXIDX[ex.id])).toBe(true)
  })

  it('returns nothing when the question has no catalogue match', () => {
    expect(resolveExercises('xyzabc-no-exercise-here', { state })).toEqual([])
  })

  it('a greeting is not a catalogue match — no cards, no artifact', () => {
    expect(resolveExercises('hola, que tal estas?', { state })).toEqual([])
    expect(resolveExercises('gracias!', { state })).toEqual([])
  })

  it('is bounded to the compact artifact size', () => {
    const matches = resolveExercises('press de banca', { state, limit: 50 })
    expect(matches.length).toBeLessThanOrEqual(MAX_COACH_ARTIFACT_EXERCISES)
  })

  it('finds the exercise the person named', () => {
    const matches = resolveExercises('quiero hacer press de banca', { state })
    expect(matches.map(ex => ex.n.toLowerCase())).toContain('press de banca con barra')
  })

  it('understands the word without the accent the screen writes', () => {
    const matches = resolveExercises('curl de biceps', { state })
    expect(matches.some(ex => ex.n.toLowerCase().includes('bíceps'))).toBe(true)
  })

  it('understands the muscle group the screen calls "abdomen"', () => {
    const matches = resolveExercises('quiero entrenar el abdomen', { state })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every(ex => ex.bp === 'waist' || ex.tg === 'abs')).toBe(true)
  })

  it('a request for a picture without naming an exercise still finds the catalogue', () => {
    const matches = resolveExercises('puedes mostrarme cualquier foto del catálogo', { state })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThanOrEqual(MAX_COACH_ARTIFACT_EXERCISES)
    expect(matches.every(ex => catalogIds.has(ex.id))).toBe(true)
  })

  it('the person\'s own plan comes first when they ask to see the catalogue', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const planned = { customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [{ id: ex.id }] }] }
    const matches = resolveExercises('muéstrame una foto del catálogo', { state: planned })
    expect(matches.map(item => item.id)).toContain(ex.id)
  })

  it('a question that is not about seeing an exercise stays empty', () => {
    expect(resolveExercises('hola, que tal estas?', { state })).toEqual([])
    expect(resolveExercises('gracias!', { state })).toEqual([])
  })

  it('a match is a whole word: "tal" is not inside "toques de talón"', () => {
    expect(resolveExercises('tal', { state })).toEqual([])
  })
})

describe('buildExerciseArtifact', () => {
  it('keeps every exercise and context line inside the backend limits', () => {
    const matches = resolveExercises('press de banca', { state })
    const lines = buildExerciseArtifact(matches)

    expect(lines.length).toBeLessThanOrEqual(MAX_COACH_ARTIFACT_EXERCISES)
    expect(lines.every(line => line.length < MAX_COACH_ARTIFACT_LINE_CHARS)).toBe(true)
    expect(lines.join('').length).toBeLessThan(MAX_COACH_CONTEXT_CHARS)
  })

  it('holds for every exercise of the catalogue, not only the lucky ones', () => {
    const lines = buildExerciseArtifact(EXDB)
    expect(lines.length).toBe(MAX_COACH_ARTIFACT_EXERCISES)
    expect(lines.every(line => line.length < MAX_COACH_ARTIFACT_LINE_CHARS)).toBe(true)
  })

  it('includes the exercise name, the muscle group and the animation URL', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const [line] = buildExerciseArtifact([ex])

    expect(line).toContain(ex.n)
    expect(line).toContain(EXERCISE_LABELS[ex.tg] || EXERCISE_LABELS[ex.bp])
    expect(line).toContain(gifSrc(ex))
  })

  it('tells the model that an animation is attached, so it does not refuse', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const [line] = buildExerciseArtifact([ex])

    expect(line).toContain('catálogo:')
    expect(line).toContain('animación')
  })

  it('never ends a line in a broken URL', () => {
    buildExerciseArtifact(EXDB).forEach(line => {
      const url = line.slice(line.lastIndexOf('https://') >= 0 ? line.lastIndexOf('https://') : line.lastIndexOf('http://'))
      expect(url.startsWith('http')).toBe(true)
      expect(url.endsWith('.gif') || url.endsWith('.jpg')).toBe(true)
    })
  })

  it('builds no artifact when nothing matched', () => {
    expect(buildExerciseArtifact([])).toEqual([])
  })

  it('ignores anything the catalogue does not have', () => {
    expect(buildExerciseArtifact([{ id: 'not-a-real-id', n: 'Inventado' }])).toEqual([])
  })
})

describe('exerciseCards', () => {
  it('returns catalogue-backed card data with a working library link', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const [card] = exerciseCards([ex])

    expect(card).toEqual({
      id: ex.id,
      name: ex.n,
      imageUrl: imgSrc(ex),
      gifUrl: gifSrc(ex),
      link: `${LIBRARY_PATH}?q=${encodeURIComponent(ex.n)}`,
    })
  })

  it('carries the exercise animation as an absolute URL', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const [card] = exerciseCards([ex])

    expect(card.gifUrl).toBe(gifSrc(ex))
    expect(card.gifUrl.startsWith('http://') || card.gifUrl.startsWith('https://')).toBe(true)
    expect(card.gifUrl.endsWith('.gif')).toBe(true)
  })

  it('the animation is there for every catalogue exercise, not only the lucky ones', () => {
    const cards = exerciseCards(EXDB)
    expect(cards.length).toBe(MAX_COACH_ARTIFACT_EXERCISES)
    expect(cards.every(card => card.gifUrl && /^https?:\/\//.test(card.gifUrl))).toBe(true)
  })

  it('the link points at the library with the exercise name as the search', () => {
    const [card] = exerciseCards(resolveExercises('press de banca', { state }))
    expect(card.link.startsWith(LIBRARY_PATH + '?q=')).toBe(true)
    expect(decodeURIComponent(card.link.split('?q=')[1])).toBe(card.name)
  })

  it('builds no cards when nothing matched', () => {
    expect(exerciseCards([])).toEqual([])
  })
})
