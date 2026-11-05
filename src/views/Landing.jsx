// metalgym88 landing — the product page, in the app's own skin (black + green).
//
// It is NOT a copy of the platform's landing: it sells THIS product (a gym
// companion), shows the real catalogue (the exercise animations the app ships)
// and speaks the same tone the product uses everywhere else: clear, warm, no
// pressure and no dark patterns.
//
// Three things live here that the app itself does not have:
//   · a registration surface (name + email → the platform's magic-link access,
//     the same passwordless entry the app uses);
//   · a contact form that writes to the platform's /contact endpoint;
//   · a WhatsApp button (hidden while its number is not configured — a dead
//     wa.me link would be worse than no button).
//
// The copy is plain Spanish on purpose: this is the product's front door, in
// the product's default language, and it never has to negotiate the app's
// language pack to be read.
import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { EXIDX, gifSrc } from '../lib/exercises.js'
import { apiUrl } from '../lib/platform/config.js'
import { requestMagicLink, me as platformMe } from '../lib/platform/auth.js'
import { phttp } from '../lib/platform/http.js'
import { t } from '../lib/i18n.js'
import { readStoredTheme, saveStoredTheme, applyTheme } from '../lib/theme.js'
import { useStore } from '../store/useStore.js'
import '../landing.css'

/* The WhatsApp number of the metalgym88 line (owner-confirmed on 2026-11-04).
   The link strips everything that is not a digit, so the format here is only
   for the humans reading the code. */
export const WHATSAPP_NUMBER = '+56 9 8806 8917'

const SHOWCASE = [
  { id: '0025', caption: 'Press banca con barra' },
  { id: '2330', caption: 'Jalón al pecho en polea' },
  { id: '0043', caption: 'Sentadilla completa con barra' },
]

const STEPS = [
  {
    h: 'Crea tu cuenta',
    p: 'Tu nombre y tu correo. Te llega un enlace de acceso: sin contraseñas que se te olviden ni que alguien adivine.',
  },
  {
    h: 'Carga tu rutina',
    p: 'El plan inicial de empuje, tirón y piernas, o armas la tuya desde cero con el editor de rutinas.',
  },
  {
    h: 'Entrena',
    p: 'Mil trescientas veinticuatro ejercicios con animación, temporizador de descanso y registro de cada serie.',
  },
  {
    h: 'Mide tu progreso',
    p: 'Peso corporal, rachas, historial por fecha. Y si quieres, le preguntas al coach IA qué hiciste el lunes.',
  },
]

const FEATURES = [
  {
    icon: 'dumbbell',
    h: 'Biblioteca con animación',
    p: 'Cada ejercicio viene con imagen y animación, para que veas el movimiento antes de intentarlo.',
  },
  {
    icon: 'clipboard',
    h: 'Planes que se adaptan',
    p: 'Edita rutinas, reparte los días de la semana y ajusta series, repeticiones y peso a tu medida.',
  },
  {
    icon: 'chart',
    h: 'Progreso que se ve',
    p: 'Peso corporal, racha semanal, entrenamientos y un historial que responde por día: nada queda en el aire.',
  },
  {
    icon: 'sparkles',
    h: 'Coach IA contextual',
    p: 'Un ícono flotante en cada pantalla. Pregunta y responde con lo que estás viendo en ese momento, no en general.',
  },
  {
    icon: 'wallet',
    h: 'Billetera en créditos',
    p: 'Los créditos pagan las preguntas del coach. El plan, la biblioteca y el historial siguen siendo gratis.',
  },
  {
    icon: 'lock',
    h: 'Tus datos, tu cuenta',
    p: 'Cada producto guarda sus datos por separado. Tus registros de entrenamiento se sincronizan con tu perfil, no con los de otros productos.',
  },
]

const PACKS = [1000, 2000, 5000, 10000]

const fmtCLP = n => n.toLocaleString('es-CL')

/* ------------------------------------------------------------------ forms -- */

