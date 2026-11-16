# Coach actions & navigation

## Objective

Make the AI coach panel behave like a first-class surface of the app: its
conversation controls read clearly, closing it really stops what it started,
the exercise sheet can hand an exercise to the coach, and the app always has a
way back to the index.

## Problem

Four concrete defects reported by the owner:

1. **The conversation banner looks wrong.** "New conversation" and "Delete all
   conversations" are separated: the new-chat control is a ghost link on the
   header row and the destructive one is a full-width button below the thread
   list. Two actions of the same family, in two places, in two different
   weights. The owner asked for small red and green buttons on ONE line.
2. **Signing out strands the person.** Logout lands on `/login`, a page that
   has no way back to the index, and the logo does not go home either. After
   closing the session the app must ALWAYS end at the index.
3. **Closing the chat does not stop the conversation.** While an answer is
   pending, closing the modal leaves the LLM call running; reopening the panel
   starts a second run while the first one is still going. The person can end
   up paying twice for one question and seeing answers arrive out of order.
4. **The coach cannot be asked about an exercise.** The exercise sheet has an
   "explain it with the coach" button that opens the chat, but the chat opens
   EMPTY: the coach never receives the exercise. The owner wants the coach to
   open with a SUMMARY of that exercise, and to keep answering follow-up
   questions about it. Also, whenever the coach talks to the person it must
   call them by their name — the name is already known by the app.

## Why

The coach is a paid feature (credits per question). Defects 3 and 4 waste
credits and confuse; defects 1 and 2 make a panel that works look broken and
leave people stuck on a dead-end screen. The empathy principle applies to
navigation too: never leave someone on a page with no next step.

## Scope

IN:

- `src/components/Assistant.jsx` — conversation banner, request lifecycle,
  opening with an exercise summary, addressing the person by name.
- `src/lib/platform/assistant.js` — cancellation support for the in-flight
  request (signal).
- `src/components/AuthForms.jsx` / logout handler — logout always ends at the
  index; `/login` gets a way back; the logo links home.
- `src/locales/es.js` — every new string in Spanish (the locale test is
  strict: any `t()` key without a Spanish entry fails the suite).
- `src/index.css` — only if the banner needs styles that inline styles cannot
  express cleanly.

OUT:

- The API (credits, heart resolution) — separate feature.
- The email branding — separate feature.
- Any change to the platform contract (`askAssistant` request/response shape).

## Constraints

- UI copy lives in `src/locales/es.js`. Artifact language is English; the UI
  language is Spanish.
- The request/response contract with the platform does not change: no new
  field, no renamed field.
- A closed panel must not leave a pending timer, a pending fetch or a pending
  speech behind.
- The thread list, its titles and the confirmation dialog for erasing all
  conversations stay as they are.
- Conventional Commits, no AI attribution, no `Co-Authored-By`.

## Tasks

- [x] **T5 — The session lasts until the person closes it.** Logging in every
      ~10 minutes is unacceptable for a training app: the person must stay
      signed in until THEY close the session. The platform already ships a
      long-lived refresh cookie (httpOnly, 30 days) and a silent refresh on
      401; find out why the session still dies mid-use (the refresh cookie
      not riding along on a cross-site request is the first suspect: the
      front lives on metalgym88.djlabs.cl and the API on api.djlabs.cl) and
      fix it so the session ends ONLY on an explicit sign-out. A failing
      refresh must not dump the person into a login form without explanation:
      say what happened and what to do next, keeping their data safe on the
      device.

- [x] **T1 — One line, two small buttons.** The conversations block shows a
      green "New conversation" button and a red "Delete all conversations"
      button side by side on ONE line, both small (compact padding and font
      size), each with its icon. The label "Your conversations" may stay, but
      the two actions must live together and read as one pair. The red action
      keeps its confirmation dialog.
- [x] **T2 — Signing out always lands on the index.** After logout the app
      goes to the index, never to `/login`. `/login` gets a visible "Back to
      the index" action, and the logo (wherever it is rendered on those
      screens) links to the index.
