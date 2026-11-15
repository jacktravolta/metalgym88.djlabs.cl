# Feature — The coach knows the exercise catalog (prompt artifact)

## Objective

Make the AI coach answer with the product's real exercises: every exercise
mapped with its URL, the relevant ones resolved automatically from the
questions the person asks, and the chat able to show the exercise images that
already exist.

## Problem

The coach is a text conversation over the platform. It knows the person's
training context (the page they are on, the routine, the progress), but it does
not know the exercise catalog: the product already ships all 1.324 exercises
with names, muscle groups, image URLs and video URLs, and it already ships a
search over it ("el buscador"). So the coach can talk about training in general
and cannot hand over "press this exercise, here is its image, here is its
link" — even though the data is right there, in the front, already searchable.

## Why

The owner asked for it explicitly (2026-11-12): the coach must have all the
exercises mapped with their URLs, must be able to deliver that data, and the
chat should be able to load the exercise images, because they already exist.

## Decision (owner)

No RAG re-indexing is required. The information already exists and already
comes out of the existing search. The integration is: resolve the person's
question against that search, and inject the matching exercises into the coach
request as an ARTIFACT that complements the question — not as a new corpus to
index, and not as a hand-written list of "popular exercises".

Consequence: this feature is FRONT-SIDE. The platform contract does not change
(see the risk in Verification).

## How the pieces fit today (verified against the code)

- The search lives inline in the view: `src/views/Library.jsx:19-20` filters
  `allExercises(state)` by body part plus a case-insensitive substring match on
  the name, the target (`tg`), the equipment (`eq`) and the description. It is
  NOT a reusable function yet.
- The catalog is 1.324 exercises in `src/lib/exercises-data.js`, indexed by id
  in `EXIDX` (`src/lib/exercises.js:9-11`); the readable Spanish name is
  `exName(id)`.
- The media is not in the repo: `imgSrc(ex)` and `gifSrc(ex)` build the URLs
  from `VITE_IMG_BASE` / `VITE_GIF_BASE` (jsDelivr dataset pinned to a commit).
  There is no id -> absolute URL map; the URLs are produced on demand.
- The coach request is `POST {platform}/opengym/ai` with a CLOSED body:
  `{question, conversation_id, heart, context:{view, title, lines[]}}`
  (`src/lib/platform/assistant.js:26,87-96`). `context.lines` is already the
  channel for "what is on this screen".
- The backend sanitizes that context defensively: 40 characters for the view,
  120 for the title, 200 per line, 1.200 characters in total for the context,
  5.000 for the whole prompt (`api-independent/app/Heart/Opengym/Assistant.php:174-223`).
- The answer comes back flat: `{answer, conversation_id, balance, operation_id}`.
  The chat bubbles are `{role, text}` and render plain text
  (`src/components/Assistant.jsx:52-62,137-176`). There is no markdown, no
  link, no image and no card in the chat today.
- The coach endpoint is stateless: it always sends `history: []` to the brain
  (`api-independent/app/Heart/Opengym/Assistant.php:35-37,85-92`). So nothing
  can be remembered between questions: whatever the coach must know has to
  travel with each question.
- A question costs 5 credits (`gym_ai_chat`, `migrations/071_metalgym88_tarifa.sql`),
  and the balance travels back with the answer.
- The floating coach button is hidden for guests, for the demo build and for
  the MOBILE BUILD (`VITE_MOBILE=1`), not for small viewports
  (`src/components/CoachFab.jsx:20`, `src/lib/mobile.js:14`). The web build
  shows it at any width, so the coach belongs in the mobile captures too.

## Design

1. **One search, two consumers.** Extract the filter from `Library.jsx` into a
   shared, pure function (name, body part, options) and use it in the library
   (same behavior, no change) and in the coach.
2. **The artifact.** From the question the person typed, resolve the matching
   exercises and build a compact artifact that travels in `context.lines`:
   id, Spanish name, body part and the image URL, one line per exercise,
   bounded (see the caps below). No new field, so no platform change.
