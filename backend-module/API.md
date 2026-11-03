# API — metalgym88 heart (data endpoints, T6a)

Contract authority: the frontend fork (`src/store/sync.js`, `src/store/useStore.js`).
This table was cross-checked line-by-line against that code. Any divergence between
this document and the front is a bug in this module, not in the front.

## GET /opengym/data?heart=metalgym88

| Aspect | Value |
| --- | --- |
| Auth | Session required (`AuthMiddleware::requireUser`) — JWT cookie or Bearer, platform standard |
| Heart | Production ignores `?heart=` and uses the install's `HEART_ID`; development validates the param (`[a-z0-9_-]{1,64}`) — same convention as `GET /credits/balance` |
| Success 200 | `{"state": <blob \| null>}` — **top level**; `null` = no mirror yet. The client's `unwrapBlob` also tolerates the bare blob at top level (future evolution) |
| Owner scope | Only the authenticated user's document is ever read (`{storage_dir}/{user.id}/dataGym.json`) |
| Errors | 401 `UNAUTHORIZED` (session) · 400 `VALIDATION_ERROR` (malformed heart param, dev) · 500 `SERVER_ERROR` |

Client behavior on errors/offline: keep local state, keep `gym_dirty`, stay usable
(never a user-facing failure) — so error precision here is for diagnosability only.

## PUT /opengym/data

| Aspect | Value |
| --- | --- |
| Auth | Session required (same as GET) |
| Body | `{"state": <object>, "heart": "metalgym88"}` — `state` MUST be a JSON object (not array, not scalar) |
| Size cap | 5 MB stored size by default (`opengym.max_state_bytes`) |
| Success 200 | `{"ok": true, "bytes": <int>}` |
| Storage | Atomic: same-directory tmp + rename → no half-written mirror after a crash |
| Errors | 400 `VALIDATION_ERROR` (malformed body/state/size) · 401 · 500 |

Client behavior: the front debounces pushes (1.5s) with last-write-wins by `_ts` and a
dirty flag that forces reconciliation — the server stores the blob as-is (document
store; **no schema**, owner decision).

## Cross-check findings (front ↔ backend)

1. The front accepts both `{state: <blob>}` and the bare blob at top level
   (`unwrapBlob`, `src/store/sync.js:24-34`); this module answers the documented
   `{state: ...}` shape. ✓
2. Front `decideSync` treats a `null`/unrecognizable server payload as "no server
   copy" → `{state: null}` for a fresh user resolves to "keep local" without error. ✓
3. The front sends `heart` in body (`withHeart`) and query (`withHeartQuery`); the
   platform's own convention (verified in `/credits/balance`) is dev-only heart
   validation with production using the install heart — matched. ✓
4. FINDING (inherited, not from T6a): `/credits/balance` and `/auth/me?heart=` route
   wallets per heart in production ONLY via the install's `HEART_ID` — deploying
   metalgym88 therefore requires its own install (or the platform's multi-heart prod
   work) with the gym heart id. Documented in INSTALL.md; out of this module's scope.