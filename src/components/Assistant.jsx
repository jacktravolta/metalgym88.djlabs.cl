// AI Coach panel — the paid feature. A chat sheet over POST /opengym/ai.
//
// Lives as a sheet (same place as the wallet and the account panels) because that is
// where this app puts flows that are not a tab. Reached from Settings ("AI Coach") and
// from the finish-summary sheet, at the moment a finished workout naturally invites
// asking "how did that go?".
//
// Tone rules for every state, per the platform principle: say what happened and what
// the user can do next. No blame, no urgency, no invented numbers — the per-question
// cost is only ever shown when the platform itself served it.
//
// Privacy: the transcript lives on THIS device, under the coach threads' own
// localStorage key. It never enters the store's S blob, so it is never mirrored
// to the platform. The person can delete a thread or all of them, and signing
// out erases the local memory.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { askAssistant, fetchAssistantTariff, isOffline } from '../lib/platform/assistant.js'
import { requestMagicLink } from '../lib/platform/auth.js'
import { buildCoachPayload } from '../lib/coach-context.js'
import { toSpeechText } from '../lib/speech.js'
import { resolveExercises, exerciseCards } from '../lib/coach-exercises.js'
import {
  MAX_THREAD_MSGS,
  clearCoachThreads,
  readCoachMemory,
  removeCoachThread,
  restoreThreadMessages,
  setActiveCoachThread,
  upsertCoachThread,
} from '../lib/coach-threads.js'
import { nav } from '../lib/nav.js'
import { openWallet } from './Wallet.jsx'
import Icon from './Icon.jsx'
import { Button, TextArea, Row, Switch } from './ui.jsx'

const gap = { display: 'grid', gap: 10 }

// One line of honest copy, reused by the entry points and the panel itself: offline
// the assistant is the ONLY thing that stops — the log keeps working the same.
export const OFFLINE_LINE = () => t('The assistant needs a connection — your log keeps working the same without it.')

// Follow the browser's connection signal so disabled states flip on their own — the
// user should never meet a dead send button that a reconnect already fixed.
function useOnline() {
  const [online, setOnline] = useState(!isOffline())
  useEffect(() => {
    const up = () => setOnline(!isOffline())
    window.addEventListener('online', up)
    window.addEventListener('offline', up)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up) }
  }, [])
  return online
}

// Text-to-speech over the browser's own SpeechSynthesis API — no asset, no network,
// no server round-trip. `speaking` lets the panel show a stop control only while
// there is actually audio to stop.
function useTTS() {
  const [speaking, setSpeaking] = useState(false)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const speak = (text, lang = 'es-ES') => {
    if (!supported || !text) return false
    // The answer arrives as markdown; a voice engine would read every asterisk
    // out loud ("asterisco") and the sentence would stop making sense. Only the
    // spoken text is cleaned — the bubble keeps the markdown.
    const clean = toSpeechText(text)
    if (!clean) return false
    const u = new SpeechSynthesisUtterance(clean)
    u.lang = lang
    u.rate = 1
    u.onstart = () => setSpeaking(true)
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    // Set the flag here as well as on `onstart`: some engines fire it late (or not at
    // all), and the stop control has to be there the moment the voice starts.
    setSpeaking(true)
    window.speechSynthesis.speak(u)
    return true
  }
  const stop = () => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }
  return { speak, stop, speaking, supported }
}

// The catalogue exercises the question matched.
//
// The cards come from the FRONT's own resolution (lib/coach-exercises.js), not
// from the model's text: an exercise the catalogue does not have can never
// reach the screen, and the model can never talk about one the cards do not
// show. Each card opens the library filtered by that exact exercise.
//
// The card shows the exercise ANIMATION (the GIF), not only the still picture:
// the question is usually "how do I do this?" and the animation IS the answer.
// The still picture stays as the fallback for an exercise with no animation.
function ExerciseCards({ cards, onOpen }) {
  if (!cards || !cards.length) return null
  return <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
    <div className="dim small">{t('Exercises from the catalogue')}</div>
    {cards.map(card => (
      <a
        key={card.id}
        href={'#' + card.link}
        onClick={e => { e.preventDefault(); onOpen(card) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 6px 6px',
          borderRadius: 12, background: 'var(--surface-2)', textDecoration: 'none', color: 'inherit',
        }}
      >
        <img
          className="thumb"
          src={card.gifUrl || card.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          width="80"
          height="80"
          style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 10, background: '#fff' }}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.3 }}>{card.name}</span>
        <Icon name="chevronRight" className="chev" />
      </a>
    ))}
  </div>
}

