import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang } from './lib/i18n.js'
import { readLanding } from './lib/platform/landing.js'
import MagicLinkLanding from './components/MagicLinkLanding.jsx'
import './index.css'

// The email sign-in link lands on /auth/verify?token=… — a path this
// hash-router app does not know. The boot reads the token off the URL and hands
// the screen over to the landing, which redeems it and then mounts the app.
const landing = readLanding(window.location)

// The language pack loads before the first paint: Spanish is the default, so
// the app must never flash the English source strings for a frame. A user who
// chose another language switches as soon as their stored preference is read.
setLang('es').finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>{landing ? <MagicLinkLanding token={landing.token} /> : <App />}</StrictMode>
  )
})

// Not in the mobile build: the native shell already serves everything from disk.
// Absolute path: on a deep route (the magic-link landing) 'sw.js' would resolve
// to /auth/sw.js and the worker would never install.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
