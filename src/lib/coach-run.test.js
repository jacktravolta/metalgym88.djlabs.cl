import { describe, it, expect } from 'vitest'
import { createCoachRunGuard } from './coach-run.js'

describe('coach request runs', () => {
  it('aborts the previous request when a new run begins', () => {
    const guard = createCoachRunGuard()
    const first = guard.begin()
    const second = guard.begin()

    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(false)
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('closing the panel aborts the active request and makes its late result stale', () => {
    const guard = createCoachRunGuard()
    const run = guard.begin()

    guard.abort()

    expect(run.controller.signal.aborted).toBe(true)
    expect(guard.isCurrent(run)).toBe(false)
  })

  it('finishing the current run leaves no active request behind', () => {
    const guard = createCoachRunGuard()
    const run = guard.begin()

    guard.complete(run)

    expect(run.controller.signal.aborted).toBe(false)
    expect(guard.isCurrent(run)).toBe(false)
  })
})