3. **The cards.** The chat renders the resolved exercises ITSELF, under the
   answer: image (from `imgSrc`), name, and a working link. The cards come
   from the catalog by id — never parsed out of the model's text, never
   invented. If nothing matched, there are no cards and the answer says
   nothing about exercises.
4. **The exercise sheet.** When a person opens an exercise, the context that
   the coach receives should also carry that exercise's id and its image URL
   (`src/sheets.jsx:286-303` sends name, muscles, equipment and steps, but no
   id and no media URL), so the coach can cite the exact exercise and its
   image.

## Scope

In scope:

- The shared search function, with the library reusing it unchanged.
- The artifact builder: bounded, compact, catalog-backed.
- Sending the artifact with the coach request, in `context.lines`.
- Rendering the exercise cards in the chat: image, name, working link.
- The exercise sheet context carrying the id and the image URL.
- Tests for the search, the artifact and the rendering.

Out of scope:

- Re-indexing the catalog into the platform's RAG (explicitly not needed).
- Changing the platform's models, prompts, retrieval or response shape.
- Parsing the model's answer to find exercises (fragile; the front already
  knows what it resolved).
- A new public page, a new admin screen, or a new endpoint.
- Letting the coach invent exercises.

## Constraints

- No new npm dependency.
- The exercise URLs are built from the dataset base the build already injects
  (`VITE_IMG_BASE` / `VITE_GIF_BASE`); the code must not hardcode a CDN path.
- The artifact is bounded by the backend's own caps: at most 4 exercises, one
  line each, each line under 200 characters, and the whole context under 1.200
  characters. It travels with EVERY question, so it is paid for in tokens.
- The conversation stays honest: an exercise reference that the catalog does
  not contain is not rendered, and a question with no match gets no cards.
- i18n: the chat strings go through the existing locales.
- The capture suite (`social-capture-walkthrough`) will exercise this scene,
  so the harness must be able to ask the coach and wait for a real answer
  (the answer is not deterministic and may take seconds).
- TDD mode: OFF (resolved from repo evidence: no `strict_tdd` marker; runner
  `npm test`). Standard functional checks apply.
- Delivery: work-unit commits on a feature branch based on `origin/main`. Push,
  PR and merge are the owner's decisions.
- Delivery strategy: `ask-on-risk` (default). Forecast is below 400 authored
  lines.
- RDD (receipt-driven development) is globally OFF in this clone, so no native
  review runs on these commits.

## Tasks

- [x] **T1 — One search.** Extract the library filter into a shared pure
      function and reuse it in the library with no behavior change.
      Route: delegated writer. Done: `src/lib/exercise-search.js` (the
      library's own rules, plus one opt-in difference: comparing without
      accents), used by `Library.jsx` and by the coach.
- [x] **T2 — The artifact.** Build the bounded artifact from the question.
      Route: same delegated writer. Done: `src/lib/coach-exercises.js`.
- [x] **T3 — Send it.** Merge the artifact into the coach request's
      `context.lines`. Route: same delegated writer. Done: merged at send
      time (the question is what decides the exercises), first in the lines,
      under the platform's caps.
- [x] **T4 — The cards.** Render the resolved exercises under the answer:
      image, name, working link. Route: same delegated writer. Done: the
      cards come from the front's own resolution, never from the model's
      text; the link opens the library filtered by that exercise.
- [x] **T5 — The sheet context.** Add the id and the image URL to the context
      the exercise sheet sends. Route: same delegated writer. Done.
- [ ] **T6 — Verification.** `npm test`, `npm run build`, and a live run: ask
      a question that matches the catalog and see the answer with the exercise
      references and their images. **Blocked**: the published platform answers
      402 to every coach question (see the finding below), so no answer comes
      back to observe. The local half is done (404 tests, green build, the
      payload read by hand and pinned by a test).
