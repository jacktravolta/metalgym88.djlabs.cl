// The sign-in landing: what the person sees between "the link was opened" and
// "the app is ready".
//
// The platform's email sign-in link points at <front>/auth/verify?token=… — a
// path this hash-router app does not know. So the boot hands the screen over to
// this component, which redeems the token and only then mounts the app (its
// boot asks GET /auth/me and finds the session that was just created).
//
// Three states, and never a blank screen:
//   · checking — the token is being redeemed ("Verificando tu acceso…")
//   · ready    — the session is live, the app is on screen
//   · error    — the link expired, was already used, or the network is down:
//                a friendly message with a way out, while the app stays mounted
//                and usable behind it.
import { useEffect, useRef, useState } from 'react'
import App from '../App.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { consumeMagicLink, clearLandingUrl } from '../lib/platform/landing.js'

// The app's own surfaces: the black backdrop and the green accent, no new CSS.
const overlay = {
  position: 'fixed', inset: 0, zIndex: 300,
  background: 'var(--bg)', color: 'var(--label)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 16, padding: '32px 24px', textAlign: 'center'
}
const actions = { width: '100%', maxWidth: 320, display: 'grid', gap: 10 }

export default function MagicLinkLanding({ token }) {
  const [phase, setPhase] = useState('checking')   // checking | error | ready
  const [attempt, setAttempt] = useState(0)
  const [appMounted, setAppMounted] = useState(false)
  const [bootKey, setBootKey] = useState(0)
  // Which attempt already has a request in flight. The token is single-use, so
  // a second redemption would fail for the wrong reason — this also keeps
  // React's StrictMode double effect from spending it twice.
  const startedFor = useRef(-1)

  useEffect(() => {
    if (startedFor.current === attempt) return
    startedFor.current = attempt
    // The token leaves the address bar BEFORE the request: it must not stay in
    // the history nor travel as a Referer. The retry keeps it in memory.
    clearLandingUrl()
    consumeMagicLink(token)
      .then(() => {
        // The session is live (cookies + access token adopted): the app boots
        // now and finds it. Remounting on a retry re-runs its boot.
        setAppMounted(true)
        setBootKey(k => k + 1)
        setPhase('ready')
      })
      .catch(() => {
        // Expired, already used, or no network. The app still mounts behind the
        // message — usable, and never a raw technical error on screen.
        setAppMounted(true)
        setPhase('error')
      })
  }, [attempt, token])

  const retry = () => {
    setPhase('checking')
    setAttempt(a => a + 1)
  }

  return (
    <>
      {appMounted && <App key={bootKey} />}

      {phase === 'checking' && (
        <div style={overlay} role="status" aria-live="polite">
          <span aria-hidden="true" style={{
            width: 26, height: 26, borderRadius: '50%',
            border: '2px solid var(--acc)', animation: 'ping 1.6s var(--ease) infinite'
          }} />
          <div className="t-head">{t('Verifying your access…')}</div>
        </div>
      )}

      {phase === 'error' && (
        <div style={overlay} role="alert">
          <div style={{ fontSize: 44, color: 'var(--acc)', display: 'flex' }}><Icon name="link" /></div>
          <h1 className="t-title2">{t('That link no longer works')}</h1>
          <p className="muted" style={{ maxWidth: 320, lineHeight: 1.45 }}>
            {t('Ask for a new one and we will send it right away — your account is still intact.')}
          </p>
          <div style={actions}>
            <Button variant="primary" onClick={() => setPhase('ready')}>{t('Back to sign in')}</Button>
            <Button variant="ghost" className="dim" onClick={retry}>{t('Try again')}</Button>
          </div>
        </div>
      )}
    </>
  )
}
