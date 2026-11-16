# Offline first: catálogo, sesión y coach sin internet

> **Estado: EN COLA.** Requerimiento analizado, diseño trazado. No implementado.
> Se ejecuta después del OK del owner y de cerrar el trabajo en curso del coach.

## Objective

Que metalgym88 abra, funcione y accompany a la persona **sin internet**, con
sus mismas credenciales, y que el coach no pierda ni una pregunta: la guarda,
la responde cuando vuelve la conexión, y la persona ve la respuesta en el
chat.

## What already exists (this is NOT a greenfield feature)

| Piece | Where | State |
| --- | --- | --- |
| Service worker | `public/sw.js` | exists, registered in `src/main.jsx:40` (HTTPS only, not in the mobile build). Runtime caching: `img/`+`gif/` cache-first, the rest network-first with an `index.html` fallback |
| PWA manifest | `public/manifest.json` | exists: standalone, icons 180/512, `start_url: ./` |
| Guest mode | `src/views/Home.jsx:29`, `src/views/Login.jsx:22`, `src/views/Settings.jsx:57` | **already exists** ("Modo invitado — los datos viven solo en este navegador") |
| localStorage-first data | `src/store/sync.js` | localStorage is the source of truth; the platform only mirrors it; a dirty flag forces a reconciliation push on the next successful sync |
| App shell | `vite.config.js` | relative asset URLs (`base: './'`) + a `<base>` element + a 404.html copy for hosts without SPA fallback |

## The real gaps (what the requirement actually needs)

### G1 — The catalog media is never cached (the reason the catalog is empty offline)

`src/lib/exercises.js:45-47` serves the media from an EXTERNAL CDN:

```js
const DATASET_CDN = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae...'
const IMG_BASE = import.meta.env.VITE_IMG_BASE || DATASET_CDN + '/images/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || DATASET_CDN + '/videos/'
```

and `public/sw.js:20` ignores every request that is not same-origin:

```js
if (e.request.method !== 'GET' || url.origin !== location.origin) return
```

So the 1324 images and 1324 GIFs are **never** in the cache. The SW's
`img/`+`gif/` cache-first branch only covers same-origin paths that do not
exist. Offline → no image, no GIF.

### G2 — There is no precache: the shell only exists after a runtime visit

`public/sw.js:12` installs with `skipWaiting()` and caches **nothing** at
install time. The shell (index.html + the hashed JS/CSS) is cached as a side
effect of a normal visit. A person who installs the app and immediately loses
signal gets a **blank page**, not the app.

### G3 — The offline boot must not depend on the API

The boot (`src/App.jsx:125-126`, `boot()`) talks to the platform. Offline, the
session layer must NOT kill the session (the new transient/rejected split in
`src/lib/platform/http.js` is what makes that possible) and the app must fall
back to the **cached profile** (see G4) or to the guest profile.

### G4 — "With the same credentials" needs a cached profile

`src/lib/platform/http.js` keeps the access token **in memory only** and the
refresh cookie is httpOnly: an offline boot cannot know who the person is.
The app must persist a MINIMAL profile (id, name, email) locally on every
successful `/auth/me`, read it when the API is unreachable, and clear it on
sign-out. (PII in the browser: same device, same store that already holds the
workouts — but it must be explicit, minimal and erasable.)

### G5 — The coach loses the question when the network is down

`askAssistant` (`src/lib/platform/assistant.js`) fails → the person sees an
error and the question is gone. It must be queued instead (see the design).

### G6 — Preload UX: logo + progress bar, only when needed

The owner asks for the metalgym88 logo with a progress bar on the first run,
then the index — **only** when what offline needs is not cached yet. The
progress must be real (the SW reports what it precached), not a fake timer.

## The sizing problem (the decisive number)

The catalog index (`src/lib/exercises-data.js`) is **888 KB** and carries
**1324 exercises**, each with an `img` and a `gif` → **2648 media files**.
The GIFs live in the dataset's `/videos/` path: precaching all of them is
hundreds of megabytes to gigabytes. **A full precache is not viable.**

Therefore the design is:

- **Precache (the preload screen):** the app shell only — `index.html`, the
  hashed JS/CSS, the manifest, the icons, the logo. Small (a few hundred KB)
  and enough for the app to BOOT offline.
- **Media: cache-as-you-view, with a budget.** The SW caches the CDN media
  cache-first (as it already does for same-origin media) and keeps a bounded
  LRU (a Storage-API quota check + an eviction rule). The images the person
  has already seen work offline.
- **An explicit "download for offline" action** in Settings for the catalog
  (per exercise, or a curated pack) — the person's choice, not a surprise
  download on a metered connection.