- [x] **T3 — Closing the panel cancels the question.** The pending request is
      aborted when the panel closes, and any late answer, timer or speech from
      the closed run is discarded instead of being written into a later
      session. Reopening starts a clean panel.
- [x] **T4 — The coach explains the exercise and calls the person by name.**
      The exercise sheet's "explain it with the coach" button opens the panel
      AND asks the coach, in the same action, for a summary of that exercise.
      The coach answers that question and keeps the thread for follow-ups
      about the same exercise. When the coach speaks to the person it uses
      their name (the name the app already has).

## Acceptance criteria

- T1: the two buttons render on one line, green and red, small; the suite's
  locale test stays green.
- T2: logout → index (verified in the code path and, if the app has a router
  test, in the test); `/login` shows a way back; the logo links to the index.
- T3: closing the panel during a pending answer aborts the request; a late
  response cannot append a message to a new panel; the "Stop" control keeps
  working.
- T4: the exercise sheet's coach button results in a question being sent with
  the exercise identified; the answer carries the summary; the follow-up
  questions continue on the same thread; the answer addresses the person by
  name when the app knows it.

## Verification

- `npx vitest run` — whole suite, no failures.
- `npx vite build` — clean build.
- A focused test for each behaviour that can be tested at the unit level
  (request cancellation, logout destination, the question sent by the
  exercise-sheet button). Behaviour that needs a browser is reported as
  such, honestly, instead of being claimed as verified.

## Route

- T1, T3, T4: delegated writer (2+ non-trivial files).
- T2: delegated writer (same unit — it touches the auth/navigation files).

## Progress

| Work unit | Commit | Observed outcome |
| --- | --- | --- |
| T5 — session lifetime | `b5fee16` | Platform calls already carried the shared-domain refresh cookie with `credentials: 'include'`. The front now single-flights refresh attempts and treats only a `400`/`401` from `/auth/refresh` as a definite expiry. Network errors, `429`, and `5xx` keep the person signed in and show a dismissible explanation; a definite expiry preserves the local training data and explains what happened. Focused HTTP and store tests cover both paths. |
| T1 — paired conversation actions | `1f3b9c9` | The assistant renders the compact green and red icon buttons together in one two-column row; the destructive action keeps its erase confirmation. The strict locale suite passes. Browser layout was not exercised in this session. |
| T2 — sign-out to the index | `fd0aeef` | Sign-out now waits for the platform sign-out and then performs a full-document navigation to `appRootUrl()`, never to `/login`. The login screen exposes a Spanish “Volver al inicio” action and its logo links home. Focused navigation tests cover successful sign-out, failed sign-out, path-based deployments, and the location fallback. |
| T3 — cancel work on close | `55fe60c` | `askAssistant` accepts only the optional `signal` addition to its existing contract. Closing the panel aborts the active request, the run guard rejects a late result, the reveal timer is cleared, tariff loading is aborted, and speech is cancelled. Starting another run also aborts the previous one. The Stop control still ends speech and the write-out. Focused tests cover cancellation and stale-result rejection. |
| T4 — exercise summary and identity | `17e1ff4` | The exercise-sheet action opens a fresh coach thread and immediately asks for a summary using both exercise id and name. The known person's name is included in the initial question and in the context of every follow-up; the returned `conversation_id` is retained for that thread. The platform request/response fields remain unchanged. Focused tests cover the initial request and identity context. Actual model wording was not browser-verified. |
| Welcome-bonus copy correction | `a1c102c` | Landing copy now follows the `welcome_bonus` response: newly added, already awarded, and absent data produce distinct honest messages. Unconditional promises of 100 credits were removed. Focused tests cover all three response states. |

### Verification

- `npx vitest run` — passed: 31 test files, 458 tests. Baseline before this work was 27 files and 432 tests.
- `npx vite build` — completed successfully. Vite retained the existing warning that some chunks exceed 1500 kB.
- Browser/runtime verification — not performed for the authenticated coach flow because no authenticated platform session or credit balance was available. No browser-only outcome is claimed here; the relevant code paths are covered by focused unit tests and the production build.

## Next step

Manual browser verification of the authenticated coach flow remains. The commits are local on `main` and have not been pushed.
