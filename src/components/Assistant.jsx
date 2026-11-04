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
// Privacy: the transcript lives in THIS component's state only — nothing in
// localStorage, nothing on the next visit. Server-side transcripts are the platform's
// contract; the client keeps no copy once the sheet closes.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { askAssistant, fetchAssistantTariff, isOffline } from '../lib/platform/assistant.js'
import { requestMagicLink } from '../lib/platform/auth.js'
import { openWallet } from './Wallet.jsx'
import Icon from './Icon.jsx'
import { Button, TextArea, Row } from './ui.jsx'

// Session-only window: enough context to follow a conversation, small enough that a
// long chat can't bloat the sheet. Beyond the window older turns are dropped (not
// stored anywhere — see the privacy note above).
const MAX_MSGS = 30

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

function Bubble({ m }) {
  const mine = m.role === 'user'
  return <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
    <div style={{
      maxWidth: '86%', padding: '9px 12px', borderRadius: 14, whiteSpace: 'pre-wrap', lineHeight: 1.45,
      fontSize: 15,
      background: mine ? 'color-mix(in srgb, var(--acc) 18%, transparent)' : 'var(--surface-3)',
      borderBottomRightRadius: mine ? 4 : 14,
      borderBottomLeftRadius: mine ? 14 : 4,
    }}>{m.text}</div>
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
    try { await requestMagicLink(email); setSent(true) }
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

function AssistantPanel({ close }) {
  const balance = useStore(s => s.balance)
  const [msgs, setMsgs] = useState([])       // [{ role, text }] — component state ONLY
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [sending, setSending] = useState(false)
  const [kind, setKind] = useState(null)     // null | 'not_available' | 'insufficient_credits' | 'auth' | 'error'
  const [tariff, setTariff] = useState(undefined) // undefined = loading, null = not served, { cost } = served
  const online = useOnline()
  const listRef = useRef(null)

  // Tariff BEFORE sending: only what the platform serves. Nothing cached, nothing
  // invented — if the row isn't there, the honest copy is "shown when you confirm".
  useEffect(() => {
    let alive = true
    fetchAssistantTariff().then(r => { if (alive) setTariff(r) })
    return () => { alive = false }
  }, [])

  // Keep the newest bubble in view.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs.length, sending])

  const offline = !online
  const disabled = sending || offline

  const send = async () => {
    const q = input.trim()
    if (!q || disabled) return
    setInput(''); setSending(true); setKind(null)
    const r = await askAssistant(q, { conversationId })
    setSending(false)
    if (r.kind === 'ok') {
      // Balance refreshes after EVERY completion — the metered feature says what it cost.
      if (r.balance != null) useStore.setState({ balance: r.balance })
      if (r.conversationId) setConversationId(r.conversationId)
      setKind(null)
      setMsgs(m => [...m, { role: 'user', text: q }, { role: 'assistant', text: r.answer }].slice(-MAX_MSGS))
    } else {
      // The question goes back in the box: the copy promises it is still there.
      setInput(q)
      setKind(r.kind)
    }
  }

  // Stacks the wallet ON TOP of this panel: closing the wallet brings the chat back
  // with the question still in the box, exactly as the state copy promises it.
  const openWalletHere = () => openWallet()

  return <>
    <h3>{t('AI Coach')}</h3>
    <div className="muted small" style={{ marginBottom: 8, lineHeight: 1.5 }}>
      {/* Persona naming is server-driven later (per-heart persona in T6); a generic,
          language-neutral product name for now. */}
      {'Asistente metalgym88'} · {t('reads your synced training data')}
      {balance != null && <> · {t('{0} credits available', balance)}</>}
    </div>

    {offline && <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.5 }}>{OFFLINE_LINE()}</div>}

    {msgs.length > 0 && <div ref={listRef} style={{
      display: 'grid', gap: 8, maxHeight: '38vh', overflowY: 'auto',
      padding: '4px 2px', marginBottom: 10,
    }}>
      {msgs.map((m, i) => <Bubble key={i} m={m} />)}
    </div>}

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

    {/* Cost per question, only when the platform served it — never a guessed number. */}
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
      {tariff === undefined
        ? '…'
        : tariff
          ? t('{0} credits per question.', tariff.cost)
          : t('The cost is shown when you confirm.')}
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
export function openAssistant() {
  if (MOBILE || DEMO) return null
  if (!useStore.getState().user) return null
  return useUI.getState().openSheet(close => <AssistantPanel close={close} />)
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
