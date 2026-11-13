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

- [ ] **T1 — One search.** Extract the library filter into a shared pure
      function and reuse it in the library with no behavior change.
      Route: delegated writer.
- [ ] **T2 — The artifact.** Build the bounded artifact from the question.
      Route: same delegated writer.
- [ ] **T3 — Send it.** Merge the artifact into the coach request's
      `context.lines`. Route: same delegated writer.
- [ ] **T4 — The cards.** Render the resolved exercises under the answer:
      image, name, working link. Route: same delegated writer.
- [ ] **T5 — The sheet context.** Add the id and the image URL to the context
      the exercise sheet sends. Route: same delegated writer.
- [ ] **T6 — Verification.** `npm test`, `npm run build`, and a live run: ask
      a question that matches the catalog and see the answer with the exercise
      references and their images.

## Verification evidence

(to be filled as the tasks close)

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

## Progress

- Branch: to be created from `origin/main`.
- Depends on nothing in the capture feature; the capture feature consumes this
  one for the coach scene.

## Next step

Implement T1-T5 in one delegated writer, then verify against the live
deployment.