- [x] **T7 — The coach remembers.** The conversation threads survive a refresh
      on this device: a dedicated localStorage module keeps the threads, the
      panel restores the active one when it opens, and the person can start a
      new conversation or delete the ones they do not want. Route: delegated
      writer (the writer died on a provider 429 after writing the module, so
      the panel wiring was finished by the parent — see "Verification evidence
      (T7)"). Design and privacy rules in "The coach remembers (T7)".

## The coach remembers (T7)

### Problem

The coach's transcript lives in `AssistantPanel`'s `useState` only (`msgs`,
`conversationId`): a refresh, a tab close or a navigation wipes the
conversation and the person starts over. The owner asked for the threads to
survive a refresh.

### Decision

A dedicated module, `src/lib/coach-threads.js`, owns the threads in
`localStorage` under its own key (`gym_coach_threads_v1`).

The threads do NOT go into the store's `S`: `S` is the blob the app mirrors to
the platform (`PUT /opengym/data`), so a transcript inside `S` would leave the
device. The owner asked for a LOCAL memory, and a chat can carry personal
content — it stays on the device that asked the question.

The data model keeps several threads, one per platform `conversation_id`,
because the platform hands the conversation id back and the front sends it
again on every follow-up: the thread identity IS that id.

### Privacy rules (non-negotiable)

- The memory is bounded: at most `MAX_THREADS` threads, at most
  `MAX_THREAD_MSGS` messages per thread (the panel's own window is 30), and a
  TTL, so an old thread is not kept forever.
- The person can delete one thread, clear all of them, and signing out wipes
  every trace of the coach on that device.
- Nothing is written to the platform, to the console, or to any other key.
- The header comments that claim the transcript is not stored (in
  `Assistant.jsx` and in `lib/platform/assistant.js`) are corrected: they must
  tell the truth about where the transcript lives.

### Scope

In scope: the module and its tests, the panel wiring, the sign-out wipe, the
i18n strings, this document.

Out of scope: any platform change (the contract does not change), a
server-side transcript, sending the local memory to other devices, a new npm
dependency.

### Acceptance criteria

- Open the coach, ask a question, refresh the page: the conversation is still
  there, with the same `conversation_id`, and the next question continues it.
- A new conversation starts a new thread; the previous one stays in the list
  and can be resumed.
- Deleting a thread removes it from the device; signing out removes all of
  them.
- The store's `S` blob (the one mirrored to the platform) does not contain any
  transcript.
- `npm test` and `npm run build` pass.

## Findings

- **The catalog stores its values in English; the screen shows them in
  Spanish.** "chest", "abs", "barbell" behind "pecho", "abdominales",
  "barra". A Spanish question matched nothing. The bridge is
  `src/lib/exercises-vocab.es.js`, spread into `es.js` so there is one copy.
- **A plain substring match turns a greeting into four random exercises.**
  "hola, que tal estas?" matched "toques de talón alternados". The resolver
  now matches WHOLE WORDS, in order.
- **The library had no `?q=`.** The card's link needed it, otherwise the
  destination showed the whole catalog with no hint which card was clicked.
- **A new account cannot use the coach (platform defect).** The registration
  credits the welcome bonus on the `metalgym88` wallet, but in production
  `POST /opengym/ai` forces the install's heart (`OpengymModule::heartIdFor`)
  and reads another wallet, so it answers 402 "your balance is 0 credits" to
  an account that `GET /auth/me` reports with 100. The front cannot fix it:
  in production the heart in the body is ignored.

## Verification evidence

- `npm test` → **404 passed** (25 files; 34 new). `npm run build` → green.
- The request body is read by hand and pinned by a test: the artifact is the
  first `context.lines` entry, the payload keys are unchanged
  (`{question, conversation_id, heart, context}`).
- The artifact respects the backend's caps: at most 4 lines, each under 200
  characters (measured 163-168), the whole context under 1.200 (measured 768
  with a full library screen plus the artifact). The image URL is never cut:
  the name gives way instead.
- Live: **not possible** — the platform answers 402 before the brain call.

### Verification evidence (T7 — the coach remembers)

- `npx vitest run src/lib/coach-threads.test.js` → **14 passed**.
- `npx vitest run` (whole front) → **418 passed (26 files)**. `npm run build` →
  green.
- Two of the writer's own tests failed on arrival and both were the test's
  fault, not the module's: one read the memory with the real clock (`now` =
  2026) over threads written at `now = 1000` (1970), so the TTL expired them
  exactly as it should; the other assumed the active thread was the first one
  written, while `upsertCoachThread` deliberately leaves the last one active.
  Both tests were corrected and the second one now covers both branches
  (removing another thread keeps the active one; removing the active one
  clears it).
- The module and its shape: `src/lib/coach-threads.js` owns the threads under
  `gym_coach_threads_v1`, bounded to 10 threads, 30 messages each and a 30-day
  TTL; exercise cards are stored as catalogue **ids** and rebuilt from the live
  catalogue when the thread is restored, so a renamed exercise stays current
  and an unknown id is skipped instead of rendering a broken card.
- The privacy rule is pinned by a test, not by a promise: the transcript is in
  `localStorage` and **not** in the store's `S` blob (the one mirrored to the
  platform), and signing out wipes the coach key (`src/store/useStore.js`).
