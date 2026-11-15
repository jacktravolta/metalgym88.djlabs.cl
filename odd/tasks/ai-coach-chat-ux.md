# Feature — AI Coach chat UX (spinner, style, persistence, sound, voice)

## Objective

Make the AI Coach sheet feel like a real chat instead of a form: the user's
question appears the moment it is sent, a visible "thinking" state tells the
user the coach is working, long answers are readable without hunting, the
conversation survives the modal being closed, and the answer can be heard as
well as read.

## Problem

The coach sheet (`src/components/Assistant.jsx`) had four concrete problems:

1. **No feedback while waiting.** The user's question and the answer were added
   to the transcript in the same state update, so the sheet looked frozen for the
   whole round trip. The only hint was the button label changing to "Thinking…".
2. **Long answers were unwieldy.** A flat `maxHeight: 38vh` list with small,
   plain bubbles; the newest bubble was pinned but the writing was cramped.
3. **The conversation died with the sheet.** The transcript lived in component
   state only, so dismissing the modal destroyed it — including the
   `conversation_id` the server had issued.
4. **No way to hear the answer.** The coach is read-only text; nothing used the
   platform's own `speechSynthesis`, and there was no cue that a reply had
   arrived while the user was looking at another screen.

## Why

The owner asked for exactly these improvements to the webchat: a spinner for
the processing state, a more modern and fine style, long answers that do not
require scrolling gymnastics, a conversation that is not lost when the modal
closes, a question bubble that appears immediately, a configurable sound when
the coach finishes answering, and text-to-speech (per bubble or always on).

## Scope

In scope:

- `src/components/Assistant.jsx` — the coach sheet: transcript rendering,
  sending flow, feedback states, sound and voice.
- `src/components/Icon.jsx` — two new icons in the existing set (`stop`,
  `volumeHigh`), drawn on the same 24×24 stroke grid.
- `src/index.css` — one keyframe (`caret`) for the write-out cursor.
- `src/locales/es.js` — the Spanish copy for the new controls.

Out of scope:

- Server-side streaming. `POST /opengym/ai` answers in one shot, so the
  write-out is done on the client (see "Findings").
- Any change to the platform contract, credits, tariffs or the payload.
- Mobile build (`MOBILE`) and demo build: the coach is not available there.

## Constraints

- Privacy: the transcript must NOT be written to `localStorage`. It is kept in
  an in-memory map for the lifetime of the tab, so closing the modal does not
  lose it, but a reload starts fresh — the same promise the panel already
  made about storage.
- No new dependency: the voice is the browser's own `SpeechSynthesis` API and
  the sound is a Web Audio oscillator. No asset is downloaded.
- The Spanish locale test is strict: every `t()` literal must have an entry in
  `src/locales/es.js`.
- Technical artifacts and code stay in English; only the UI copy is translated.
- TDD mode: OFF (resolved from repo evidence: no `strict_tdd` marker in the
  project configuration; runner `npm test`). Standard functional checks apply.
- Delivery: one work-unit commit per task on `feat/ai-coach-chat-ux`, branched
  from the current HEAD (`fea3356`). Push, PR and merge are the owner's
  decisions.
- Delivery strategy: `ask-on-risk` (default). Forecast is below 400 authored
  lines, so no chain is expected.
- RDD (receipt-driven development) is globally OFF in this clone, so no native
  review runs on these commits.

## Tasks

- [x] **T1 — Feedback and immediate question.** The user bubble is appended
      before the request leaves, and a "Thinking…" bubble (sparkles icon) is
      shown until the answer lands. Route: inline writer (one component).
      Acceptance: the question is visible while the request is in flight, and
      the thinking bubble disappears when the answer arrives or the call fails.
- [x] **T2 — Modern style and readable long answers.** Bubbles with a soft
      accent gradient for the user, a hairline and a subtle shadow for the
      coach, asymmetric radii, larger line height, a translucent message well
      at `maxHeight: 42vh`, smooth scrolling, and the scroll pinned to the
      newest content WHILE the answer is being written out.
      Acceptance: a long answer is readable without leaving the sheet, and the
      view follows the text as it appears.
- [x] **T3 — The conversation survives the sheet.** An in-memory map keyed by
      `context::conversation_id` holds the transcript; the panel restores it on
      mount. Route: inline writer (same component).
      Acceptance: closing and reopening the coach on the same screen shows the
      same conversation, and nothing is written to `localStorage`.
