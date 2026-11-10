import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import CreditsChip from './CreditsChip.jsx'

// The rail (desktop) carries its own History and Settings entries; the phone bar
// doesn't. Which entry is lit depends on the layout, so the viewport decides —
// without this, /history would light both Stats and History on desktop.
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width:1000px)').matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width:1000px)')
    const on = e => setWide(e.matches)
    setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const wide = useWide()
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => {
    if (cur === k) return true
    // History and Settings have their own entries in the rail; on the phone they
    // are reached from Stats and Home, which stay lit instead.
    if (cur === 'history') return !wide && k === 'stats'
    if (cur === 'settings') return !wide && k === 'home'
    return false
  }

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label, className = '' }) => (
    <button className={(on(k) ? 'on ' : '') + className} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      {/* The official badge next to the name: the rail shows the brand, not
          just a name. The image is decorative — the wordmark names it. */}
      <div className="rail-brand">
        <img className="rail-logo" src="logo.jpg" alt="" width={24} height={24} />
        <span>metalgym88</span>
        {/* Desktop chrome only — the phone bar keeps its five items exactly.
            It sits inside the brand row, which the phone layout hides. */}
        <ThemeToggle className="rail-only" />
      </div>
      {/* The credit balance, always visible: on the rail it sits under the
          brand, on the phone it is the last item of the bottom bar. */}
      <div className="rail-credits"><CreditsChip /></div>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
      <Tab className="rail-only rail-end" k="history" icon="history" to="/history" label={t('History')} />
      <Tab className="rail-only" k="settings" icon="gear" to="/settings" label={t('Settings')} />
      <CreditsChip className="phone-credits" />
    </nav>
  )
}
