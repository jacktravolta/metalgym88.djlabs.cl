import { useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { uploadAvatar, removeAvatar, avatarUrl, AVATAR_MAX_BYTES, AVATAR_TYPES } from '../lib/platform/avatar.js'
import { Button } from './ui.jsx'

// The profile photo: the picture, or the initials while there is none.
//
// The photo is personal data, so the API serves it only to its owner — the
// browser proves who it is with the session cookie the platform already sets,
// and the picture itself carries no token. Every upload is re-encoded by the
// server (at most 256 px, without the EXIF of the original).

// Two letters, the way a name reads: "Juan Pérez" → "JP", "Ana" → "AN".
const initialsOf = name => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0].charAt(0)
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0].charAt(1)
  return (first + (second || '')).toUpperCase()
}

export default function Avatar({ user, version, onChanged, toast }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const userId = (user && user.id) || ''
  const name = (user && user.name) || ''
  // The API says whether the photo exists (user.avatar); the version busts the
  // browser cache after a new upload.
  const hasPhoto = !!(user && user.avatar) && !failed
  const url = hasPhoto ? avatarUrl(userId, version) : ''

  const pick = () => { if (!busy && inputRef.current) inputRef.current.click() }

  const onFile = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // the same file can be picked again
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      toast(t('That file is not a supported image. Choose a JPG, PNG or WebP.'))
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast(t('The photo is over 2 MB. A smaller image is enough to look sharp.'))
      return
    }
    setBusy(true)
    try {
      const path = await uploadAvatar(file)
      setFailed(false)
      if (onChanged) onChanged(path, Date.now())
      toast(t('Photo updated'))
    } catch (err) {
      toast(err.message || t('We could not save the photo. Try again in a moment.'))
    }
    setBusy(false)
  }

  const remove = async () => {
    setBusy(true)
    try {
      await removeAvatar()
      setFailed(true)
      if (onChanged) onChanged(null, Date.now())
      toast(t('Photo removed'))
    } catch (err) {
      toast(err.message || t('We could not remove the photo. Try again in a moment.'))
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <div
        aria-hidden="true"
        style={{
          width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', flex: '0 0 auto',
          background: 'var(--acc)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 32, letterSpacing: '.5px',
        }}
      >
        {hasPhoto
          ? <img src={url} alt="" width="96" height="96" style={{ objectFit: 'cover', width: '100%', height: '100%' }}
              onError={() => setFailed(true)} />
          : initialsOf(name)}
      </div>
      <div style={{ minWidth: 0 }}>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={onFile} aria-hidden="true" tabIndex={-1} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={pick} disabled={busy} icon="upload">
            {t('Change photo')}
          </Button>
          {hasPhoto && (
            <Button variant="ghost" className="dim" onClick={remove} disabled={busy}>
              {t('Remove photo')}
            </Button>
          )}
        </div>
        <div className="muted small" style={{ marginTop: 6, lineHeight: 1.45 }}>
          {t('A JPG, PNG or WebP of up to 2 MB. It is resized and stripped of its metadata on our side.')}
        </div>
      </div>
    </div>
  )
}