function RegisterCard({ loggedIn }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [terms, setTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  // 'register' (new account) or 'login' (the account already exists): both end
  // in the same passwordless link, but the promise made to the person is not
  // the same — a login does not hand out the welcome credits again.
  const [mode, setMode] = useState('register')
  const [err, setErr] = useState(null)

  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const n = name.trim()
    const mail = email.trim()
    if (!n || !mail) { setErr('Escribe tu nombre y tu correo para continuar.'); return }
    if (!terms) { setErr('Necesitamos que aceptes los Términos y Condiciones para continuar.'); return }
    setBusy(true); setErr(null)
    try {
      // The platform's passwordless entry: the account is created (or found)
      // and the access link travels by email. Same contract the app uses.
      await requestMagicLink(mail, { terms: true, name: n })
      setMode('register')
      setSent(true)
    } catch (e) {
      setErr((e && e.message) || 'No pudimos enviar el enlace ahora. Inténtalo en un momento, por favor.')
    }
    setBusy(false)
  }

  // The account already exists: the same passwordless entry, without a name
  // and without the welcome credits again (those are only for a fresh
  // account). The platform asks for the Terms acceptance on every access
  // request, so it travels from the checkbox above — the front never consents
  // on the person's behalf.
  const loginSubmit = async () => {
    if (busy) return
    const mail = email.trim()
    if (!mail) { setErr('Escribe tu correo y te enviamos el enlace para entrar.'); return }
    if (!terms) { setErr('Para enviarte el enlace necesitamos que aceptes los Términos y Condiciones.'); return }
    setBusy(true); setErr(null)
    try {
      await requestMagicLink(mail, { terms: true })
      setMode('login')
      setSent(true)
    } catch (e) {
      setErr((e && e.message) || 'No pudimos enviar el enlace ahora. Inténtalo en un momento, por favor.')
    }
    setBusy(false)
  }

  if (sent) {
    return (
      <div className="lg-panel">
        <h3>Revisa tu correo</h3>
        <p className="sub">
          Si <strong>{email.trim()}</strong> está en el sistema, ya tienes un enlace de acceso esperándote.
          Vence en unos minutos y funciona con un solo toque: sin contraseñas.
        </p>
        <p className="lg-msg ok">
          {mode === 'login'
            ? 'Con ese enlace entras directo a tu panel. Si tu cuenta ya estaba activa, vuelves a donde la dejaste.'
            : 'Te acreditamos 100 créditos de bienvenida al confirmar tu correo. Con ellos puedes preguntarle al coach IA lo que quieras sobre tu entrenamiento.'}
        </p>
        {loggedIn && (
          <a className="lg-btn ghost block" style={{ marginTop: 14 }} href="/index.html#/home">
            Ir a mi panel
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="lg-panel">
      <h3>Crea tu cuenta</h3>
      <p className="sub">
        Gratis y sin tarjeta. Solo usamos tu correo para enviarte el acceso y para responderte si nos escribes.
      </p>
      <form onSubmit={submit} noValidate>
        <label className="lg-field">
          <span>¿Cómo te llamamos?</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={40}
            autoComplete="name"
          />
        </label>
        <label className="lg-field">
          <span>Tu correo</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu@correo.cl"
            autoComplete="email"
          />
        </label>
        <label className="lg-check">
          <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} />
          <span>
            Acepto los{' '}
            <a href={apiUrl('/terminos')} target="_blank" rel="noreferrer">Términos y Condiciones</a> y la{' '}
            <a href={apiUrl('/privacidad')} target="_blank" rel="noreferrer">Política de Privacidad</a>.
          </span>
        </label>
        {err && <p className="lg-msg err">{err}</p>}
        <button className="lg-btn primary block" type="submit" disabled={busy}>
          {busy ? 'Enviando…' : 'Crear mi cuenta gratis'}
        </button>
        <p className="lg-note" style={{ textAlign: 'center', marginTop: 14, marginBottom: 8 }}>
          ¿Ya tienes cuenta? Te enviamos el mismo enlace de acceso, sin contraseñas.
        </p>
        <button className="lg-btn ghost block" type="button" onClick={loginSubmit} disabled={busy}>
          {busy ? 'Enviando…' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  )
}

function ContactCard() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState(null)

  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    if (!name.trim() || !email.trim() || !message.trim()) {
      setState({ ok: false, text: 'Completa tu nombre, tu correo y el mensaje para que podamos responderte.' })
      return
    }
    setBusy(true); setState(null)
    try {
      const res = await phttp('/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          website: website.trim(),
        }),
      })
      const msg = (res && res.data && res.data.message) || null
      setState({ ok: true, text: msg || 'Gracias. Recibimos tu mensaje; te responderemos por correo, con calma.' })
      setName(''); setEmail(''); setMessage(''); setWebsite('')
    } catch (e) {
      setState({
        ok: false,
        text: (e && e.message) || 'No pudimos registrar tu mensaje ahora. Inténtalo en un momento, por favor.',
      })
    }
    setBusy(false)
  }

  return (
    <div className="lg-panel">
      <h3>Escríbenos</h3>
      <p className="sub">
        Cuéntanos qué necesitas; respondemos con calma y sin tecnicismos. Si prefieres WhatsApp, también
        estamos ahí.
      </p>
      <form onSubmit={submit} noValidate>
        <label className="lg-field">
          <span>Nombre</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="¿Cómo te llamas?" maxLength={255} autoComplete="name" />
        </label>
        <label className="lg-field">
          <span>Correo</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.cl" autoComplete="email" />
        </label>
        <label className="lg-field">
          <span>Mensaje</span>
          <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Cuéntanos en qué te podemos ayudar." maxLength={5000} />
        </label>
        {/* Honeypot: a real person never fills this one. */}
        <div className="lg-hp" aria-hidden="true">
          <label>
            No completar este campo
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
          </label>
        </div>
        {state && <p className={'lg-msg ' + (state.ok ? 'ok' : 'err')}>{state.text}</p>}
        <button className="lg-btn primary block" type="submit" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar mensaje'}
        </button>
      </form>
    </div>
  )
}