function Bubble({ m, onSpeak, onOpenExercise }) {
  const mine = m.role === 'user'
  const isTyping = m.role === 'typing'
  const cards = mine ? [] : (m.exercises || [])
  return <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
    <div style={{ maxWidth: '86%', minWidth: 0 }}>
      <div style={{
        padding: '10px 13px',
        borderRadius: 18,
        whiteSpace: 'pre-wrap',
        lineHeight: 1.5,
        fontSize: 15,
        background: mine
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc) 12%, transparent))'
          : 'var(--surface)',
        color: 'var(--label)',
        border: mine ? '1px solid color-mix(in srgb, var(--acc) 35%, transparent)' : '1px solid var(--sep)',
        boxShadow: '0 1px 0 rgba(0,0,0,.04), 0 6px 18px -10px rgba(0,0,0,.35)',
        borderBottomRightRadius: mine ? 6 : 18,
        borderBottomLeftRadius: mine ? 18 : 6,
        position: 'relative',
      }}>
        {isTyping ? (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', color:'var(--label-2)' }}>
            <Icon name="spinner" className="spin" />
            <span style={{ fontSize:13 }}>{t('Thinking…')}</span>
          </div>
        ) : (
          <>
            <div style={{ paddingRight: 28 }}>
              {m.text}
              {m.streaming && <span style={{
                display:'inline-block', width:2, height:'1em', marginLeft:2,
                background:'var(--acc)', verticalAlign:'text-bottom', animation:'caret 1s steps(2) infinite'
              }} />}
            </div>
            {!mine && (
              <button
                onClick={() => onSpeak && onSpeak(m.text)}
                title={t('Listen')}
                style={{
                  position:'absolute', right:6, bottom:6,
                  background:'transparent', border:'none', color:'var(--label-3)',
                  fontSize:16, cursor:'pointer', padding:4, borderRadius:8
                }}
              >
                <Icon name="volumeHigh" />
              </button>
            )}
          </>
        )}
      </div>
      {cards.length > 0 && <ExerciseCards cards={cards} onOpen={onOpenExercise} />}
    </div>
  </div>
}

