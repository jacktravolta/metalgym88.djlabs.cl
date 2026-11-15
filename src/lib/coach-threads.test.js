import { describe, it, expect, vi } from 'vitest'
import {
  COACH_THREADS_KEY,
  MAX_THREADS,
  MAX_THREAD_MSGS,
  MAX_THREAD_TITLE_CHARS,
  THREAD_TTL_MS,
  clearCoachThreads,
  deriveThreadTitle,
  listCoachThreads,
  readCoachMemory,
  removeCoachThread,
  restoreThreadMessages,
  setActiveCoachThread,
  upsertCoachThread,
} from './coach-threads.js'
import { exerciseCards } from './coach-exercises.js'
import { EXDB } from './exercises.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) },
    values,
  }
}

const question = text => [{ role: 'user', text }]
const answer = (text, exerciseIds = []) => [{ role: 'assistant', text, exerciseIds }]

describe('coach thread memory', () => {
  it('writes a thread and reads the same conversation back', () => {
    const storage = memoryStorage()
    const messages = [
      { role: 'user', text: 'How do I squat?' },
      { role: 'assistant', text: 'Start with the bar.', exercises: [{ id: '0001' }] },
    ]

    const written = upsertCoachThread('conversation-1', messages, { storage, now: 1000 })
    const read = readCoachMemory({ storage, now: 1001 })

    expect(written.activeConversationId).toBe('conversation-1')
    expect(read.activeConversationId).toBe('conversation-1')
    expect(read.threads).toHaveLength(1)
    expect(read.threads[0]).toMatchObject({
      conversationId: 'conversation-1',
      title: 'How do I squat?',
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(read.threads[0].messages[1].exerciseIds).toEqual(['0001'])
  })

  it('stores exercise ids instead of the rendered cards', () => {
    const storage = memoryStorage()
    const ex = EXDB.find(item => item.id === '0001')
    upsertCoachThread('conversation-1', answer('Here it is', [ex.id]), { storage, now: 1000 })

    const raw = storage.getItem(COACH_THREADS_KEY)
    expect(raw).toContain(ex.id)
    expect(raw).not.toContain(ex.img)
  })

  it('keeps the newest threads and drops the oldest one', () => {
    const storage = memoryStorage()
    for (let index = 0; index <= MAX_THREADS; index++) {
      upsertCoachThread(`conversation-${index}`, question(`Question ${index}`), {
        storage,
        now: 1000 + index,
      })
    }

    const threads = listCoachThreads({ storage, now: 2000 })
    expect(threads).toHaveLength(MAX_THREADS)
    expect(threads[0].conversationId).toBe(`conversation-${MAX_THREADS}`)
    expect(threads.some(thread => thread.conversationId === 'conversation-0')).toBe(false)
  })

  it('keeps only the panel window of messages in each thread', () => {
    const storage = memoryStorage()
    const messages = Array.from({ length: MAX_THREAD_MSGS + 5 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      text: `Message ${index}`,
    }))

    upsertCoachThread('conversation-1', messages, { storage, now: 1000 })
    const thread = readCoachMemory({ storage, now: 1001 }).threads[0]

    expect(thread.messages).toHaveLength(MAX_THREAD_MSGS)
    expect(thread.messages[0].text).toBe('Message 5')
    expect(thread.messages.at(-1).text).toBe(`Message ${MAX_THREAD_MSGS + 4}`)
  })

  it('drops an expired thread on read and on the next write', () => {
    const storage = memoryStorage()
    upsertCoachThread('expired', question('Old question'), { storage, now: 1000 })

    const afterTtl = readCoachMemory({ storage, now: 1000 + THREAD_TTL_MS + 1 })
    expect(afterTtl.threads).toEqual([])
    expect(afterTtl.activeConversationId).toBe(null)

    upsertCoachThread('fresh', question('Fresh question'), { storage, now: 1000 + THREAD_TTL_MS + 2 })
    const raw = JSON.parse(storage.getItem(COACH_THREADS_KEY))
    expect(raw.threads.map(thread => thread.conversationId)).toEqual(['fresh'])
  })

  it('removes one thread and keeps the others', () => {
    const storage = memoryStorage()
    upsertCoachThread('first', question('First'), { storage, now: 1000 })
    upsertCoachThread('second', question('Second'), { storage, now: 2000 })

    // The active thread is the last one written, so removing another one leaves it alone.
    const kept = removeCoachThread('first', { storage, now: 2001 })
    expect(kept.threads.map(thread => thread.conversationId)).toEqual(['second'])
    expect(kept.activeConversationId).toBe('second')

    // Removing the active one leaves no active thread behind.
    const cleared = removeCoachThread('second', { storage, now: 2002 })
    expect(cleared.threads).toEqual([])
    expect(cleared.activeConversationId).toBe(null)
  })

  it('clears every thread from the device', () => {
    const storage = memoryStorage()
    upsertCoachThread('first', question('First'), { storage, now: 1000 })
    upsertCoachThread('second', question('Second'), { storage, now: 2000 })

    const memory = clearCoachThreads({ storage })
    expect(memory.threads).toEqual([])
    expect(storage.getItem(COACH_THREADS_KEY)).toBe(null)
  })

  it('marks one stored thread as active', () => {
    const storage = memoryStorage()
    upsertCoachThread('first', question('First'), { storage, now: 1000 })
    upsertCoachThread('second', question('Second'), { storage, now: 2000 })

    const memory = setActiveCoachThread('first', { storage, now: 2001 })
    expect(memory.activeConversationId).toBe('first')
    expect(memory.threads.map(thread => thread.conversationId)).toEqual(['second', 'first'])
  })

  it('tolerates malformed JSON', () => {
    const storage = memoryStorage({ [COACH_THREADS_KEY]: '{not-json' })
    expect(() => readCoachMemory({ storage })).not.toThrow()
    expect(readCoachMemory({ storage }).threads).toEqual([])
    expect(storage.getItem(COACH_THREADS_KEY)).toBe(null)
  })

  it('degrades to no memory when storage fails', () => {
    const storage = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('quota exceeded') },
      removeItem: () => { throw new Error('storage blocked') },
    }

    expect(() => upsertCoachThread('conversation-1', question('Private question'), { storage })).not.toThrow()
    expect(readCoachMemory({ storage }).threads).toEqual([])
    expect(() => clearCoachThreads({ storage })).not.toThrow()
  })

  it('derives a short title from the first user message', () => {
    const title = deriveThreadTitle([
      { role: 'user', text: '  How   do I\nplan my squat?  ' },
      { role: 'assistant', text: 'Here is a plan.' },
    ])
    expect(title).toBe('How do I plan my squat?')

    const long = deriveThreadTitle([{ role: 'user', text: 'x'.repeat(100) }])
    expect(long).toHaveLength(MAX_THREAD_TITLE_CHARS)
  })

  it('rebuilds live exercise cards from the catalogue and skips unknown ids', () => {
    const ex = EXDB.find(item => item.id === '0001')
    const storage = memoryStorage()
    upsertCoachThread('conversation-1', answer('Try this', [ex.id, 'not-in-the-catalogue']), {
      storage,
      now: 1000,
    })
    const restored = restoreThreadMessages(readCoachMemory({ storage, now: 1001 }).threads[0].messages)

    expect(restored[0].exercises).toEqual(exerciseCards([{ id: ex.id }]))
    expect(restored[0].exercises.map(card => card.id)).toEqual([ex.id])
  })
})

describe('coach transcript privacy', () => {
  it('keeps the transcript out of the store blob mirrored to the platform', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('document', {
      addEventListener: () => {},
      visibilityState: 'visible',
    })

    const privateQuestion = 'A private training question that must not sync.'
    upsertCoachThread('private-conversation', question(privateQuestion), { storage, now: 1000 })

    const { useStore } = await import('../store/useStore.js')
    const syncedState = JSON.stringify(useStore.getState().S)

    expect(storage.getItem(COACH_THREADS_KEY)).toContain(privateQuestion)
    expect(syncedState).not.toContain(privateQuestion)
    expect(syncedState).not.toContain('private-conversation')
  })

  it('erases the coach memory when the store signs out', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('document', {
      addEventListener: () => {},
      visibilityState: 'visible',
    })

    const { useStore } = await import('../store/useStore.js')
    upsertCoachThread('private-conversation', question('Erase me'), { storage, now: 1000 })
    expect(storage.getItem(COACH_THREADS_KEY)).not.toBe(null)

    await useStore.getState().signOut()
    expect(storage.getItem(COACH_THREADS_KEY)).toBe(null)
  })
})