/* ---------------------------------------------------------------- landing -- */

// The landing's own day/night switch.
//
// The landing is served on its own, before the app boots, so it cannot lean on
// the app shell to apply the theme: it reads the saved preference, applies it to
// <html> right away and writes the choice back into the SAME stored state the
// app uses — changing the theme and nothing else, so the training log on that
// device is never touched.
function LandingThemeToggle() {
  const [theme, setTheme] = useState(() => readStoredTheme() || 'dark')
  const light = theme === 'light'
  const label = light ? t('Dark theme') : t('Light theme')
  const flip = () => {
    const next = light ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
    saveStoredTheme(next)
  }
  return (
    <button className="lg-theme" onClick={flip} aria-label={label} title={label}>
      <Icon name={light ? 'moon' : 'sun'} />
    </button>
  )
}

export default function Landing() {
  // The landing owns the whole viewport: the desktop rail offset is undone.
  useEffect(() => {
    document.body.classList.add('is-landing')
    return () => document.body.classList.remove('is-landing')
  }, [])

  // The phone menu: the nav links are hidden below 860px, so the header keeps
  // them behind a burger button. The panel is absolutely positioned by CSS,
  // so opening it never shifts the page layout.
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    // Tapping outside the header, or pressing Escape, closes the menu.
    const onPointerDown = ev => {
      if (!ev.target.closest?.('.lg-head')) setMenuOpen(false)
    }
    const onKeyDown = ev => {
      if (ev.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // Who is here: the store keeps the session in local storage, so the landing
  // knows who the person is before the app boots. A cached session can be
  // stale, so it is checked once against the platform: a button that leads to
  // a login wall is worse than no button at all.
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  useEffect(() => {
    if (!user) return
    let alive = true
    platformMe()
      .then(({ user: u }) => { if (alive && u) setUser(u) })
      .catch(e => { if (alive && e && e.status === 401) setUser(null) })
    return () => { alive = false }
  }, [])

  const showcase = SHOWCASE.map(s => ({ ...s, ex: EXIDX[s.id] })).filter(s => s.ex)
  const wspHref = WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER.replace(/[^\d]/g, '')}` : null
  const loggedIn = !!user

  return (
    <div className="landing">
      <header className="lg-head">
        <div className="lg-head-in">
          <div className="lg-brand">
            {/* The official badge, not a generic glyph: the wordmark beside it
                already names the product, so the image itself stays decorative. */}
            <img className="lg-logo" src="/logo.jpg" alt="" width={42} height={42} />
            <span>
              metalgym88
              <small>Tu entrenamiento</small>
            </span>
          </div>
          <nav id="lg-nav" className={'lg-nav' + (menuOpen ? ' open' : '')}>
            <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Cómo funciona</a>
            <a href="#que-incluye" onClick={() => setMenuOpen(false)}>Qué incluye</a>
            <a href="#creditos" onClick={() => setMenuOpen(false)}>Créditos</a>
            <a href="#contacto" onClick={() => setMenuOpen(false)}>Contacto</a>
          </nav>
          <div className="lg-head-cta">
            <LandingThemeToggle />
            {/* Narrow phones can't fit the full label next to logo + theme +
                burger: the pill wraps to three lines and overflows the bar,
                so the short label shows below 640px (CSS swaps them). */}
            {loggedIn ? (
              <a className="lg-btn ghost" href="/index.html#/home">
                <span className="lg-cta-wide">Entrar al panel</span>
                <span className="lg-cta-narrow">Entrar</span>
              </a>
            ) : (
              <a className="lg-btn ghost" href="#acceso">
                <span className="lg-cta-wide">Iniciar sesión</span>
                <span className="lg-cta-narrow">Iniciar</span>
              </a>
            )}
            {/* Phones only: three CSS bars, no icon dependency. */}
            <button
              type="button"
              className="lg-burger"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen}
              aria-controls="lg-nav"
              onClick={() => setMenuOpen(v => !v)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ------------------------------------------------------- hero -- */}
        <section className="lg-wrap lg-hero">
          <div>
            <span className="lg-eyebrow"><i />Entrenamiento en casa, con orden</span>
            <h1>
              Tu rutina, tu peso y tu coach
              <br />
              <em>en un solo lugar</em>
            </h1>
            <p className="lead">
              metalgym88 te acompaña con una biblioteca de ejercicios con animación, planes que se ajustan a
              tus días y un coach IA que responde sobre la pantalla que estás viendo. Regístrate gratis y
              llévate 100 créditos de bienvenida.
            </p>
            <div className="lg-cta">
              <a className="lg-btn primary" href="#acceso">Crear mi cuenta gratis</a>
              <a className="lg-btn ghost" href="#que-incluye">Ver qué incluye</a>
            </div>
            <p className="lg-note">
              Sin tarjeta para empezar · Acceso por enlace, sin contraseñas · La app funciona sin conexión y
              sincroniza cuando vuelves.
            </p>
          </div>

          <div className="lg-show">
            <div className="lg-show-grid">
              {showcase.map(s => (
                <figure key={s.id}>
                  <img src={gifSrc(s.ex)} alt={s.caption} loading="lazy" />
                  <figcaption>{s.caption}</figcaption>
                </figure>
              ))}
            </div>
            <div className="lg-show-bar">
              <Icon name="dumbbell" />
              <span>
                Hoy: <b>Día de empuje</b> · 6 ejercicios · temporizador de descanso listo
              </span>
              <span className="lg-chip">1.324 ejercicios</span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------- how it works -- */}
        <section id="como-funciona" className="lg-sec">
          <div className="lg-wrap">
            <div className="lg-sec-head">
              <h2>Cómo funciona</h2>
              <p className="sub">
                Cuatro pasos, sin letra chica: entrar, armar tu plan, entrenar y ver cómo vas. El resto lo
                hace la app por ti.
              </p>
            </div>
            <div className="lg-steps">
              {STEPS.map((s, i) => (
                <div className="lg-step" key={s.h}>
                  <div className="n">{i + 1}</div>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- what it has -- */}
        <section id="que-incluye" className="lg-sec">
          <div className="lg-wrap">
            <div className="lg-sec-head">
              <h2>Qué incluye</h2>
              <p className="sub">
                Todo lo que hace falta para entrenar en casa sin improvisar, y nada que te cobre por lo que
                no debería cobrarse.
              </p>
            </div>
            <div className="lg-cards">
              {FEATURES.map(f => (
                <div className="lg-card" key={f.h}>
                  <Icon name={f.icon} />
                  <h3>{f.h}</h3>
                  <p>{f.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ credits -- */}
        <section id="creditos" className="lg-sec">
          <div className="lg-wrap">
            <div className="lg-sec-head">
              <h2>Créditos, solo para el coach</h2>
              <p className="sub">
                Tu plan, tu biblioteca y tu historial son gratis y siempre. Los créditos pagan las preguntas
                al coach IA, y los recargas cuando quieras desde el panel.
              </p>
            </div>
            <div className="lg-packs">
              {PACKS.map(p => (
                <div className="lg-pack" key={p}>
                  <div className="amount">${fmtCLP(p)}</div>
                  <div className="what">Recarga desde el panel</div>
                </div>
              ))}
            </div>
            <div className="lg-cta">
              <a className="lg-btn primary" href="#acceso">Empezar gratis</a>
              {loggedIn ? (
                <a className="lg-btn ghost" href="/#/settings">Ver la billetera</a>
              ) : (
                <a className="lg-btn ghost" href="#que-incluye">Ver qué incluye</a>
              )}
            </div>
          </div>
        </section>

        {/* -------------------------------------------- signup and contact -- */}
        <section id="acceso" className="lg-sec">
          <div className="lg-wrap">
            <div className="lg-sec-head">
              <h2>Empieza hoy</h2>
              <p className="sub">
                Crear la cuenta es gratuito y toma menos de un minuto. Si después quieres preguntarnos algo,
                escríbenos: respondemos con calma.
              </p>
            </div>
            <div className="lg-panels">
              <RegisterCard loggedIn={loggedIn} />
              <div id="contacto" className="lg-contact">
                <ContactCard />
                <div className="lg-contact-side">
                  <div className="lg-contact-card">
                    <h3>WhatsApp</h3>
                    <p>
                      Si te acomoda más, escríbenos por WhatsApp. Te respondemos en horario de oficina, sin
                      automatizados y sin apuro.
                    </p>
                    {wspHref && (
                      <a className="lg-wsp" style={{ marginTop: 12 }} href={wspHref} target="_blank" rel="noreferrer">
                        <Icon name="chat" />
                        Escríbenos por WhatsApp
                      </a>
                    )}
                  </div>
                  <div className="lg-contact-card">
                    <h3>Correo</h3>
                    <p>
                      Para temas de tu cuenta, la bolsa de créditos o la plataforma:{' '}
                      <a href="mailto:contacto@djlabs.cl">contacto@djlabs.cl</a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lg-foot">
        <div className="lg-wrap lg-foot-in">
          <small>metalgym88 — Tu entrenamiento. Un producto djlabs.</small>
          <div className="lg-foot-links">
            <a href={apiUrl('/terminos')} target="_blank" rel="noreferrer">Términos y Condiciones</a>
            <a href={apiUrl('/privacidad')} target="_blank" rel="noreferrer">Privacidad</a>
            <a href="#contacto">Contacto</a>
            {loggedIn ? (
              <a href="/index.html#/home">Entrar al panel</a>
            ) : (
              <a href="#acceso">Iniciar sesión</a>
            )}
          </div>
        </div>
      </footer>

      {wspHref && (
        <a className="lg-wsp-float" href={wspHref} target="_blank" rel="noreferrer" aria-label="Escríbenos por WhatsApp">
          <Icon name="chat" />
        </a>
      )}
    </div>
  )
}
