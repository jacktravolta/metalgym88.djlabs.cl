import { describe, it, expect } from 'vitest'
import { exName, EXIDX, imgSrc, gifSrc } from './exercises.js'
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

// The media (~140 MB) is not in this repository. A build that asks for a
// relative 'img/' or 'gif/' finds nothing: the whole catalogue shows broken
// pictures. The default points at the dataset's CDN, so it is absolute.
describe('the exercise media', () => {
  const ex = EXIDX['0025']

  it('points at an absolute URL', () => {
    expect(imgSrc(ex)).toMatch(/^https?:\/\//)
    expect(gifSrc(ex)).toMatch(/^https?:\/\//)
  })

  it('keeps the file name the dataset uses', () => {
    expect(imgSrc(ex)).toContain(ex.img)
    expect(gifSrc(ex)).toContain(ex.gif)
  })

  it('reads the picture and the animation from different folders', () => {
    expect(imgSrc(ex)).not.toBe(gifSrc(ex))
    expect(imgSrc(ex)).toMatch(/\/images\//)
    expect(gifSrc(ex)).toMatch(/\/videos\//)
  })
})
