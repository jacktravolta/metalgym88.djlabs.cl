// Platform account panels — password sign-in, magic-link request, and e-mail registration.
// Shared by the sign-in view and the Settings sheets so there is a single copy of each
// flow. Styling stays on the app's own .input fields and Buttons; the email-verification
// pause is a distinct, friendly state the forms hand over to, not an error dump.
import { useEffect, useRef, useState } from 'react'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { login, register, requestMagicLink, EMAIL_REVERIFY_REQUIRED } from '../lib/platform/auth.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

const gap = { display: 'grid', gap: 10 }

const displayName = u => (u && (u.name || u.email)) || ''

const afterIn = async (close, label) => {
  const { pullState, pushState } = useStore.getState()
  const signed = useStore.getState().user
  close?.()
  if (signed && hasData(useStore.getState().S)) {
    await pushState()
    useUI.getState().toast(t('Profile created — data from this device moved into it'))
  } else {
    await pullState()
    useUI.getState().toast(t(label || 'Welcome back, {0}', displayName(signed)))
  }
}

function PasswordForm({ onOk, onVerify, toMagic, toRegister }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async ev => {
    ev.preventDefault()
    if (busy) return
    if (!email.trim() || !password) { setErr(t('Enter your email and password')); return }
    setBusy(true); setErr(null)
    try {
      const { user } = await login(email.trim(), password)
      useStore.getState().setUser(user)
      await afterIn(onOk)
    } catch (e) {
      if (e.code === EMAIL_REVERIFY_REQUIRED) onVerify?.(email.trim())
      else setErr(e.message || t('Sign-in failed'))
    }
    setBusy(false)
  }
  return (
    <form onSubmit={go} style={gap}>
      <h3 style={{ margin: 0 }}>{t('Sign in')}</h3>
      <input ref={ref} className="input" type="email" autoComplete="email" placeholder={t('Email')}
        value={email} onChange={e => setEmail(e.target.value)} />
      <input className="input" type="password" autoComplete="current-password" placeholder={t('Password')}
        value={password} onChange={e => setPassword(e.target.value)} />
      {err && <div className="dim small">{err}</div>}
      <Button variant="primary" type="submit" disabled={busy}>{busy ? t('Signing in…') : t('Sign in')}</Button>
      <div className="dim small" style={{ display: 'flex', gap: 14 }}>
        <button type="button" className="linklike" onClick={toMagic} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>{t('Email me a sign-in link instead')}</button>
        <button type="button" className="linklike" onClick={toRegister} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>{t('Create an account')}</button>
      </div>
    </form>
  )
}

function MagicLinkForm({ back }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async ev => {
    ev.preventDefault()
    if (busy || !email.trim()) { if (!email.trim()) setErr(t('Enter your email')); return }
    setBusy(true); setErr(null)
    try { await requestMagicLink(email.trim()); setSent(true) }
    catch (e) { setErr(e.message || t('Could not send the link')) }
    setBusy(false)
  }
  if (sent) return <div style={gap}>
    <h3 style={{ margin: 0 }}>{t('Check your email')}</h3>
    <div className="muted small">{t('If {0} is an account here, a sign-in link is on its way — it works for the next few minutes.', email.trim())}</div>
    <Button variant="ghost" onClick={back}>{t('Back')}</Button>
  </div>
  return (
    <form onSubmit={go} style={gap}>
      <h3 style={{ margin: 0 }}>{t('Sign-in link by email')}</h3>
      <div className="muted small">{t('No password needed — we email you a one-tap sign-in link.')}</div>
      <input ref={ref} className="input" type="email" autoComplete="email" placeholder={t('Email')}
        value={email} onChange={e => setEmail(e.target.value)} />
      {err && <div className="dim small">{err}</div>}
      <Button variant="primary" type="submit" disabled={busy}>{busy ? t('Sending…') : t('Send the link')}</Button>
      <Button variant="ghost" onClick={back}>{t('Back')}</Button>
    </form>
  )
}

function RegisterForm({ onOk, onVerify, toSignin }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async ev => {
    ev.preventDefault()
    if (busy) return
    const n = name.trim()
    if (!n || !email.trim()) { setErr(t('Enter your name and email')); return }
    setBusy(true); setErr(null)
    try {
      const { user } = await register(email.trim(), n)
      useStore.getState().setUser(user)
      await afterIn(onOk, 'Welcome, {0}')
    } catch (e) {
      if (e.code === EMAIL_REVERIFY_REQUIRED) onVerify?.(email.trim())
      else setErr(e.message || t('Registration failed'))
    }
    setBusy(false)
  }
  return (
    <form onSubmit={go} style={gap}>
      <h3 style={{ margin: 0 }}>{t('Create your account')}</h3>
      <div className="muted small" style={{ margin: 0 }}>{t('Works across the djlabs apps — your data is kept separate per product, and a welcome balance of credits is added here.')}</div>
      <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      <input className="input" type="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)} />
      {err && <div className="dim small">{err}</div>}
      <Button variant="primary" type="submit" disabled={busy}>{busy ? t('Creating…') : t('Create account')}</Button>
      <Button variant="ghost" onClick={toSignin}>{t('I already have an account')}</Button>
    </form>
  )
}

// Distinct pause state: the account exists but the email still needs confirming. No error
// dump — just the missing step and a way to redo it.
function ReverifyPause({ email, back }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState(null)
  const resend = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try { await requestMagicLink(email); setSent(true) }
    catch (e) { setErr(e.message || t('Could not send the link')) }
    setBusy(false)
  }
  return (
    <div style={gap}>
      <h3 style={{ margin: 0 }}>{t('One step left: confirm your email')}</h3>
      <div className="muted small">{t('Your account is there — the address just needs one confirmation. We sent a link to {0}; open it to confirm, then sign in as usual.', email)}</div>
      {sent
        ? <div className="dim small">{t('Sent — a fresh link is on its way to {0}. It can take a minute.', email)}</div>
        : <Button variant="primary" icon="link" disabled={busy} onClick={resend}>{busy ? t('Sending…') : t('Resend the link')}</Button>}
      {err && <div className="dim small">{err}</div>}
      <Button variant="ghost" className="dim" onClick={back}>{t('Back to sign in')}</Button>
    </div>
  )
}

export default function AuthPanel({ mode: initial = 'signin', close }) {
  const [mode, setMode] = useState(initial)
  const [pausedEmail, setPausedEmail] = useState(null)
  if (pausedEmail !== null) {
    return <ReverifyPause email={pausedEmail} back={() => { setPausedEmail(null); setMode('signin') }} />
  }
  if (mode === 'magic') return <MagicLinkForm back={() => setMode(initial)} />
  if (mode === 'register') {
    return <RegisterForm onOk={close} onVerify={setPausedEmail} toSignin={() => setMode('signin')} />
  }
  return <PasswordForm onOk={close} onVerify={setPausedEmail} toMagic={() => setMode('magic')} toRegister={() => setMode('register')} />
}
