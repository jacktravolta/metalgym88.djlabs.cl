import { describe, it, expect } from 'vitest'
import { exName, EXIDX } from './exercises.js'
import { registerCustom } from './exercises.js'

describe('exName — the readable name of an exercise', () => {
  it('resolves a catalogue exercise by id', () => {
    const id = Object.keys(EXIDX)[0]
    expect(exName(id)).toBe(EXIDX[id].n)
    expect(exName(id).length).toBeGreaterThan(0)
  })

  it('resolves a user-created exercise', () => {
    registerCustom([{ id: 'custom-1', n: 'my lift', bp: 'chest', eq: 'custom', custom: true }])
    expect(exName('custom-1')).toBe('my lift')
  })

  it('falls back to the id when the exercise is unknown', () => {
    expect(exName('nope-42')).toBe('nope-42')
    expect(exName('')).toBe('')
  })
})
