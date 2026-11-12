import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ, fmtNum } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { IS_ANDROID } from '../lib/device.js'
import AuthPanel from '../components/AuthForms.jsx'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder } from '../lib/mobile.js'
import { openWallet } from '../components/Wallet.jsx'
import { AssistantRow } from '../components/Assistant.jsx'
import Avatar from '../components/Avatar.jsx'
import { updateProfile, fetchNotificationPrefs, updateNotificationPrefs, isChannelEnabled, canUseWhatsApp } from '../lib/platform/profile.js'
import { loadStarterPlan, confirmSheet, importFromApp } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const balance = useStore(s => s.balance)
  const { update, replaceState, setUser, pullState, pushState, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  // The same panels as the sign-in view, reached from Settings while browsing as a guest.
  const signInHere = () => useUI.getState().openSheet(close => <AuthPanel mode="signin" close={close} />)
  const registerHere = () => useUI.getState().openSheet(close => <AuthPanel mode="register" close={close} />)
  // Ends the session on this device. On failure nothing local is touched: still signed in
  // here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this session out, including on this device. Your account and data are kept — sign in again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out. Sign in again anytime.')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
    <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
      {MOBILE ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        <Row icon="personCircle" iconTint="var(--grey)" title={user.name || user.email} subtitle={t('Signed in — your data syncs to this profile.')} />
        {/* Platform wallet: AI credits, movements and top-up (guest/demo/mobile have no
            platform account, so the row only exists for signed-in users). */}
        <Row icon="wallet" iconTint="var(--acc)" title={t('Wallet')}
          subtitle={balance != null ? t(balance === 1 ? '{0} credit available' : '{0} credits available', fmtNum(balance)) : t('AI credits and top-ups')}
          accessory="chevron" onClick={openWallet} />
        {/* The paid feature itself; renders itself disabled with an honest line when offline. */}
        <AssistantRow />
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this session, including on this device. Your account and data are kept.')} danger onClick={signOutEverywhere} />
      </> : <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create account')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in')} accessory="chevron" onClick={signInHere} />
      </>}
    </Section>
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- the platform account: who you are and how it reaches you ----------
        Signed-in people only: the demo and the mobile build have no platform
        account to talk to (same rule the wallet and the assistant follow). */}
    {user && !DEMO && !MOBILE && <>
      <ProfileCard user={user} setUser={setUser} toast={toast} />
      <AccountAlertsCard user={user} toast={toast} />
    </>}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Note: switching units only changes the label — logged numbers are not converted.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'en'} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {/* The workout-day reminder is a native local notification (mobile build only) —
        the Web Push card that used to sit here belonged to the legacy self-hosted
        API, which no longer exists. */}
    {MOBILE && <MobileReminderCard S={S} update={update} toast={toast} />}

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan (PPL)')} accessory="chevron" onClick={loadStarterPlan} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install metalgym88 as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      openGym · {t('free & open source (AGPL v3)')}<br />
      <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">source code</a> · exercise data: hasaneyldrm/exercises-dataset (CC)
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

/* ============================ the platform account ============================ */

