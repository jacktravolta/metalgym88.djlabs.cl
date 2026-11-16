import { describe, it, expect, vi, afterEach } from 'vitest'
import { swish } from './sound.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('swish', () => {
  it('plays a quiet downward sweep and reuses the shared AudioContext', () => {
    const contexts = []

    class FakeAudioContext {
      constructor() {
        this.currentTime = 4
        this.destination = {}
        this.oscillators = []
        this.gains = []
        contexts.push(this)
      }

      createOscillator() {
        const oscillator = {
          type: '',
          frequency: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }
        this.oscillators.push(oscillator)
        return oscillator
      }

      createGain() {
        const gain = {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        }
        this.gains.push(gain)
        return gain
      }
    }

    vi.stubGlobal('window', { AudioContext: FakeAudioContext })

    swish(false)
    expect(contexts).toHaveLength(0)

    swish(true)
    swish(true)

    expect(contexts).toHaveLength(1)
    const context = contexts[0]
    expect(context.oscillators).toHaveLength(2)

    const oscillator = context.oscillators[0]
    const gain = context.gains[0]
    expect(oscillator.type).toBe('sine')
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(1100, 4)
    expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(700, 4.12)
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.001, 4)
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.05, 4.01)
    expect(oscillator.start).toHaveBeenCalledWith(4)
    expect(oscillator.stop).toHaveBeenCalledWith(4.13)
  })
})