- [x] **T4 — Sound and voice.** A "Sound on reply" switch (and the existing
      global sound preference) plays a short Web Audio tone when the answer
      arrives. A "Auto read answers" switch reads every answer aloud, and each
      coach bubble carries a speaker button to read that one. Language follows
      the app language (`es-ES` / `en-US`). Acceptance: the tone plays once per
      answer, the voice reads the answer, and a global "Stop" control ends both
      the voice and the write-out at once.
- [x] **T5 — Regression and commits.** `npm test`, `npm run build`, and the new
      icons/strings wired into the existing set and locale.
      Acceptance: the build is green and the suite passes.
- [x] **T6 — The voice does not read the markdown.** The answer arrives as
      markdown (`**bold**`, `*italic*`, bullet lists, links) and the speech
      engine read every marker out loud — "asterisco", sometimes several times
      in the same sentence, which took the answer out of context. A pure
      cleaner (`src/lib/speech.js`) prepares the text that is SPOKEN; the
      bubble keeps the markdown. Route: inline writer (one pure module, one
      test file, one call site).
      Acceptance: no asterisk, underscore, backtick or pipe reaches the
      utterance; prices, percentages and plain words are read untouched.

## Findings

- **The platform does not stream.** `POST /opengym/ai` returns the whole
  answer in one JSON body, so a "writing" cursor needs a client-side reveal.
  The answer is written out in ~220 chunks at 14ms, which reads as typing
  without lying about the backend.
- **Closing the sheet must also stop the voice.** A `SpeechSynthesis` queue
  keeps talking after the component unmounts, so the panel cancels it on
  unmount.
- **`onstart` is not reliable.** Some engines fire it late or not at all, so
  the "speaking" flag is also set when the utterance is queued — otherwise the
  Stop control would appear after the voice had already started.
- **A speech engine reads markdown punctuation.** `SpeechSynthesis` has no idea
  what `**` is: it says "asterisco", and a bulleted answer says it once per
  bullet. The cleanup lives in its own module because it is a rule about
  LANGUAGE, not about the chat: `toSpeechText()` strips the markers from the
  text that is spoken and touches nothing else. Prices ("$15.000"), percentages
  ("40%") and words like "user_id" survive it.
- **A marker regex can eat the paragraph break.** The first version of the
  blockquote rule used `\s{0,3}` before the `>`: `\s` also matches the line
  break, so a quoted paragraph swallowed the blank line in front of it. The
  leading space class is `[ \t]` everywhere now, and the emphasis content is
  kept on one line so a stray `*` cannot swallow the text between two
  asterisks that belong to different lines.

## Acceptance criteria

1. The question appears immediately and a visible thinking state covers the
   wait.
2. Long answers are readable and the view follows the text.
3. Closing and reopening the coach keeps the conversation, with nothing
   persisted to disk.
4. The answer can be heard: one switch for always reading, one button per
   bubble, and one control that stops both voice and write-out.
5. A short tone marks the arrival of an answer, and it can be switched off.
6. `npm test` and `npm run build` stay green.

## Verification evidence

- `npm test` → 370 passed (22 files). The locale test failed first with the
  four new strings missing from `src/locales/es.js`; they were added and the
  suite went green.
- `npm run build` → green.
- After T6: `npm test` → 378 passed (23 files), the new `src/lib/speech.test.js`
  pinning the eight rules of the cleaner. `npm run build` → green.

## Progress

- Branch: `feat/ai-coach-chat-ux`, branched from `fea3356` on
  `feat/social-capture-walkthrough` (that feature's commits stay intact and
  unmerged; this work is stacked on top of it).
- Route: inline writer, one component plus the icon set, one keyframe and the
  locale file — no delegated writer was needed, the surface is small and
  already understood.
- Forecast: ~200 authored lines. Actual: ~260 authored lines (the reveal
  effect and the bubble styling are the bulk).
- Commits: one work-unit commit for T1–T5 (they share one component and one
  visual outcome; splitting them would produce commits that do not build
  cleanly on their own).

## Next step

The owner decides on push, PR and merge. If a streaming backend is added later
(`POST /opengym/ai` with a chunked body), the client-side reveal in T1/T2 can
be replaced by the real stream without changing the UI contract.
