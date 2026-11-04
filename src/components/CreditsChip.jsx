import { useStore } from '../store/useStore.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { openWallet } from './Wallet.jsx'

// The credit balance, always on screen.
//
// The coach spends credits, so the person should never have to open the wallet
// to find out what is left: the number sits in the app's own chrome (the rail
// on the desktop, the bar on the phone), on every screen. Tapping it opens the
// wallet, which is where a top-up happens.
//
// Guests and the demo build have no platform wallet, so the chip stays out of
// their way entirely — an em dash with nowhere to go would only be noise.
export default function CreditsChip({ className = '' }) {
  const user = useStore(s => s.user)
  const balance = useStore(s => s.balance)
  if (!user) return null
  const text = balance == null ? '—' : fmtNum(balance)
  const label = `${text} ${t('credits available')}`
  return (
    <button
      className={'credits-chip' + (className ? ' ' + className : '')}
      onClick={() => openWallet()}
      aria-label={label}
      title={label}
    >
      <Icon name="wallet" />
      <span className="credits-num">{text}</span>
    </button>
  )
}
