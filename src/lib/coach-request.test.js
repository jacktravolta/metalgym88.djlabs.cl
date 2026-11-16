import { describe, it, expect, vi } from 'vitest'
import {
  buildExerciseSummaryRequest,
  openExerciseCoach,
  withCoachIdentity,
  withPersonIntro,
} from './coach-request.js'

const exercise = { id: '0025', n: 'Press banca con barra' }

describe('exercise-sheet coach request', () => {
  it('opens the coach with a summary question that identifies the exercise', () => {
    const open = vi.fn(() => ({ id: 'sheet-1' }))
    const result = openExerciseCoach(exercise, { name: 'Ana' }, open)

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith({
      initialRequest: expect.objectContaining({
        question: expect.stringContaining(exercise.n),
        exerciseId: exercise.id,
        exerciseMatches: [exercise],
      }),
    })
    expect(result.initialRequest.question).toContain(exercise.id)
    expect(result.initialRequest.question.toLowerCase()).toContain('summar')
  })

  it('addresses the person by the name the app already has', () => {
    const request = buildExerciseSummaryRequest(exercise, { name: 'Ana' })
    expect(request.question).toContain('Ana')
  })

  it('keeps the name in the context of every follow-up question', () => {
    const context = withCoachIdentity(
      { view: 'exercise', title: exercise.n, lines: ['Exercise id: 0025'] },
      { name: 'Ana' }
    )
    expect(context.lines).toContain('Address the person by this name: Ana')
  })

  it('does not invent a name or an identity line when the app has none', () => {
    const request = buildExerciseSummaryRequest(exercise, null)
    expect(request.question).not.toContain('null')
    expect(withCoachIdentity(null, null)).toBe(null)
  })
})

describe('the name in the first prompt of a conversation', () => {
  it('introduces the person by name when the question does not name them', () => {
    const prompt = withPersonIntro('¿Cómo hago press de banca?', { name: 'Ana' })
    expect(prompt).toContain('Ana')
    expect(prompt).toContain('¿Cómo hago press de banca?')
  })

  it('leaves a question that already names the person alone', () => {
    const question = 'Hi Ana, summarize the exercise “Press banca con barra”.'
    expect(withPersonIntro(question, { name: 'Ana' })).toBe(question)
  })

  it('does not invent a name when the app has none', () => {
    expect(withPersonIntro('¿Cómo hago press?', null)).toBe('¿Cómo hago press?')
    expect(withPersonIntro('¿Cómo hago press?', {})).toBe('¿Cómo hago press?')
    expect(withPersonIntro('', { name: 'Ana' })).toBe('')
    expect(withPersonIntro(null, { name: 'Ana' })).toBe('')
  })
})
