import { describe, it, expect } from 'vitest'
import { searchExercises } from './exercise-search.js'
import { EXDB, EXIDX } from './exercises.js'

const state = { customEx: [] }

describe('searchExercises', () => {
  it('finds the catalogue exercise named by the query', () => {
    const matches = searchExercises(state, 'abdominal 3/4')
    expect(matches.map(ex => ex.id)).toContain('0001')
    expect(matches[0].n).toBe(EXIDX['0001'].n)
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchExercises(state, 'exercise-that-does-not-exist')).toEqual([])
  })

  it('keeps the body-part filter and the result bound', () => {
    const matches = searchExercises(state, '', { bp: 'chest', limit: 3 })
    expect(matches).toHaveLength(3)
    expect(matches.every(ex => ex.bp === 'chest')).toBe(true)
  })

  // The library's matching rules, unchanged: the QUERY is lowercased, and the
  // target muscle and the equipment are then compared exactly as the
  // catalogue stores them (never re-cased behind the search's back).
  it('lower-cases the query and compares the fields as they are stored', () => {
    expect(searchExercises(state, 'ABDOMINAL').map(ex => ex.id)).toContain('0001')
    expect(searchExercises(state, 'BARBELL').length).toBe(searchExercises(state, 'barbell').length)
    expect(searchExercises(state, 'barbell').length).toBeGreaterThan(0)
  })

  it('keeps the custom exercises in front of the catalogue', () => {
    const custom = { id: 'custom-1', n: 'Mi ejercicio', bp: 'chest', tg: 'chest', eq: 'barbell', img: 'x.jpg' }
    const matches = searchExercises({ customEx: [custom] }, 'mi ejercicio')
    expect(matches[0].id).toBe('custom-1')
  })

  it('an empty query returns the whole catalogue', () => {
    expect(searchExercises(state, '')).toHaveLength(EXDB.length)
  })

  describe('accents', () => {
    it('the exact comparison (the library) does not confuse an accent for a plain letter', () => {
      // "Elevación" and "elevacion" are different strings: the library keeps
      // what it always did.
      const exact = searchExercises(state, 'elevacion')
      const folded = searchExercises(state, 'elevacion', { accents: 'ignore' })
      expect(exact.length).toBeLessThan(folded.length)
      expect(folded.length).toBeGreaterThan(0)
    })

    it('the folded comparison finds the accented name the person typed without the accent', () => {
      const folded = searchExercises(state, 'elevacion lateral', { accents: 'ignore' })
      expect(folded.some(ex => ex.n.toLowerCase().includes('elevación'))).toBe(true)
    })
  })
})
