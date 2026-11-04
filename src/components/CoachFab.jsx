// The floating AI coach — one tap from anywhere in the app.
//
// It shows only where the coach can actually answer: a signed-in platform account.
// Guests, the demo build and the mobile build have no platform account, so the button
// would open a panel that can never reply — it stays out of their way entirely.
//
// The button opens the coach; openAssistant() captures the context of the screen the
// user is on at that exact moment, so this component does not need to know anything
// about the page it floats over.
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import { openAssistant } from './Assistant.jsx'
import Icon from './Icon.jsx'

export default function CoachFab() {
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (MOBILE || DEMO || !user || isGuest) return null
  return (
    <button id="coach-fab" onClick={openAssistant} aria-label={t('Ask the AI coach')} title={t('Ask the AI coach')}>
      <Icon name="sparkles" />
    </button>
  )
}
