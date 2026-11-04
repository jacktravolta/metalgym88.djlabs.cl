import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Day/night switch, one tap away. The glyph shows the theme you would move TO
// (sun while the app is dark), so the button always says what it does next.
// The theme itself is applied by App.jsx through applyPrefs — this only flips
// the preference in the store.
export default function ThemeToggle({ className = '' }) {
  const theme = useStore(s => s.S.theme)
  const update = useStore(s => s.update)
  const light = theme === 'light'
  const label = light ? t('Dark theme') : t('Light theme')
  return (
    <button
      className={'iconbtn' + (className ? ' ' + className : '')}
      onClick={() => update(s => { s.theme = s.theme === 'light' ? 'dark' : 'light' })}
      aria-label={label}
      title={label}
    >
      <Icon name={light ? 'moon' : 'sun'} />
    </button>
  )
}