## The design (as it would be implemented)

### API (api-independent) — nothing to change here

The platform's role in this feature is to answer when there is a connection.
The queued coach question is sent to the existing `/opengym/ai` route.

### Front (metalgym88.djlabs.cl)

**1. `public/sw.js` — extend, do not replace**
- Allow the dataset CDN origin in the media branch (an explicit allowlist,
  never a wildcard).
- A precache manifest: a tiny Vite plugin (or a post-build step) that writes
  the built asset list into the SW, so the shell is precached at install time
  with a version marker (`CACHE = 'metalgym88-vN'`).
- A bounded media cache (LRU with a quota check) + an explicit
  `CACHE_MEDIA` message handler for the "download for offline" action.
- A `PRECACHE_PROGRESS` message so the page can draw a REAL progress bar.

**2. The preload screen (new view, e.g. `src/views/Preload.jsx`)**
- Shown only when the precache is missing or stale (the SW answers
  `PRECACHE_STATUS`).
- The metalgym88 logo + a progress bar fed by the SW's progress messages.
- When it finishes → the index (`#/home`).

**3. The offline queue for the coach (new module, e.g. `src/lib/offline-queue.js`)**
- The same shape as `src/store/sync.js`: localStorage is the source of truth,
  a dirty flag, and a reconciliation on the next successful sync.
- `gym_coach_pending_v1`: `{ id, question, context, createdAt, attempts, state }`.
- `flushPending()` runs on the `online` event, on app boot, and after every
  successful coach answer.
- When the coach is offline: the answer is the empathetic
  "ahora mismo no tengo internet" + **the question is queued**, and the chat
  shows it as "pendiente".
- When the connection returns: the queued question is sent, the answer is
  appended to the thread, and the item leaves the queue.
- **The credits are checked at SEND time, not at queue time** (the wallet is
  the platform's; an offline person must not be charged for a question that
  never reached the coach). If the balance is short at send time, the answer
  says so kindly and the item stays in the queue.

**4. The cached profile (in the auth layer)**
- On every successful `/auth/me`: persist `{ id, name, email }` locally.
- On boot: if the API is unreachable, read the cached profile → the person is
  still "signed in" as far as the UI is concerned; if there is none → the
  **guest** profile (already exists).
- Cleared on sign-out and on `onAuthExpired` (a real rejection).

**5. The guest mode**
- Already exists; the work here is to make it reachable **offline** (G3) and
  to make the copy say it plainly (the locales already have the "Modo
  invitado" string).

## The decisions the owner must make (before implementing)

1. **How much of the catalog to preload.** Recommended: the shell only on the
   first run + cache-as-you-view for the media + an explicit "descargar para
   offline" action. The alternative (everything) is hundreds of MB.
2. **The authenticated offline identity.** Recommended: cache the minimal
   profile locally (id, name, email) and clear it on sign-out. The
   alternative (no cached identity → the offline boot is always a guest) is
   simpler but loses the person's own data view.
3. **The queued question: automatic or manual send.** Recommended: automatic
   when the connection returns (the owner's words: "las responderá cuando
   vuelva la internet"), with the pending question visible in the chat.
4. **The preload's cost.** The shell is small, but if the owner wants the
   media preloaded too, that is a big download that must be explicit and
   pausable.

## Risks

- **Storage quota**: the media cache can hit the browser's quota → the LRU
  must evict, and the "download for offline" action must report the real
  remaining space.
- **The CDN dataset is pinned to a commit hash** (`@7455efae...`) → the URLs
  are stable and cacheable. If the pin moves, the cache key changes and the
  old entries must be evicted (the SW's version marker handles it).
- **A stale precache after a deploy**: the SW's version marker + `skipWaiting`
  + `clients.claim` must move the app to the new shell without stranding a
  person on an old cached bundle.
- **The CSP**: `img-src 'self' data: blob: https:` and
  `media-src 'self' data: blob: https:` already allow the CDN ✓; the SW's
  scope (`worker-src 'self' blob:`) allows the current SW ✓.
- **The mobile build** (`MOBILE`) has no SW by design (the native shell serves
  from disk) → this feature is for the web app only.

## Progress

- [x] Requirement analyzed (this document)
- [x] The existing service worker, manifest, guest mode and sync layer mapped
- [x] The catalog's size measured (1324 exercises, 2648 media files)
- [ ] Owner's answers to the four decisions above
- [ ] Owner's OK to implement
- [ ] Implementation (phases: SW + precache → preload screen → cached profile
      → offline coach queue → the "download for offline" action)

## Next step

_(waiting for the owner's OK)_
