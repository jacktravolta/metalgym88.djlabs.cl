import { describe, it, expect } from 'vitest'
import { EXERCISE_LABELS } from './exercises-vocab.es.js'
import es from '../locales/es.js'
import { EXDB } from './exercises.js'

// The vocabulary is the bridge between what the screen says and what the
// catalogue stores. It has to cover EVERY value the catalogue has, and the
// Spanish locale has to show the same words: one muscle, one name, everywhere.
describe('the catalogue vocabulary in Spanish', () => {
  const values = new Set()
  EXDB.forEach(ex => {
    if (ex.bp) values.add(ex.bp)
    if (ex.tg) values.add(ex.tg)
    if (ex.eq) values.add(ex.eq)
    ;(ex.sm || []).forEach(m => values.add(m))
  })

  it('names every body part, muscle and piece of equipment the catalogue has', () => {
    const missing = [...values].filter(v => !(v in EXERCISE_LABELS)).sort()
    expect(missing, `${missing.length} catalogue value(s) without a Spanish label`).toEqual([])
  })

  it('holds no label the catalogue does not have', () => {
    const extra = Object.keys(EXERCISE_LABELS).filter(k => !values.has(k)).sort()
    expect(extra, `${extra.length} label(s) the catalogue never uses`).toEqual([])
  })

  it('is the same vocabulary the Spanish locale shows', () => {
    Object.entries(EXERCISE_LABELS).forEach(([value, label]) => {
      expect(es[value], `the locale must show "${label}" for "${value}"`).toBe(label)
    })
  })

  it('every label is the Spanish the person would type', () => {
    expect(EXERCISE_LABELS.chest).toBe('pecho')
    expect(EXERCISE_LABELS.waist).toBe('abdomen')
    expect(EXERCISE_LABELS.back).toBe('espalda')
    expect(EXERCISE_LABELS.abs).toBe('abdominales')
    expect(EXERCISE_LABELS.barbell).toBe('barra')
  })
})