- The header comments that claimed the transcript was not stored are corrected:
  `src/components/Assistant.jsx` and `src/lib/platform/assistant.js` now say
  where it really lives.
- Live: **not possible** — the platform answers 402 before the brain call, so
  the round trip could not be observed in a browser. The local half (restore on
  open, save on every answer, resume, delete, sign-out wipe) is covered by the
  module's tests and by the wiring in the panel.

## Risks

1. **The deployed platform may ignore `context`.** The module packaged inside
   this repo (`backend-module/`) does not read it and answers 502, while the
   platform source (`api-independent/`) reads it and answers 503. Which one is
   deployed is unknown until proven. The live check in T6 must prove that the
   artifact reaches the brain; if it does not, this feature needs a platform
   change and the scope changes.
2. **The context budget is small.** 1.200 characters total: the artifact has to
   be tiny, so the coach knows a few exercises by name and URL, not a catalog.
3. **The answer is not structured.** The cards are rendered by the front from
   what the front resolved, so they can disagree with what the coach says.
   The artifact exists precisely to keep the coach talking about the same
   exercises.
4. **The credits of a new account never reach the coach** (finding above),
   so the feature cannot be observed until the platform's wallet routing is
   fixed.

## Progress

- Branch: `feat/coach-exercise-artifact` in the isolated worktree
  (`../metalgym88.djlabs.cl-worktrees/coach-exercise-artifact`), based on
  `origin/main` at `9b99aad`.
- Authored lines: ~1.150 (over the 400 planning heuristic — the resolver and
  its tests are the bulk). The work is split into seven reviewable commits;
  whether it travels as one PR or a chain is the owner's decision.
- Commits: `e323bda` (search), `72fe94f` (vocabulary), `3640c91` (resolver),
  `b29c3cf` (artifact in the request), `56da59a` (library `?q=`), `04c463b`
  (cards), `f55f579` (sheet context), `83ae50c` (the coach remembers).
- Route of the last work unit: **delegated writer + parent finishing the
  wiring**. The delegated writer wrote the module and its tests and then died
  on a provider 429 (HTTP 429, model provider — not a Gentle AI defect, so no
  defect report applies). Its module was good; its wiring was missing (the
  imports were in place and nothing called them), and two of its own tests
  were wrong (see the evidence above). The parent wired the panel, fixed the
  two tests and ran the suite.

## Next step

Push, PR and merge are the owner's decisions. T6 waits for the platform's
wallet fix; once it lands, the live check runs: ask a question that matches
the catalog and see the answer with the exercise cards and their images.
