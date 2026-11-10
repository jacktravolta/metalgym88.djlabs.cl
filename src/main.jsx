import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Landing from './views/Landing.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang } from './lib/i18n.js'
import { readLanding } from './lib/platform/landing.js'
import { appRootUrl, isAppRoot } from './lib/platform/app-root.js'
import MagicLinkLanding from './components/MagicLinkLanding.jsx'
import './index.css'

// The email sign-in link lands on /auth/verify?token=… — a path this
// hash-router app does not know. The boot reads the token off the URL and hands
// the screen over to the landing, which redeems it and then mounts the app.
const landing = readLanding(window.location)

// The bare app root is the PRODUCT landing (what the app is and why it is worth
// trying). The app itself lives behind the hash router (#/home, #/plan…), so a
// visitor who opens the app root gets the front door and a visitor who already
// chose a route gets the app — no redirect, no flash.
//
// The app root is the directory the app is published in: '/' on a subdomain,
// '/<prefix>/' on a static host that serves it under a path (GitHub Pages).
const onRoot = isAppRoot(window.location.pathname) && !window.location.hash
const showLanding = !landing && onRoot

// The language pack loads before the first paint: Spanish is the default, so
// the app must never flash the English source strings for a frame. A user who
// chose another language switches as soon as their stored preference is read.
setLang('es').finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>{landing ? <MagicLinkLanding token={landing.token} /> : showLanding ? <Landing /> : <App />}</StrictMode>
  )
})

// Not in the mobile build: the native shell already serves everything from disk.
// Resolved against the app root: the worker has to live in the directory the
// app is published in (the site root on a subdomain, the prefix on a static
// host), or it would install with a scope that covers nothing.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(new URL('sw.js', appRootUrl()).href).catch(() => {})
}
