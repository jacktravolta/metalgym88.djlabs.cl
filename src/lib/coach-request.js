// The request the exercise sheet hands to the coach.
//
// The sheet knows two things the generic coach entry point does not: WHICH
// exercise is open and WHO is using the app. This module turns both into one
// initial request, so opening the coach and asking about the exercise happen in
// the same action instead of leaving the panel empty.
import { t } from './i18n.js'

export function coachPersonName(user) {
  return String((user && user.name) || '').trim()
}

// The first question names the exercise and asks for the summary the owner
// asked for. The exact id travels too: names can be similar, ids cannot.
export function buildExerciseSummaryRequest(exercise, user) {
  const id = String((exercise && exercise.id) || '').trim()
  const name = String((exercise && exercise.n) || '').trim()
  if (!id && !name) return null

  const person = coachPersonName(user)
  const question = person
    ? t('Hi {0}, summarize the exercise “{1}” (exercise id {2}) and explain how to perform it.', person, name, id)
    : t('Summarize the exercise “{0}” (exercise id {1}) and explain how to perform it.', name, id)

  return {
    question,
    exerciseId: id,
    exerciseName: name,
    exerciseMatches: exercise ? [exercise] : [],
  }
}

// Opens the coach with that request already attached. The injected opener keeps
// the button action unit-testable without a DOM.
export function openExerciseCoach(exercise, user, open) {
  const initialRequest = buildExerciseSummaryRequest(exercise, user)
  const handle = open({ initialRequest })
  return { initialRequest, handle }
}

// The name travels with EVERY question as context, not only with the first one.
// A follow-up can then keep talking about the same exercise and still address
// the person by the name the app already knows.
export function withCoachIdentity(context, user) {
  const person = coachPersonName(user)
  if (!person) return context || null

  const base = context && typeof context === 'object'
    ? context
    : { view: 'coach', title: '', lines: [] }
  const lines = Array.isArray(base.lines) ? base.lines : []
  const identity = t('Address the person by this name: {0}', person)
  if (lines.includes(identity)) return { ...base, lines }
  return { ...base, lines: [...lines, identity] }
}

// The person is introduced ONCE per conversation: the FIRST prompt carries the
// name, the follow-ups do not repeat it. The context line above is a hint; this
// is the request itself, and the model needs the name in the question to greet
// the person by it.
//
// The bubble keeps the person's own words: this only shapes what travels to the
// platform, never what the person reads in their own message.
export function withPersonIntro(question, user) {
  const person = coachPersonName(user)
  const q = String(question == null ? '' : question).trim()
  if (!person || !q) return q
  // A question that already names the person is left alone: the exercise sheet
  // says "Hi Ana, summarize…" and that is enough.
  if (q.toLowerCase().includes(person.toLowerCase())) return q
  return t('My name is {0}. {1}', person, q)
}
