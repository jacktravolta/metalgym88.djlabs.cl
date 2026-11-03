// Gym state sync against the djlabs platform document store (T3).
//
// Owner model: localStorage stays the client's source of truth — the platform only
// mirrors each user's state blob at storage/{userID}/dataGym.json (document store:
// parsers, not schema) through GET/PUT /opengym/data. A missing module, a connection
// problem or a stale mirror is never a data-loss event: the local copy stands, and the
// dirty flag forces a reconciliation push on the next successful sync.

// Single knob for where the state document lives on the platform. pushState and
// pullState both derive from it, so moving the heart-scoped route is a one-line change.
export const SYNC_DATA_PATH = '/opengym/data'

// The same "worth keeping?" discriminator the store has always used for its merges —
// at least one workout, routine or bodyweight entry. Re-homed here so the pull decision
// below and the store read from one source (the store re-exports it for its callers).
export const hasData = st =>
  !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// Response envelope: the backend stores the blob as-is, so a pull may answer either the
// documented wrapped shape `{ state: <blob> }` or the bare blob served at top level.
// Both are accepted so the platform's envelope can evolve without a breaking client
// release; anything that is not an object — or is not recognizably a state document —
// counts as "no server copy".
export function unwrapBlob(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.state !== undefined) {
    const s = raw.state
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null
  }
  const looksLikeBlob =
    raw._ts !== undefined || raw.workouts !== undefined ||
    raw.routines !== undefined || raw.bodyweight !== undefined
  return looksLikeBlob ? raw : null
}

// The pull decision, lifted verbatim from the store's pullState so it can be unit-tested
// in isolation. Last-write-wins by _ts; an empty local copy adopts the mirror whatever
// its timestamps; local data newer than the mirror wins; and the dirty flag overrides
// everything — unsynced local edits must never be silently replaced by the server copy.
export function decideSync(local, rawServer, dirty) {
  const remote = unwrapBlob(rawServer)
  if (remote && (!hasData(local) || ((remote._ts || 0) >= (local._ts || 0) && !dirty))) {
    return { action: 'adopt', state: remote }
  }
  if (hasData(local)) return { action: 'push' }
  return { action: 'none' }
}
