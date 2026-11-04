// Where the theme preference lives, and how to change it safely.
//
// The app keeps its whole state in ONE localStorage entry ('gym_state_v1') and the
// theme is part of it — so anything that changes the theme has to touch that entry
// WITHOUT dropping the rest of it. These helpers are the one place that knows the
// shape of that entry, so the app and the landing can never disagree about where
// the preference lives.
//
// The landing is the reason this is a module: it is served on its own, before the
// app ever boots, and it still has to honour — and change — the saved theme.

export const STATE_KEY = 'gym_state_v1'

// The saved preference, or null when there is nothing usable stored.
export const readStoredTheme = () => {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    const state = JSON.parse(raw)
    const theme = state && state.theme
    return theme === 'light' || theme === 'dark' ? theme : null
  } catch (e) { return null }
}

// Writes the theme into the stored state and NOTHING else: the person's plan,
// history and body weight stay exactly as they were. A state that does not exist
// yet gets a minimal one — the app merges it over its own defaults.
export const saveStoredTheme = theme => {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    const state = raw ? JSON.parse(raw) : {}
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false
    state.theme = theme === 'light' ? 'light' : 'dark'
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
    return true
  } catch (e) { return false }
}

// The attribute every stylesheet keys on, plus the browser chrome colour.
export const applyTheme = theme => {
  const dark = theme !== 'light'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = dark ? '#000000' : '#f2f2f7'
}
