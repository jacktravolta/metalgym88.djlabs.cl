import { useStore } from '../store/useStore.js'
import AuthPanel from '../components/AuthForms.jsx'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { Button } from '../components/ui.jsx'

export default function Login() {
  const { setGuest } = useStore()
  const head = <>
    {/* The official badge instead of a generic glyph: the title below it
        already names the product, so the image itself stays decorative. */}
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <img src="logo.jpg" alt="" width={76} height={76} style={{ width: 76, height: 76, borderRadius: '50%' }} />
    </div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>metalgym88</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div style={{ maxWidth: 340, margin: '0 auto 40px', textAlign: 'left' }}>
        <AuthPanel mode="signin" close={() => { /* the gate re-renders as soon as a user exists */ }} />
      </div>
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('One account works across the djlabs apps — each keeps its own data.')}<br />{t('Or use metalgym88 without an account, everything stays on this device.')}</div>
    </div>
  )
}