// Who the person is on the platform: the name, the email the account was
// created with and the phone used for WhatsApp alerts.
//
// The email is READ-ONLY on purpose — the platform does not change it from
// here, and pretending otherwise would only send people to a dead end. The
// phone is optional: leaving it empty removes the stored number.
function ProfileCard({ user, setUser, toast }) {
  const [name, setName] = useState(user.name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [avatarVersion, setAvatarVersion] = useState(0)

  // The photo: the server is the source of truth, so what it answered (the
  // path, or nothing after a removal) is what the store holds. The version
  // busts the browser's cache of the photo.
  const onAvatarChanged = (path, version) => {
    setUser({ ...user, avatar: path || null })
    setAvatarVersion(version || 0)
  }

  const save = async ev => {
    ev.preventDefault()
    if (saving) return
    const cleanName = name.trim()
    // The platform validates this too; catching the obvious case here only
    // saves a round trip and keeps the message in the app's own voice.
    if (cleanName.length < 2 || cleanName.length > 100) {
      setErr(t('Your name must be between 2 and 100 characters.'))
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const saved = await updateProfile({ name: cleanName, phone: phone.trim() })
      // The server is the source of truth: what it answered is what the form
      // and the store now hold.
      const next = { ...user, ...(saved || {}) }
      setUser(next)
      setName(next.name || '')
      setPhone(next.phone || '')
      toast(t('Profile saved'))
    } catch (e) {
      // The platform answers in Spanish and says what to correct: show it as
      // it came, and keep what the person typed.
      setErr(e.message || t('Could not save your profile'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t('Your profile')}>
      <div style={{ padding: '14px 14px 0' }}>
        <Avatar user={user} version={avatarVersion} onChanged={onAvatarChanged} toast={toast} />
      </div>
      <form onSubmit={save} noValidate>
        <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
          <label className="lrow-t" htmlFor="profile-name">{t('Name')}</label>
          <TextField id="profile-name" value={name} maxLength={100} autoComplete="name"
            onChange={e => setName(e.target.value)} />
        </div>
        <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
          <span className="lrow-t">{t('Email')}</span>
          <span style={{ fontSize: 16, color: 'var(--label-2)', wordBreak: 'break-all' }}>{user.email || '—'}</span>
          <span className="lrow-s">{t('This is the email you registered with — it cannot be changed here.')}</span>
        </div>
        <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
          <label className="lrow-t" htmlFor="profile-phone">{t('Phone')}</label>
          <TextField id="profile-phone" value={phone} type="tel" inputMode="tel" maxLength={24}
            autoComplete="tel" placeholder="+56 9 1234 5678"
            onChange={e => setPhone(e.target.value)} />
          <span className="lrow-s">{t('Only for WhatsApp alerts. Leave it empty to remove it.')}</span>
        </div>
        {err && <div className="dim small" role="alert" style={{ padding: '12px 14px 0' }}>{err}</div>}
        <div style={{ padding: 14 }}>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </form>
    </Section>
  )
}

// How the platform may reach this person: email and WhatsApp. These are NOT
// the training reminders — those live in the Notifications card and never
// leave this device.
//
// Every switch is saved the moment it moves, and it only moves when the
// server confirmed it: a refused save leaves the switch exactly where it was.
function AccountAlertsCard({ user, toast }) {
  const [prefs, setPrefs] = useState(null)   // null = still asking the platform
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState({}) // channel -> a save is on its way

  useEffect(() => {
    let alive = true
    fetchNotificationPrefs()
      .then(p => { if (alive) setPrefs(p) })
      .catch(() => { if (alive) { setPrefs({}); setLoadFailed(true) } })
    return () => { alive = false }
  }, [])

  // A channel with no stored row reads as ENABLED on the platform.
  const mailOn = isChannelEnabled(prefs, 'NotMail')
  const hasPhone = canUseWhatsApp(user)
  // Without a number the platform has no way to reach WhatsApp, so the switch
  // stays off and disabled until a phone is saved above.
  const wspOn = hasPhone && isChannelEnabled(prefs, 'NotWsp')

  const toggle = async (channel, next) => {
    if (pending[channel]) return
    setPending(p => ({ ...p, [channel]: true }))
    try {
      const saved = await updateNotificationPrefs({ [channel]: next })
      // Only what the server confirmed moves the switch.
      setPrefs(p => ({ ...(p || {}), ...(saved || {}) }))
    } catch (e) {
      // The switch keeps the value it had: the server never said otherwise.
      toast(e.message || t('Could not save your preference'))
    } finally {
      setPending(p => { const rest = { ...p }; delete rest[channel]; return rest })
    }
  }

  return (
    <Section title={t('Account alerts')}
      footer={t('These alerts are about your account. Training reminders are in the Notifications card.')}>
      {prefs === null ? (
        <div className="lrow"><span className="lrow-m"><span className="lrow-s">{t('Loading…')}</span></span></div>
      ) : <>
        {loadFailed && (
          <div className="dim small" role="alert" style={{ padding: '12px 14px 0' }}>
            {t('We could not load your alert settings. Try again in a moment.')}
          </div>
        )}
        <Row icon="bell" iconTint="var(--blue)" title={t('Email alerts')}
          subtitle={t('Messages about your account, like your credits.')}>
          <Switch checked={mailOn} disabled={!!pending.NotMail} onChange={v => toggle('NotMail', v)} />
        </Row>
        <Row icon="chat" iconTint="var(--green)" title={t('WhatsApp alerts')}
          subtitle={hasPhone ? null : t('Add your phone above to receive alerts by WhatsApp.')}>
          <Switch checked={wspOn} disabled={!hasPhone || !!pending.NotWsp} onChange={v => toggle('NotWsp', v)} />
        </Row>
      </>}
    </Section>
  )
}

