import { describe, it, expect } from 'vitest'
import { EXDB as RAW_EXDB } from './exercises-data.js'
import { EXDB } from './exercises.js'
import { translateExerciseName, unknownWordsIn } from './exercises-names.es.js'

// The catalogue ships 1.324 names in English and the product is Spanish. A name
// the translator cannot read would show up in the UI as English in the middle of
// a Spanish screen — so "every name is understood" is an assertion here, not a
// wish. When a new name arrives that the dictionaries cannot read, this test
// fails with the exact word that is missing.

describe('exercise names in Spanish', () => {
  it('translates every catalogue name', () => {
    const unreadable = RAW_EXDB.filter(e => unknownWordsIn(e.n).length > 0)
    expect(
      unreadable.map(e => `${e.n} → ${unknownWordsIn(e.n).join(', ')}`)
    ).toEqual([])
  })

  it('never shows the English name', () => {
    // The loanwords that are the same in Spanish: the exercise IS that word.
    const sameInSpanish = new Set([
      'burpee',
      'battling ropes',
      'fighting ropes',
      'landmine 180',
      'swing 360',
    ])
    const stillEnglish = RAW_EXDB.filter(
      e => !sameInSpanish.has(e.n.toLowerCase()) && translateExerciseName(e.n) === e.n
    )
    expect(stillEnglish.map(e => e.n)).toEqual([])
  })

  it('exposes the Spanish name through the catalogue the app reads', () => {
    const raw = RAW_EXDB.find(e => e.n === 'barbell bench press')
    const translated = EXDB.find(e => e.id === raw.id)
    expect(translated.n).toBe('Press de banca con barra')
  })

  it('names the movements the way a person would say them', () => {
    const byName = {}
    RAW_EXDB.forEach(e => { byName[e.n.toLowerCase()] = translateExerciseName(e.n) })

    expect(byName['barbell bench press']).toBe('Press de banca con barra')
    expect(byName['dumbbell biceps curl']).toBe('Curl de bíceps con mancuernas')
    expect(byName['3/4 sit-up']).toBe('Abdominal 3/4')
    expect(byName['barbell full squat']).toBe('Sentadilla completa con barra')
    expect(byName['cable seated row']).toBe('Remo sentado en polea')
  })

  it('agrees the modifiers with the movement in gender', () => {
    const byName = {}
    RAW_EXDB.forEach(e => { byName[e.n.toLowerCase()] = translateExerciseName(e.n) })

    // "sentadilla" is feminine, "remo" is masculine.
    expect(byName['barbell full squat']).toContain('completa')
    expect(byName['cable seated row']).toContain('sentado')
  })
})