// The welcome-bonus gate: spending stops until the email is confirmed again.
// Reuses the sign-in screen's warm copy and its resend action — the question
// stays in the box (send() puts it back on every failure), so the user only
// needs to confirm and press Send once more.
function ReverifyBlock() {
  const email = useStore(s => s.user?.email) || ''
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState(null)
  const resend = async () => {
    if (busy || !email) return
    setBusy(true); setErr(null)
    // The account already accepted the Terms at registration: re-sending the
    // link repeats that consent, it does not create a new one.
    try { await requestMagicLink(email, { terms: true }); setSent(true) }
    catch (e) { setErr(e.message || t('Could not send the link')) }
    setBusy(false)
  }
  return <div style={{ textAlign: 'center', padding: '10px 0' }}>
    <div style={{ fontSize: 36, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
      <Icon name="link" />
    </div>
    <h4 style={{ margin: '8px 0 4px' }}>{t('One step left: confirm your email')}</h4>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Your account is there — the address just needs one confirmation. We sent a link to {0}; open it to confirm, then send your question again. Nothing was spent, and your question is still in the box.', email)}
    </div>
    <div style={{ height: 10 }} />
    {sent
      ? <div className="dim small">{t('Sent — a fresh link is on its way to {0}. It can take a minute.', email)}</div>
      : <Button variant="primary" disabled={busy} onClick={resend}>{busy ? t('Sending…') : t('Resend the link')}</Button>}
    {err && <div className="dim small" style={{ marginTop: 6 }}>{err}</div>}
  </div>
}

// The state blocks replace the transcript while they are up — each one says what
// happened and what the user can do next, nothing more.
function StateBlock({ kind, onOpenWallet }) {
  if (kind === 'reverify') return <ReverifyBlock />
  if (kind === 'not_available') {
    return <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ fontSize: 36, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
        <Icon name="sparkles" />
      </div>
      <h4 style={{ margin: '8px 0 4px' }}>{t('The assistant is not available yet')}</h4>
      <div className="muted small" style={{ lineHeight: 1.5 }}>
        {t('The server hasn\u2019t turned it on yet. When it\u2019s ready it will simply appear here — everything else in the app works the same.')}
      </div>
    </div>
  }
  if (kind === 'insufficient_credits') {
    return <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ fontSize: 36, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
        <Icon name="wallet" />
      </div>
      <h4 style={{ margin: '8px 0 4px' }}>{t('Your balance needs a top-up for this')}</h4>
      <div className="muted small" style={{ lineHeight: 1.5 }}>
        {t('There isn\u2019t enough balance right now, so nothing was sent and nothing was charged. Your question is still in the box — add credits and send it again whenever you like.')}
      </div>
      <div style={{ height: 10 }} />
      <Button variant="primary" onClick={onOpenWallet}>{t('Open my wallet')}</Button>
    </div>
  }
  if (kind === 'auth') {
    return <div className="muted small" style={{ textAlign: 'center', lineHeight: 1.5, padding: '8px 0' }}>
      {t('Your session has expired — sign in again and come back. Nothing here is stored, so the conversation starts fresh.')}
    </div>
  }
  return <div className="muted small" style={{ textAlign: 'center', lineHeight: 1.5, padding: '8px 0' }}>
    {t('The answer didn\u2019t arrive this time — try again in a moment. Any credit usage always shows up in your wallet movements.')}
  </div>
}

// The confirmation before erasing every conversation.
//
// It lives HERE and not in sheets.jsx on purpose: that module already imports
// this one (the exercise sheet opens the coach), so importing its confirmSheet
// back would make a cycle. The markup is the app's centered dialog, word for
// word, so it looks like every other confirmation in the product.
function ConfirmErase({ close, onConfirm }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Delete all conversations?')}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {t('The conversations saved on this device will be erased. This cannot be undone.')}
    </div>
    <button className="btn danger" onClick={() => { close(); onConfirm && onConfirm() }}>
      {t('Delete everything')}
    </button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

function AssistantPanel({ close, context }) {
  const balance = useStore(s => s.balance)
  const soundEnabled = useStore(s => s.S.sound)
  // The two coach switches live in the app state, so they are remembered on the
  // device (localStorage) and follow the account to the other devices. A key
  // that is missing counts as ON: nobody should find a mute they never set.
  const coachSound = useStore(s => s.S.coachSound !== false)
  const coachVoice = useStore(s => s.S.coachVoice !== false)
  const setCoachSound = v => useStore.getState().update(s => { s.coachSound = v })
  const setCoachVoice = v => useStore.getState().update(s => { s.coachVoice = v })
  const [msgs, setMsgs] = useState([])       // [{ role, text, id, exercises }] — the transcript
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [threads, setThreads] = useState([]) // the conversations saved on this device
  const [sending, setSending] = useState(false)
  const [kind, setKind] = useState(null)     // null | 'not_available' | 'insufficient_credits' | 'auth' | 'error'
  const [tariff, setTariff] = useState(undefined) // undefined = loading, null = not served, { cost } = served
  const online = useOnline()
  const listRef = useRef(null)
  const { speak, stop, speaking } = useTTS()
  const [reveal, setReveal] = useState(null)   // { id, idx, full } — the write-out of a long answer
  const lang = useStore(s => s.S.lang) || 'es'
  const ttsLang = lang === 'en' ? 'en-US' : 'es-ES'

  useEffect(() => {
    let alive = true
    fetchAssistantTariff().then(r => { if (alive) setTariff(r) })
    return () => { alive = false }
  }, [])

  // Closing the sheet must not leave the coach talking in the background.
  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  // The panel opens on the conversation this device already has: a refresh, a tab
  // close or a navigation must not wipe the thread. The transcript, its conversation
  // id and the exercise cards come back exactly as they were left.
  useEffect(() => {
    const memory = readCoachMemory()
    setThreads(memory.threads)
    if (!memory.activeConversationId) return
    const thread = memory.threads.find(item => item.conversationId === memory.activeConversationId)
    if (!thread) return
    setConversationId(thread.conversationId)
    setMsgs(restoreThreadMessages(thread.messages))
  }, [])

  // Keep the newest bubble in view — including while a long answer is being written out.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, sending, reveal && reveal.idx])

  // Write the answer out progressively. The platform answers in one shot, so a long
  // answer would otherwise land as a single wall of text with no sign of life; the
  // reveal gives the same "it is being written" feedback a streaming backend would.
  useEffect(() => {
    if (!reveal) return
    if (reveal.idx >= reveal.full.length) {
      setReveal(null)
      setMsgs(m => m.map(x => x.id === reveal.id ? { ...x, text: reveal.full, streaming: false } : x))
      return
    }
    const chunk = Math.max(2, Math.ceil(reveal.full.length / 220))
    const id = setTimeout(() => {
      const next = Math.min(reveal.full.length, reveal.idx + chunk)
      setMsgs(m => m.map(x => x.id === reveal.id ? { ...x, text: reveal.full.slice(0, next) } : x))
      setReveal(r => (r && r.id === reveal.id ? { ...r, idx: next } : r))
    }, 14)
    return () => clearTimeout(id)
  }, [reveal])

  // One control stops everything the coach is doing out loud: the voice AND the
  // write-out. Nothing is left half-spoken or half-written.
  const stopAll = () => {
    stop()
    if (reveal) {
      setMsgs(m => m.map(x => x.id === reveal.id ? { ...x, text: reveal.full, streaming: false } : x))
      setReveal(null)
    }
  }

  const playTick = () => {
    if (!soundEnabled || !coachSound) return
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
      o.connect(g).connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.13)
    } catch {}
  }

  const offline = !online
  const disabled = sending || offline

  const send = async () => {
    const q = input.trim()
    if (!q || disabled) return
    setInput('')
    setKind(null)
    // The catalogue is resolved from THIS question, at THIS moment: the artifact
    // the coach receives and the cards the answer shows have to talk about the
    // same exercises, and the question is the only thing that knows which ones.
    const matches = resolveExercises(q, { state: useStore.getState().S })
    const id = `m${Date.now()}`
    const question = { role: 'user', text: q }
    const answer = { role: 'assistant', text: '', id, streaming: true, exercises: exerciseCards(matches) }
    // The window of the conversation: the thread's own window governs the panel and
    // the saved thread alike — one window, one rule.
    const history = msgs.filter(m => m.role !== 'typing')
    const next = [...history, question, answer].slice(-MAX_THREAD_MSGS)
    setMsgs(m => [...m.filter(x => x.role !== 'typing'), question, { role: 'typing' }].slice(-MAX_THREAD_MSGS))
    setSending(true)
    const r = await askAssistant(q, { conversationId, context, exerciseMatches: matches })
    setSending(false)
    if (r.kind === 'ok') {
      if (r.balance != null) useStore.setState({ balance: r.balance })
      const nextConversationId = r.conversationId || conversationId
      if (nextConversationId) setConversationId(nextConversationId)
      setMsgs(m => [...m.filter(x => x.role !== 'typing'), answer].slice(-MAX_THREAD_MSGS))
      setReveal({ id, idx: 0, full: r.answer })
      playTick()
      if (coachVoice) speak(r.answer, ttsLang)
      // The thread is saved on THIS device right away: a refresh must not lose it,
      // and nothing about it is sent to the platform. The memory holds the FINAL
      // text — the write-out on screen is only a display effect.
      if (nextConversationId) {
        upsertCoachThread(nextConversationId, next.map(m => (m.id === id ? { ...m, text: r.answer, streaming: false } : m)))
        setThreads(readCoachMemory().threads)
      }
    } else {
      setInput(q)
      setKind(r.kind)
    }
  }

  // A card opens the library with that exercise in it. The sheet closes first,
  // so the person lands on the library and not behind a panel.
  const openExercise = card => { close(); nav(card.link) }

  // Stacks the wallet ON TOP of this panel: closing the wallet brings the chat back
  // with the question still in the box, exactly as the state copy promises it.
  const openWalletHere = () => openWallet()

  // The conversations saved on this device: resume one, start a new one, delete the
  // ones the person does not want. None of this leaves the device.
  const newConversation = () => {
    setMsgs([]); setConversationId(null); setKind(null); setReveal(null)
    setActiveCoachThread(null)
    setThreads(readCoachMemory().threads)
  }

  const resumeThread = thread => {
    setConversationId(thread.conversationId)
    setMsgs(restoreThreadMessages(thread.messages))
    setKind(null); setReveal(null)
    setActiveCoachThread(thread.conversationId)
  }

  const deleteThread = threadId => {
    removeCoachThread(threadId)
    if (threadId === conversationId) { setMsgs([]); setConversationId(null); setReveal(null) }
    setThreads(readCoachMemory().threads)
  }

  // Erases EVERY conversation on this device: the memory, the panel's transcript and
  // the active thread. The key itself is removed, so nothing is left to restore.
  const forgetEveryThread = () => {
    clearCoachThreads()
    setActiveCoachThread(null)
    setMsgs([]); setConversationId(null); setKind(null); setReveal(null)
    setThreads(readCoachMemory().threads)
  }

  // Erasing is not undoable, so it asks first. The dialog is the app's own
  // centered one, opened through the UI store: importing the shared confirmSheet
  // from sheets.jsx would close a cycle (that module already imports this one).
  const askEraseEveryThread = () => useUI.getState().openSheet(
    close => <ConfirmErase close={close} onConfirm={forgetEveryThread} />,
    { kind: 'center' }
  )

  return <>
    <h3>{t('AI Coach')}</h3>
    <div style={{ marginBottom: 8, fontSize:13, color:'var(--label-2)', lineHeight:1.4 }}>
      {t('AI assistant of metalgym88')} · {t('reads your synced training data')}
      {balance != null && <> · {t(balance === 1 ? '{0} credit available' : '{0} credits available', balance)}</>}
    </div>

    {context && context.title && <div className="dim small" style={{ marginBottom: 8 }}>{t('About: {0}', context.title)}</div>}
    {offline && <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.5 }}>{OFFLINE_LINE()}</div>}

    <div style={{ display:'flex', gap:12, alignItems:'center', margin:'8px 0 10px', fontSize:13, color:'var(--label-2)' }}>
      <label style={{ display:'flex', alignItems:'center', gap:6 }}>
        <Switch checked={coachSound} onChange={setCoachSound} /> {t('Sound on reply')}
      </label>
      <label style={{ display:'flex', alignItems:'center', gap:6 }}>
        <Switch checked={coachVoice} onChange={setCoachVoice} /> {t('Auto read answers')}
      </label>
    </div>

    {/* The conversations saved on this device. They never leave it. */}
    <div style={{ marginBottom: 8 }}>
      <div className="row between" style={{ alignItems: 'center', gap: 8 }}>
        <span className="dim small">{t('Your conversations')}</span>
        <Button variant="ghost" className="dim" disabled={sending} onClick={newConversation}>{t('New conversation')}</Button>
      </div>
      {threads.length > 0 && <div style={{ display: 'grid', gap: 2, marginTop: 6, maxHeight: 120, overflowY: 'auto' }}>
        {threads.map(thread => {
          const active = thread.conversationId === conversationId
          return <div key={thread.conversationId} className="row between" style={{ padding: '3px 0', gap: 8 }}>
            <button
              onClick={() => resumeThread(thread)}
              disabled={sending}
              style={{
                flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent',
                color: active ? 'var(--acc)' : 'var(--label)', font: 'inherit', padding: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer',
              }}
            >{thread.title || t('Conversation')}</button>
            <button
              onClick={() => deleteThread(thread.conversationId)}
              disabled={sending}
              aria-label={t('Delete')}
              style={{ border: 'none', background: 'transparent', color: 'var(--grey)', font: 'inherit', padding: '0 4px', cursor: 'pointer' }}
            >×</button>
          </div>
        })}
      </div>}
      {/* The erase control is there as long as there is something to erase: the
          person must never have to hunt for it. */}
      {(threads.length > 0 || msgs.length > 0) && <div style={{ marginTop: 6 }}>
        <Button variant="danger" icon="trash" onClick={askEraseEveryThread}>{t('Delete all conversations')}</Button>
      </div>}
    </div>

    {/* One global stop: it ends the voice and finishes the write-out at once, so the
        answer is never left half-spoken or half-written. */}
    {(speaking || reveal) && (
      <button
        onClick={stopAll}
        style={{
          display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          width:'100%', padding:'9px 12px', marginBottom:10,
          borderRadius:12, fontSize:14, fontWeight:500,
          background:'color-mix(in srgb, var(--red) 16%, transparent)',
          color:'var(--red)',
        }}
      >
        <Icon name="stop" />
        <span>{t('Stop')}</span>
      </button>
    )}

    <div ref={listRef} style={{
      display: 'grid', gap: 10, maxHeight: '42vh', overflowY: 'auto',
      padding: '6px 2px', marginBottom: 12, scrollBehavior: 'smooth',
      background: 'color-mix(in srgb, var(--surface) 60%, transparent)', borderRadius:12
    }}>
      {msgs.map((m, i) => (
        <Bubble key={m.id || i} m={m} onSpeak={(text)=>{ speak(text, ttsLang); playTick() }} onOpenExercise={openExercise} />
      ))}
      {/* Progress of the write-out: a hairline that fills while the answer appears. */}
      {reveal && (
        <div style={{ height:2, borderRadius:99, background:'var(--surface-2)', overflow:'hidden' }}>
          <div style={{
            height:'100%', width:`${Math.round((reveal.idx / Math.max(1, reveal.full.length)) * 100)}%`,
            background:'var(--acc)', transition:'width 120ms linear'
          }} />
        </div>
      )}
    </div>

    {kind && <div style={{ marginBottom: 10 }}><StateBlock kind={kind} onOpenWallet={openWalletHere} /></div>}

    <TextArea
      value={input}
      placeholder={t('Ask about your training, plan or progress…')}
      rows={3}
      style={{ marginBottom: 8 }}
      disabled={offline}
      onChange={e => setInput(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
    />

    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
      {tariff === undefined ? '…' : tariff ? t(tariff.cost === 1 ? '{0} credit per question.' : '{0} credits per question.', tariff.cost) : t('The cost is shown when you confirm.')}
    </div>

    <div style={gap}>
      <Button variant="primary" disabled={disabled || !input.trim()} onClick={send}>
        {sending ? t('Thinking…') : t('Send')}
      </Button>
      <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
    </div>
    <div style={{ height: 8 }} />
  </>
}

// Signed-in platform build only: guests, demo and mobile have no platform account.
// Returns the sheet handle (or null when the panel is not available here).
//
// The context is captured HERE, at the moment the coach opens: the screen the user is
// standing on is read once, and the same snapshot travels with every question of the
// conversation (so a follow-up still knows what the user was looking at).
export function openAssistant() {
  if (MOBILE || DEMO) return null
  if (!useStore.getState().user) return null
  const context = buildCoachPayload()
  return useUI.getState().openSheet(close => <AssistantPanel close={close} context={context} />)
}

// The Settings entry. Offline the row renders untappable WITH the honest one-liner —
// a disabled control that explains itself, not a silent dead tap.
export function AssistantRow() {
  const online = useOnline()
  if (!online) {
    return <Row icon="sparkles" iconTint="var(--grey)" title={t('AI Coach')} subtitle={OFFLINE_LINE()} />
  }
  return <Row icon="sparkles" iconTint="var(--purple)" title={t('AI Coach')}
    subtitle={t('Ask about your training, plan or progress')} accessory="chevron" onClick={openAssistant} />
}
