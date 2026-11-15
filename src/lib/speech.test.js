// The speech cleaner is the difference between a sentence and a reading of
// markdown punctuation, so the rules are pinned here rather than left to the
// eye of whoever edits the chat next.
import { describe, it, expect } from 'vitest'
import { toSpeechText } from './speech.js'

describe('toSpeechText', () => {
  it('drops the asterisks of bold and italic', () => {
    expect(toSpeechText('**Fuerza**: haz *3 series* de sentadillas.')).toBe(
      'Fuerza: haz 3 series de sentadillas.'
    )
  })

  it('reads a sentence that only had a stray asterisk', () => {
    expect(toSpeechText('Tu * peso sube')).toBe('Tu peso sube')
    expect(toSpeechText('Multiplica 5*3')).toBe('Multiplica 53')
  })

  it('keeps a paragraph of bold text in one piece', () => {
    expect(toSpeechText('**primero** y **después**')).toBe('primero y después')
  })

  it('does not read link URLs, only the label', () => {
    expect(toSpeechText('Ver [la guía](https://ejemplo.cl/guia).')).toBe('Ver la guía.')
    expect(toSpeechText('![un gráfico](https://ejemplo.cl/g.png)')).toBe('un gráfico')
  })

  it('drops list, heading and quote markers', () => {
    expect(toSpeechText('## Plan\n- squats\n- press\n\n> cuida la espalda')).toBe(
      'Plan\nsquats\npress\n\ncuida la espalda'
    )
  })

  it('keeps the text of inline code without the backticks', () => {
    expect(toSpeechText('Usa `npm run build` ahora')).toBe('Usa npm run build ahora')
  })

  it('leaves prices, percentages and plain words alone', () => {
    expect(toSpeechText('Cuesta $15.000, son 40% menos y dura 90 segundos.')).toBe(
      'Cuesta $15.000, son 40% menos y dura 90 segundos.'
    )
  })

  it('handles empty input without throwing', () => {
    expect(toSpeechText('')).toBe('')
    expect(toSpeechText(null)).toBe('')
    expect(toSpeechText(undefined)).toBe('')
  })
})
