import { describe, it, expect } from 'vitest'
import { linkifyExercises, splitBold, exHref } from './exercise-links.js'
import { EXIDX, exName } from './exercises.js'

// The chat renders the segments as nodes: a link is a link, the rest is text.
const linksOf = text => linkifyExercises(text).filter(s => s.type === 'link')
const whole = segs => segs.map(s => s.text).join('')

describe('the links the coach shows', () => {
  it('links the exercise the owner asked about ("Abdominal 3/4")', () => {
    const answer = '**Abdominal 3/4** es una versión del abdominal tradicional donde haces solo 3/4 del recorrido.'
    const links = linksOf(answer)
    expect(links).toHaveLength(1)
    expect(links[0].text).toBe('Abdominal 3/4')
    // the id is a real exercise of the catalogue — not a made-up one
    expect(EXIDX[links[0].id]).toBeTruthy()
    expect(exName(links[0].id)).toBe('Abdominal 3/4')
    // and the link opens its sheet in the library
    expect(links[0].href).toBe(exHref(links[0].id))
    expect(links[0].href).toBe('#/library?ex=' + links[0].id)
  })

  it('links the same exercise written in lower case or without accents', () => {
    const lower = linksOf('haz abdominal 3/4 hoy')
    const upper = linksOf('HAZ ABDOMINAL 3/4 HOY')
    expect(lower).toHaveLength(1)
    expect(upper).toHaveLength(1)
    expect(lower[0].id).toBe(linksOf('Abdominal 3/4')[0].id)
    expect(upper[0].id).toBe(lower[0].id)
  })

  it('keeps the answer whole, characters included', () => {
    const answer = '**Abdominal 3/4** es una versión del abdominal tradicional donde haces solo 3/4 del recorrido.'
    const segs = linkifyExercises(answer)
    expect(whole(segs)).toBe(answer)
    // the markdown markers are still there: the bold is a layer on top
    expect(segs.map(s => s.text).join('')).toContain('**')
  })

  it('links the name when the model wrote it in bold', () => {
    const answer = '**Abdominal 3/4** es una versión del abdominal tradicional.'
    // the chat splits the bold first, then links what is inside it
    const runs = splitBold(answer)
    expect(runs[0]).toEqual({ text: 'Abdominal 3/4', bold: true })
    const links = runs.flatMap(r => linksOf(r.text))
    expect(links).toHaveLength(1)
    expect(links[0].id).toBe('0001')
    expect(links[0].text).toBe('Abdominal 3/4')
  })

  it('links the longest name when two of them fit', () => {
    const links = linksOf('hoy hice dominada asistida de pie')
    expect(links).toHaveLength(1)
    expect(links[0].text).toBe('dominada asistida de pie')
    expect(exName(links[0].id)).toBe('Dominada asistida de pie')
  })

  it('never links a name that two exercises share', () => {
    // "Abdominal declinado" is two different exercises in the catalogue
    const twins = Object.values(EXIDX).filter(e => e.n === 'Abdominal declinado')
    expect(twins.length).toBeGreaterThan(1)
    expect(linksOf('haz abdominal declinado hoy')).toHaveLength(0)
  })

  it('does not invent links in ordinary prose', () => {
    expect(linksOf('hoy quiero entrenar y luego revisar el plan')).toHaveLength(0)
    expect(linksOf('te recomiendo descansar y tomar agua, el descanso es importante')).toHaveLength(0)
    expect(linksOf('me duele el abdomen y el cuadriceps')).toHaveLength(0)
  })

  it('does not link a name that is only part of a longer word', () => {
    expect(linksOf('los abdominales son un grupo de ejercicios')).toHaveLength(0)
    expect(linksOf('xabdominal 3/4x')).toHaveLength(0)
  })

  it('links every mention, in order', () => {
    const segs = linkifyExercises('empieza con abdominal 3/4 y termina con abdominal 3/4')
    const links = segs.filter(s => s.type === 'link')
    expect(links).toHaveLength(2)
    expect(links[0].id).toBe(links[1].id)
    expect(whole(segs)).toBe('empieza con abdominal 3/4 y termina con abdominal 3/4')
  })

  it('leaves an empty answer alone', () => {
    expect(linkifyExercises('')).toEqual([])
    expect(linkifyExercises(null)).toEqual([])
  })
})

describe('the bold the model wrote', () => {
  it('splits **bold** into a bold run', () => {
    expect(splitBold('**Abdominal 3/4** es una versión')).toEqual([
      { text: 'Abdominal 3/4', bold: true },
      { text: ' es una versión', bold: false },
    ])
  })

  it('keeps a marker that is never closed as plain text', () => {
    const runs = splitBold('abdominal **3/4')
    expect(runs.map(r => r.text).join('')).toBe('abdominal **3/4')
    // the model never said where the bold ended, so nothing after it is bold
    expect(runs.every(r => r.bold === false)).toBe(true)
  })
})
