import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { setLang } from './lib/i18n.js'
import './index.css'

// The language pack loads before the first paint: Spanish is the default, so
// the app must never flash the English source strings for a frame. A user who
// chose another language switches as soon as their stored preference is read.
setLang('es').finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode><App /></StrictMode>
  )
})

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
