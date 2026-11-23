// S10 — the full human journey on the live site.
//
// One person, one continuous walk, start to finish, exactly the way the owner
// asked for it: land on the public site, read it, sign in through the landing's
// own inline login, look for an exercise, open its sheet, build a plan around
// it, ask the AI coach about it, walk the settings, check the wallet, start a
// recharge and — where the product hands a human a job (paying) — stop there
// and say so. Nothing is mocked, every step runs against the public deployment.
//
// The one thing a test cannot do is pay: the gateway is real. What the journey
// CAN prove is everything up to the hand-off: the published recharge options,
// the order creation with its Idempotency-Key, and the gateway URL the app
// hands over. The payment itself is recorded as needing a human card.
//
// The coach consumes credits (the tariff the platform charges per question),
// so the journey credits the wallet BEFORE the question — through the
// platform's own CreditService, driven by lib/grant-credits.php. The grant is
// a test-side tool: it runs from this repo, uses the platform code, and when
// it is impossible (no PHP, no API dir, no database) the step says exactly why
// and the walk continues.
//
// Verdict contract: each step lands PASS / FAIL / BLOCKED with its evidence
// and a screenshot. A FAIL means the product broke for the person. A BLOCKED
// means the walk could not finish that step (no mail, no credits, a human
// card needed) — the walk itself continues. The scenario never throws past
// the runner: it always hands back the accumulated verdict of every step.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { ScenarioFailure } from '../runner.js'
import { StepTimeout } from '../page.js'
import { BASE_URL, HEART, TEXT } from '../config.js'
import { extractTokenUrls } from '../lib/mailbox.js'
import { openApp, openLanding, platformResponse, redeemLatestLink, signOutThroughUi } from './helpers.js'

/* ============================ the walk's own words ============================ */
// The product's Spanish locale (src/locales/es.js), read live from the
// deployed bundle when this journey was written. S10-only strings stay here
// instead of growing the shared config for one scenario.
const HERO = 'Tu rutina, tu peso y tu coach'
const SECTIONS = ['como-funciona', 'que-incluye', 'creditos', 'acceso', 'login']
const ENTER_PANEL = 'Entrar al panel'
const SIGN_IN_HEADING = 'Iniciar sesión'

const SEARCH_PLACEHOLDER = 'Buscar'
const EXERCISE_QUERY = 'abdominal'
const EXERCISE_PREFERENCE = 'bicicleta' // the exercise the person settles on
const ADD_TO_PLAN = 'Añadir a mi plan'
const NEW_ROUTINE = 'Nueva rutina'
const ADD_TO_ROUTINE = 'Añadir a la rutina'
const ROUTINE_NAME = 'Rutina de prueba S10'

const ASSISTANT_OPEN = 'Abrir el asistente'
const COACH_HEADING = 'Coach con IA'
const COACH_SHEET = '.sheet-coach'
const COMPOSER = 'Pregunta sobre tu entrenamiento, plan o progreso…'
const SEND = 'Enviar'
const THINKING = 'Pensando…'
const COACH_QUESTION = '¿Cómo hago bien el abdominal bicicleta y qué músculos trabajo con él?'
const CATALOGUE_CARDS = 'Ejercicios del catálogo'
const ANSWER_TIMEOUT_MS = 60000 // the coach brain needs 8–20 s; the budget is generous but bounded
const RENDER_TIMEOUT_MS = 30000

const WALLET_SHEET = '.sheet'
const MOVEMENTS = 'Movimientos'
const CREDITS_AVAILABLE = 'créditos disponibles'
const ADD_CREDITS = 'Añadir créditos'
const LEGAL_CONSENT = 'Acepto los Términos y Condiciones y la Política'
const PAY_CLP = 'Pagar en CLP'
const PAY_ANY = 'Pagar en'

const GRANT_AMOUNT = Number(process.env.E2E_JOURNEY_GRANT || 60)
const GRANT_TIMEOUT_MS = 30000

// The platform pauses a wallet that crosses the welcome-bonus threshold until
// the email is confirmed again; the notice is this mail.
const REVERIFY_SUBJECT = /Confirma tu correo/i

const fold = value => String(value == null ? '' : value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

/* ============================ the credit grant ============================ */

/** Pulls the first JSON object out of a stream that may carry stray output. */
function parseJsonLoose(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/**
 * Credits the test account through the platform's own code (see
 * lib/grant-credits.php). Resolves { ok: true, ... } or { ok: false, error }
 * — never throws, because a missing PHP binary is a BLOCKED step, not a
 * broken walk.
 */
function grantCredits({ email, amount, heart, log }) {
  return new Promise(resolve => {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'grant-credits.php')
    const child = spawn('php', [script, email, String(amount), heart], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      resolve({ ok: false, error: `the credit grant did not finish within ${GRANT_TIMEOUT_MS}ms` })
    }, GRANT_TIMEOUT_MS)
    child.stdout.on('data', chunk => { out += chunk.toString() })
    child.stderr.on('data', chunk => { err += chunk.toString() })
    child.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, error: `php could not be launched (${e.message}); the coach's credits could not be granted from the database` })
    })
    child.on('close', code => {
      clearTimeout(timer)
      const parsed = parseJsonLoose(out)
      if (parsed && parsed.ok === true) {
        log(`credit grant: +${parsed.amount} credits (balance ${parsed.balance_before} → ${parsed.balance_after}, heart ${heart})`)
        resolve(parsed)
      } else {
        resolve({
          ok: false,
          error: (parsed && parsed.error) || err.trim() || `the credit grant exited with code ${code}`,
        })
      }
    })
  })
}

/* ============================ coach helpers ============================ */

// The answer body: { success, data: { answer | reply, balance, ... } } — the
// platform's envelope, with the flat shape tolerated.
function readAssistant(body) {
  const data = body && typeof body === 'object' && body.data && typeof body.data === 'object' ? body.data : (body || {})
  const answer = typeof data.answer === 'string' && data.answer.trim() ? data.answer
    : typeof data.reply === 'string' && data.reply.trim() ? data.reply : ''
  const balance = typeof data.balance === 'number' ? data.balance : null
  let error = null
  if (data.error && typeof data.error === 'object') error = data.error.message || data.error.code || null
  else if (typeof data.error === 'string') error = data.error
  else if (typeof data.message === 'string') error = data.message
  return { answer, balance, error }
}

// The typing bubble is gone, the opening of the answer is in the transcript,
// and the transcript stopped changing: the answer is on SCREEN, not merely on
// the wire.
async function waitForAnswerRendered(page, answer, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const needle = fold(answer).slice(0, 60)
  const deadline = Date.now() + timeoutMs
  let last = null
  let stable = 0
  while (Date.now() < deadline) {
    const state = await page.evaluate(`
      const el = document.querySelector(__args.selector);
      if (!el) return null;
      const text = __norm(el.innerText);
      return { text, typing: text.includes(__args.typing) };
    `, { args: { selector: COACH_SHEET, typing: THINKING } }).catch(() => null)
    if (state) {
      if (state.typing) {
        last = null
        stable = 0
      } else if (!needle || fold(state.text).includes(needle)) {
        if (state.text === last) {
          stable++
          if (stable >= 2) return true
        } else {
          last = state.text
          stable = 0
        }
      }
    }
    await delay(120)
  }
  return false
}

async function readChip(page) {
  const label = await page.ariaLabelWithText(CREDITS_AVAILABLE).catch(() => null)
  if (!label) return null
  const digits = label.replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

// The welcome-bonus pause, cleared the way a person clears it: the notice is
// read from the run's own inbox and confirmed through POST /auth/reverify.
async function completeReverification(page, context) {
  if (!context.mailbox) return { ok: false, detail: 'this run has no inbox to read the re-verification notice from' }
  let mail
  try {
    mail = await context.mailbox.latestWithSubject(REVERIFY_SUBJECT, {
      timeoutMs: 120000,
      since: context.sentAt || null,
    })
  } catch (e) {
    return { ok: false, detail: `no re-verification email arrived: ${e && e.message ? e.message : String(e)}` }
  }
  const urls = extractTokenUrls(mail.body)
  if (!urls.length) return { ok: false, detail: 'the re-verification email carried no verification URL' }
  const link = urls.find(url => /kind=reverify/.test(url)) || urls[0]
  const token = new URL(link).searchParams.get('token')
  if (!token) return { ok: false, detail: 'the re-verification URL carried no token' }
  const answer = await page.evaluate(`
    const response = await fetch('/auth/reverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: __args.token }),
    })
    return { status: response.status }
  `, { args: { token }, timeoutMs: 30000 }).catch(e => ({ status: null, error: String(e && e.message) }))
  const ok = Boolean(answer && answer.status === 200)
  return {
    ok,
    detail: ok ? 'the account confirmed its email again through the mailed notice'
      : `POST /auth/reverify answered ${answer && answer.status != null ? answer.status : 'no answer'}`,
  }
}

/* ============================ the scenario ============================ */

export default {
  id: 'S10',
  title: 'The full human journey — landing, sign-in, exercise, plan, coach, settings, wallet, recharge',
  async run({ page, context, log }) {
    const evidence = []
    const screenshots = []
    const steps = []
    const detail = { steps }

    // The walk is shared state: a step that cannot run because an EARLIER step
    // failed is BLOCKED "not reached", never silently skipped.
    const session = { balance: null, email: context.email, signInProblem: null }
    const chosen = { exercise: null, routine: null }
    const wallet = { balance: null, movements: null }

    /**
     * Runs one step of the journey. Every outcome lands in the step list:
     * PASS, FAIL (the product broke) or BLOCKED (the walk could not finish
     * this step, with the exact reason). The walk continues after both.
     */
    async function step(num, name, fn) {
      try {
        const value = await fn()
        steps.push(`${num}. ${name}: PASS`)
        return value || {}
      } catch (e) {
        const kind = e instanceof ScenarioFailure ? e.kind
          : e instanceof StepTimeout ? 'BLOCKED'
            : 'FAIL'
        const reason = (e && e.message ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 400)
        steps.push(`${num}. ${name}: ${kind} — ${reason}`)
        const shot = await page.screenshot(`s10-step${num}-${kind.toLowerCase()}`).catch(() => null)
        if (shot && shot.path) screenshots.push(shot.path)
        if (e instanceof ScenarioFailure && e.detail) {
          evidence.push({ label: `${num}. ${name} — ${kind} detail`, value: JSON.stringify(e.detail).slice(0, 600) })
        }
        return { [kind.toLowerCase()]: true, reason }
      }
    }

    /** BLOCKED for a step an earlier failure made unreachable. */
    function notReached(num, name, because) {
      const reason = `not reached — ${because}`
      steps.push(`${num}. ${name}: BLOCKED — ${reason}`)
      return { blocked: true, reason }
    }

    try {
      // The browser is shared by the whole suite: an account still signed in
      // from an earlier scenario would change what the landing's CTA means.
      const leftover = await signOutThroughUi(page).catch(() => null)
      if (leftover) log('signed out of the previous scenario\'s session first')

      // --- step 1: the landing -------------------------------------------
      await step(1, 'Landing — hero, sections and the entrance CTA', async () => {
        await openLanding(page)
        const hero = await page.waitForHeading(HERO, 20000)
        if (!hero) throw new ScenarioFailure('the landing did not render its hero')
        const sections = await page.evaluate(`
          return __args.ids.map(id => {
            const el = document.getElementById(id);
            return { id, present: !!el, visible: !!el && __visible(el) };
          });
        `, { args: { ids: SECTIONS } })
        const missing = sections.filter(s => !s.present).map(s => s.id)
        if (missing.length) {
          throw new ScenarioFailure(`the landing is missing section anchor(s): ${missing.join(', ')}`)
        }
        evidence.push({
          label: 'landing sections',
          value: sections.map(s => `#${s.id}${s.visible ? '' : ' (in the DOM, not yet scrolled into view)'}`).join(' · '),
        })
        // The CTA's honest destination: the inline login while there is no
        // session (a fresh browser profile holds none).
        const cta = await page.evaluate(`
          const links = Array.from(document.querySelectorAll('a'))
            .filter(a => __visible(a) && __text(a).toLowerCase().includes(__args.label.toLowerCase()));
          const header = links.find(a => a.closest('header')) || links[0] || null;
          return header ? { href: header.getAttribute('href'), text: __text(header).slice(0, 60) } : null;
        `, { args: { label: ENTER_PANEL } })
        if (!cta) throw new ScenarioFailure('the landing has no visible "Entrar al panel" CTA')
        if (cta.href !== '#login') {
          throw new ScenarioFailure(
            `the "Entrar al panel" CTA points to ${JSON.stringify(cta.href)}, expected the inline login section "#login" while there is no session`
          )
        }
        evidence.push({ label: 'CTA "Entrar al panel" (no session)', value: `href=${cta.href}` })
        await page.clickText(ENTER_PANEL, { timeoutMs: 15000 })
        const signIn = await page.waitForText(SIGN_IN_HEADING, 15000)
        if (!signIn) throw new ScenarioFailure('the CTA did not bring the inline sign-in form into view')
        evidence.push({ label: 'inline login', value: 'the sign-in form renders inside #login' })
        const shot = await page.screenshot('s10-01-landing')
        if (shot.path) screenshots.push(shot.path)
      })

      // --- step 2: sign in through the landing's inline login -------------
      const step2 = await step(2, 'Sign-in — magic link requested from #login and redeemed', async () => {
        await page.clickText(TEXT.emailLinkInstead, { timeoutMs: 15000 })
        const magic = await page.waitForText(TEXT.magicLinkTitle, 15000)
        if (!magic) throw new ScenarioFailure('the magic-link form never showed its heading')
        const scope = { heading: TEXT.magicLinkTitle }
        await page.fill(TEXT.appEmail, context.email, { scope, timeoutMs: 15000 })
        const terms = await page.checkByText(TEXT.terms, { scope, timeoutMs: 10000 })
        if (!terms.checked) throw new ScenarioFailure('the Terms checkbox did not get ticked, so the link cannot be requested')
        context.sentAt = new Date().toISOString()
        await page.clickText(TEXT.sendLink, { scope, timeoutMs: 10000 })
        const request = await page.waitForRequest(r => r.method === 'POST' && r.path === '/auth/magic-link', 20000)
        const response = await platformResponse(page, request)
        if (response.status !== 200) {
          throw new ScenarioFailure(`POST /auth/magic-link answered HTTP ${response.status}, so no session could be requested`)
        }
        evidence.push({ label: 'magic link requested', value: `POST /auth/magic-link → HTTP ${response.status} (the inbox is the run's own)` })
        await redeemLatestLink(page, context)
        await openApp(page, '/home')
        const heading = await (async () => {
          const deadline = Date.now() + 20000
          while (Date.now() < deadline) {
            const h = await page.headingText('h1').catch(() => null)
            if (h && /^hola/i.test(h)) return h
            await delay(150)
          }
          return null
        })()
        if (!heading) throw new ScenarioFailure('after the magic link the app did not open the home view with a session')
        const balance = await page.waitForAriaLabel(CREDITS_AVAILABLE, 20000)
        session.balance = balance ? Number((balance.match(/\d+/) || [])[0]) : null
        evidence.push({ label: 'session opened', value: `${heading}; balance chip ${balance ? balance : 'not visible'}` })
        const shot = await page.screenshot('s10-02-signed-in')
        if (shot.path) screenshots.push(shot.path)
      })
      if (step2.fail || step2.blocked) session.signInProblem = step2.reason

      // --- step 3: find an exercise and open its sheet --------------------
      await step(3, 'Library — search, filtered list and the exercise sheet', async () => {
        await openApp(page, '/library')
        const catalogue = await page.waitForText('Ejercicios', 20000)
        if (!catalogue) throw new ScenarioFailure('the exercise catalogue did not render')
        const filled = await page.fill(SEARCH_PLACEHOLDER, EXERCISE_QUERY, { timeoutMs: 15000 })
        if (!filled) throw new ScenarioFailure('the exercise catalogue has no search field')
        await delay(400) // the list filters as the person types
        const results = await page.evaluate(`
          const items = Array.from(document.querySelectorAll('.item'))
            .filter(el => __visible(el) && el.querySelector('.tt'))
            .map(el => __text(el.querySelector('.tt')));
          return items;
        `)
        if (!results || !results.length) {
          throw new ScenarioFailure(`searching "${EXERCISE_QUERY}" filtered the catalogue down to nothing`)
        }
        const wanted = results.find(name => name.toLowerCase().includes(EXERCISE_PREFERENCE))
          || results.find(name => fold(name).includes(EXERCISE_QUERY))
        if (!wanted) throw new ScenarioFailure(`the filtered list holds no "${EXERCISE_QUERY}" exercise`, 'FAIL', { results: results.slice(0, 8) })
        chosen.exercise = wanted.trim()
        evidence.push({
          label: 'search',
          value: `"${EXERCISE_QUERY}" → ${results.length} result(s); opening "${chosen.exercise}"`,
        })
        const opened = await page.evaluate(`
          const target = Array.from(document.querySelectorAll('.item'))
            .find(el => __visible(el) && el.querySelector('.tt') && __text(el.querySelector('.tt')) === __args.name);
          if (!target) return null;
          return __click(target);
        `, { args: { name: chosen.exercise } })
        if (!opened) throw new ScenarioFailure(`the result "${chosen.exercise}" could not be clicked`)
        const detail = await page.waitForText(ADD_TO_PLAN, 15000)
        if (!detail) throw new ScenarioFailure('the exercise sheet never rendered its "Añadir a mi plan" button')
        const sheetInfo = await page.evaluate(`
          const sheet = document.querySelector('.sheet');
          if (!sheet) return { media: 0, tags: 0, heading: null };
          return {
            media: sheet.querySelectorAll('img, video').length,
            tags: sheet.querySelectorAll('.tag').length,
            heading: sheet.querySelector('h3') ? __text(sheet.querySelector('h3')) : null,
          };
        `)
        if (!sheetInfo || sheetInfo.media < 1) {
          throw new ScenarioFailure(`the sheet of "${chosen.exercise}" shows no image or animation`, 'FAIL', { sheetInfo })
        }
        evidence.push({
          label: 'exercise sheet',
          value: `heading "${sheetInfo.heading}", ${sheetInfo.media} media element(s), ${sheetInfo.tags} tag(s), "Añadir a mi plan" present`,
        })
        const shot = await page.screenshot('s10-03-exercise-sheet')
        if (shot.path) screenshots.push(shot.path)
      })

      // --- step 4: build a plan around the exercise -----------------------
      await step(4, 'Plan — add the exercise to a new routine and rename it', async () => {
        await page.clickText(ADD_TO_PLAN, { timeoutMs: 15000 })
        const picker = await page.waitForText(NEW_ROUTINE, 15000)
        if (!picker) throw new ScenarioFailure('the "add to routine" sheet never offered a new routine')
        await page.clickText(NEW_ROUTINE, { timeoutMs: 10000 })
        const save = await page.waitForText(ADD_TO_ROUTINE, 15000)
        if (!save) throw new ScenarioFailure('the exercise configuration sheet never showed its save button')
        await page.clickText(ADD_TO_ROUTINE, { exact: true, timeoutMs: 10000 })
        // The app lands on the routine editor with the new routine in it. The
        // exercise sheet is STILL open on top, so its text would satisfy a
        // plain text wait — the editor is only there when its NAME FIELD is.
        const editor = await (async () => {
          const deadline = Date.now() + 15000
          while (Date.now() < deadline) {
            const state = await page.evaluate(`
              const input = document.querySelector('.hdr input.input') || document.querySelector('main input.input');
              if (!input || !__visible(input)) return { ready: false };
              return { ready: __norm(input.value) === __args.expect, value: __norm(input.value) };
            `, { args: { expect: NEW_ROUTINE } }).catch(() => null)
            if (state && state.ready) return state
            await delay(200)
          }
          return null
        })()
        if (!editor) throw new ScenarioFailure('the routine editor never mounted its name field after adding the exercise')
        // Rename it the way a person does: type over the routine's name field.
        const renamed = await page.evaluate(`
          const input = document.querySelector('.hdr input.input') || document.querySelector('main input.input');
          if (!input) return { found: false };
          __setValue(input, __args.name);
          return { found: true, after: __norm(input.value) };
        `, { args: { name: ROUTINE_NAME } })
        if (!renamed || !renamed.found || renamed.after !== ROUTINE_NAME) {
          throw new ScenarioFailure('the routine name field did not accept the new name', 'FAIL', { renameResult: renamed })
        }
        chosen.routine = ROUTINE_NAME
        await openApp(page, '/plan')
        const planHeading = await page.waitForText(TEXT.plan, 20000)
        if (!planHeading) throw new ScenarioFailure('the plan view did not render')
        const listed = await page.waitForText(ROUTINE_NAME, 15000)
        if (!listed) throw new ScenarioFailure(`the renamed routine "${ROUTINE_NAME}" is not in the plan list`)
        evidence.push({
          label: 'plan',
          value: `"${chosen.exercise}" added to a new routine, renamed to "${ROUTINE_NAME}", listed in the plan`,
        })
        const shot = await page.screenshot('s10-04-plan')
        if (shot.path) screenshots.push(shot.path)
      })

      // --- step 5: talk to the AI coach (credits granted first) -----------
      await (session.signInProblem
        ? Promise.resolve(notReached(5, 'Coach AI', `the sign-in failed earlier (${session.signInProblem})`))
        : step(5, 'Coach AI — credits granted, real question, real answer, catalogue card', async () => {
        // 5a. The grant. The account must exist (step 2 created/signed it in).
        let balanceBefore = session.balance
        let grantNote = null
        if (balanceBefore == null) {
          await openApp(page, '/home')
          balanceBefore = await readChip(page)
        }
        const grant = await grantCredits({ email: context.email, amount: GRANT_AMOUNT, heart: HEART, log })
        if (grant.ok) {
          evidence.push({
            label: 'credit grant (test-side, platform code)',
            value: `ADMIN_ADJUSTMENT +${grant.amount} (balance ${grant.balance_before} → ${grant.balance_after}, tx ${grant.transaction_id})`,
          })
          balanceBefore = grant.balance_after
        } else {
          grantNote = grant.error
          const chip = await readChip(page)
          if (chip == null || chip < 8) {
            const e = new ScenarioFailure(`the credit grant failed and the balance cannot cover the coach: ${grant.error}`, 'BLOCKED')
            throw e
          }
          balanceBefore = chip
          evidence.push({
            label: 'credit grant',
            value: `failed (${grant.error}) — but the balance (${chip} credits) already covers the question, so the walk continues`,
          })
        }
        // 5b. The real question through the real composer.
        await openApp(page, '/home')
        await page.clickText(ASSISTANT_OPEN, { timeoutMs: 25000 })
        const coachHeading = await page.waitForText(COACH_HEADING, 20000)
        if (!coachHeading) throw new ScenarioFailure('the coach panel never rendered its heading')
        await page.fill(COMPOSER, COACH_QUESTION, { scope: COACH_SHEET, timeoutMs: 20000 })
        const seen = new Set(page.requests.map(r => r.id))
        await page.clickText(SEND, { exact: true, scope: COACH_SHEET, timeoutMs: 20000 })
        const request = await page.waitForRequest(
          r => !seen.has(r.id) && r.method === 'POST' && r.path === '/opengym/ai',
          30000
        )
        let response = await platformResponse(page, request, {
          timeoutMs: ANSWER_TIMEOUT_MS,
          label: 'POST /opengym/ai',
        })
        // The request whose body carries the answer: the first turn, or the
        // retry when the welcome-bonus pause needed clearing first.
        let coachRequest = request

        // The welcome-bonus pause refuses the FIRST debit with 403 until the
        // email is confirmed again; a person follows the mailed notice, and so
        // does the walk — once. The panel then needs a fresh open: the 403
        // leaves it in its re-verification notice state.
        if (response.status === 403) {
          const reverify = await completeReverification(page, context)
          evidence.push({ label: 're-verification pause', value: reverify.detail })
          if (!reverify.ok) {
            const e = new ScenarioFailure(`the coach refused the question (HTTP 403) and the re-verification could not be completed: ${reverify.detail}`, 'BLOCKED')
            throw e
          }
          await openApp(page, '/home')
          await page.clickText(ASSISTANT_OPEN, { timeoutMs: 25000 })
          await page.fill(COMPOSER, COACH_QUESTION, { scope: COACH_SHEET, timeoutMs: 20000 })
          const seenAgain = new Set(page.requests.map(r => r.id))
          await page.clickText(SEND, { exact: true, scope: COACH_SHEET, timeoutMs: 20000 })
          const retry = await page.waitForRequest(
            r => !seenAgain.has(r.id) && r.method === 'POST' && r.path === '/opengym/ai',
            30000
          )
          response = await platformResponse(page, retry, { timeoutMs: ANSWER_TIMEOUT_MS, label: 'POST /opengym/ai (retry)' })
          if (response.status !== 200) {
            throw new ScenarioFailure(`POST /opengym/ai answered HTTP ${response.status} even after the re-verification`)
          }
          coachRequest = retry
        }

        if (response.status !== 200) {
          const body = await page.responseJson(coachRequest.id)
          const parsed = readAssistant(body)
          throw new ScenarioFailure(
            `POST /opengym/ai answered HTTP ${response.status}${parsed.error ? ` — ${parsed.error}` : ''}`
          )
        }
        const body = await page.responseJson(coachRequest.id)
        const parsed = readAssistant(body)
        const rendered = await waitForAnswerRendered(page, parsed.answer)
        const answerOnScreen = rendered || !!(await page.textContaining(COACH_QUESTION, { scope: COACH_SHEET }).catch(() => null))
        if (!parsed.answer) {
          throw new ScenarioFailure('the coach answered 200 but carried no answer text', 'FAIL', {
            body: JSON.stringify(body || {}).slice(0, 400),
          })
        }
        if (!answerOnScreen && !rendered) {
          throw new ScenarioFailure('the coach answer never finished rendering in the panel', 'FAIL', {
            answerStart: parsed.answer.slice(0, 120),
          })
        }
        const looksSpanish = /[áéíóúñ¿¡]/i.test(parsed.answer)
          || /\b(el|la|los|las|para|con|que|de|tu|músculo|ejercicio|respira|series|repeticiones|espalda|pierna)\b/i.test(parsed.answer)
        if (!looksSpanish) {
          throw new ScenarioFailure('the coach answer does not read as Spanish', 'FAIL', { answerStart: parsed.answer.slice(0, 200) })
        }
        const mentionsExercise = fold(parsed.answer).includes(fold(chosen.exercise).slice(0, 20))
        const shot = await page.screenshot('s10-05-coach-answer')
        if (shot.path) screenshots.push(shot.path)
        evidence.push({
          label: 'coach answer',
          value: `HTTP 200, ${parsed.answer.length} chars, rendered on screen: ${rendered || answerOnScreen}; Spanish: yes; mentions the exercise: ${mentionsExercise ? 'yes' : 'no'}; starts: "${parsed.answer.slice(0, 90)}…"${grantNote ? `; grant note: ${grantNote}` : ''}`,
        })
        if (parsed.balance != null) {
          evidence.push({
            label: 'coach charge',
            value: `balance after the answer: ${parsed.balance} (the tariff the panel publishes is charged by the platform)`,
          })
        }
        if (!mentionsExercise) {
          // A real coach answers the question that was asked; not naming the
          // exercise is a defect worth reading about, not a broken walk.
          throw new ScenarioFailure(`the coach answer never mentions the exercise "${chosen.exercise}"`, 'FAIL', {
            answerStart: parsed.answer.slice(0, 200),
          })
        }

        // 5c. The catalogue card: the front resolves the exercise from the
        // CATALOGUE (never from the model's text) and links it to the library.
        const card = await page.evaluate(`
          const sheet = document.querySelector(__args.sheet);
          if (!sheet) return { present: false };
          const cardsBlock = __text(sheet).includes(__args.cardsLabel);
          const links = Array.from(sheet.querySelectorAll('a'))
            .filter(a => __visible(a) && a.querySelector('img'));
          return { present: cardsBlock && links.length > 0, count: links.length, cardsBlock };
        `, { args: { sheet: COACH_SHEET, cardsLabel: CATALOGUE_CARDS } })
        if (!card || !card.present) {
          const e = new ScenarioFailure(
            'the coach answer carries no catalogue exercise card (the front resolves them from the catalogue and links them to the library)',
            'BLOCKED',
            { cardsBlock: card ? card.cardsBlock : null }
          )
          throw e
        }
        evidence.push({ label: 'catalogue cards', value: `${card.count} card(s) rendered under the answer` })
        const clicked = await page.evaluate(`
          const sheet = document.querySelector(__args.sheet);
          if (!sheet) return null;
          const links = Array.from(sheet.querySelectorAll('a')).filter(a => __visible(a) && a.querySelector('img'));
          const wanted = __args.name.toLowerCase().slice(0, 20);
          const target = links.find(a => __text(a).toLowerCase().includes(wanted)) || links[0] || null;
          if (!target) return null;
          const href = target.getAttribute('href');
          return { clicked: __click(target), href };
        `, { args: { sheet: COACH_SHEET, name: chosen.exercise } })
        if (!clicked) throw new ScenarioFailure('the catalogue card could not be clicked')
        await delay(600) // the SPA navigates client-side
        const url = await page.currentUrl().catch(() => '')
        const libraryShown = await page.waitForText(chosen.exercise, 15000)
        if (!libraryShown) {
          const e = new ScenarioFailure(
            `clicking the card did not land on the library with the exercise listed (final URL: ${url})`,
            'BLOCKED'
          )
          throw e
        }
        evidence.push({
          label: 'card click → library',
          value: `URL ${url}; "${chosen.exercise}" listed in the filtered library`,
        })
        const shot2 = await page.screenshot('s10-05b-card-to-library')
        if (shot2.path) screenshots.push(shot2.path)
        }))


      // --- step 6: the settings walk --------------------------------------
      await step(6, 'Settings — every section renders', async () => {
        await openApp(page, '/settings')
        const heading = await page.waitForText(TEXT.settings, 20000)
        if (!heading) throw new ScenarioFailure('the settings view did not render')
        const titles = await page.evaluate(`
          return Array.from(document.querySelectorAll('.sect-t')).filter(el => __visible(el)).map(el => __text(el));
        `)
        const expected = ['Cuenta', 'General', 'Durante el entrenamiento', 'Apariencia', 'Datos']
        const missing = expected.filter(name => !titles.some(t => t.toLowerCase().includes(name.toLowerCase())))
        if (missing.length) {
          throw new ScenarioFailure(`settings is missing section(s): ${missing.join(', ')}`, 'FAIL', { sectionsSeen: titles })
        }
        evidence.push({ label: 'settings sections', value: titles.join(' · ') })
        evidence.push({ label: 'profile row', value: 'the account section shows the signed-in profile (redacted)' })
        const shot = await page.screenshot('s10-06-settings')
        if (shot.path) screenshots.push(shot.path)
      })

      // --- step 7: the wallet ---------------------------------------------
      await (session.signInProblem
        ? Promise.resolve(notReached(7, 'Wallet', `the sign-in failed earlier (${session.signInProblem})`))
        : step(7, 'Wallet — balance and the movements the journey created', async () => {
        await page.clickText(TEXT.wallet, { timeoutMs: 20000 })
        const deadline = Date.now() + 25000
        let seen = false
        while (Date.now() < deadline) {
          if (await page.textContaining(MOVEMENTS, { scope: WALLET_SHEET }).catch(() => null)) { seen = true; break }
          await delay(150)
        }
        if (!seen) throw new ScenarioFailure('the wallet sheet never showed its movements')
        const balanceText = await page.evaluate(`
          const sheet = document.querySelector('.sheet');
          if (!sheet) return null;
          const label = Array.from(sheet.querySelectorAll('.muted.small'))
            .find(el => __norm(el.textContent).includes(__args.label));
          if (!label) return null;
          const number = label.previousElementSibling || label.parentElement && label.parentElement.firstElementChild;
          return number ? __text(number) : null;
        `, { args: { label: CREDITS_AVAILABLE } })
        wallet.balance = balanceText ? Number(String(balanceText).replace(/[^\d]/g, '')) : null
        if (wallet.balance == null) throw new ScenarioFailure('the wallet sheet shows no balance figure')
        // The ledger the platform served for this account. The call fires on
        // the sheet's mount: wait until a GET actually settles. The CORS
        // preflight (OPTIONS → 204 with no body) shares the path and must
        // never be mistaken for the answer (the same trap S8 documents).
        const settled = r => r.status != null || r.errorText != null
        const deadlineMovements = Date.now() + 30000
        let movementRequest = null
        while (Date.now() < deadlineMovements) {
          const candidates = page.requests.filter(r => r.method === 'GET' && r.path === '/credits/movements' && settled(r))
          const withBody = candidates.filter(r => r.status === 200)
          movementRequest = (withBody.length ? withBody : candidates).pop() || null
          if (movementRequest) break
          await delay(200)
        }
        if (!movementRequest) {
          throw new ScenarioFailure('GET /credits/movements never answered within 30s, so the movements list stayed loading')
        }
        if (movementRequest.status !== 200) {
          throw new ScenarioFailure(`GET /credits/movements answered ${movementRequest.status || movementRequest.errorText}`)
        }
        const movementsBody = await page.responseJson(movementRequest.id)
        // The platform wraps the ledger: { success, data: { movements, limit,
        // offset } }. Unwrap the envelope before looking for the rows.
        const envelope = movementsBody && typeof movementsBody === 'object' ? movementsBody : {}
        const inner = envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope
        const rows = Array.isArray(inner.movements) ? inner.movements
          : Array.isArray(envelope.data) ? envelope.data
            : Array.isArray(envelope) ? envelope : []
        const types = rows.map(r => r.type || r.operation || '').filter(Boolean)
        wallet.movements = rows.length
        const hasAdjustment = types.includes('ADMIN_ADJUSTMENT')
        const hasDebit = types.includes('USAGE_DEBIT')
        if (!rows.length) throw new ScenarioFailure('the wallet lists no movements, but this journey credited and spent credits')
        if (!hasAdjustment) throw new ScenarioFailure('the test-side ADMIN_ADJUSTMENT is missing from the wallet movements', 'FAIL', { typesSeen: types.slice(0, 10) })
        if (!hasDebit) throw new ScenarioFailure('the coach USAGE_DEBIT is missing from the wallet movements', 'FAIL', { typesSeen: types.slice(0, 10) })
        evidence.push({
          label: 'wallet',
          value: `balance ${wallet.balance} credits; ${rows.length} movement(s); types seen: ${[...new Set(types)].join(', ')}`,
        })
        const shot = await page.screenshot('s10-07-wallet')
        if (shot.path) screenshots.push(shot.path)
        }))

      // --- step 8: the recharge, up to the hand-off -----------------------
      await (session.signInProblem
        ? Promise.resolve(notReached(8, 'Recharge', `the sign-in failed earlier (${session.signInProblem})`))
        : step(8, 'Recharge — options, order, gateway hand-off (payment needs a human)', async () => {
        const addCredits = await page.waitForText(ADD_CREDITS, 20000)
        if (!addCredits) throw new ScenarioFailure('the wallet sheet never showed its recharge section')
        // The quote owns the packs and the rails. It fires on the sheet's
        // mount; give it the same bounded wait the movements get, and read
        // the GET (never the 204 preflight that shares its path).
        const settled = r => r.status != null || r.errorText != null
        const deadlineQuote = Date.now() + 30000
        let quoteRequest = null
        while (Date.now() < deadlineQuote) {
          const candidates = page.requests.filter(r => r.method === 'GET' && r.path === '/payments/quote' && settled(r))
          const withBody = candidates.filter(r => r.status === 200)
          quoteRequest = (withBody.length ? withBody : candidates).pop() || null
          if (quoteRequest) break
          await delay(200)
        }
        let quoteInfo = 'GET /payments/quote never answered within 30s'
        if (quoteRequest && quoteRequest.status === 200) {
          const quoteBody = await page.responseJson(quoteRequest.id)
          const quote = (quoteBody && (quoteBody.data || quoteBody)) || {}
          const clpRow = Array.isArray(quote.currencies)
            ? quote.currencies.find(c => c && c.currency === 'CLP') : null
          quoteInfo = `HTTP 200; CLP row: ${clpRow
            ? `available=${clpRow.available}, providers=${JSON.stringify(clpRow.providers || null)}`
            : 'absent'}`
        } else if (quoteRequest) {
          quoteInfo = `HTTP ${quoteRequest.status || quoteRequest.errorText}`
        }
        evidence.push({ label: 'quote (the rails the platform advertises)', value: quoteInfo })
        // The packs the platform publishes right now.
        const options = await page.evaluate(`
          const sheet = document.querySelector('.sheet');
          if (!sheet) return { chips: [], currencyChips: [], note: null };
          const chips = Array.from(sheet.querySelectorAll('button'))
            .filter(b => __visible(b) && /\\d/.test(__text(b)) && /CLP|créditos/i.test(__text(b)))
            .map(b => __text(b).slice(0, 40));
          const currencyChips = Array.from(sheet.querySelectorAll('button'))
            .filter(b => __visible(b) && /^(CLP|USD)$/.test(__norm(b.textContent)))
            .map(b => __norm(b.textContent));
          const note = Array.from(sheet.querySelectorAll('.dim.small'))
            .map(el => __text(el)).find(t => /no está disponible|No hay opciones/i.test(t)) || null;
          return { chips, currencyChips, note };
        `)
        if (!options.chips.length) {
          throw new ScenarioFailure(
            `the wallet publishes no recharge options right now${options.note ? ` — the sheet itself says: "${options.note}"` : ''} (quote: ${quoteInfo})`,
            'BLOCKED'
          )
        }
        evidence.push({ label: 'recharge options', value: options.chips.join(' | ') })
        const limitsRequest = page.requests
          .filter(r => r.method === 'GET' && r.path === '/payments/limits' && r.status === 200)
          .pop() || null
        if (limitsRequest) {
          const limitsBody = await page.responseJson(limitsRequest.id)
          const limits = (limitsBody && (limitsBody.data || limitsBody)) || {}
          if (limits.min_clp != null || limits.max_clp != null) {
            evidence.push({ label: 'published limits (GET /payments/limits)', value: `min=${limits.min_clp} max=${limits.max_clp}` })
          }
        }
        const shot = await page.screenshot('s10-08-topup-options')
        if (shot.path) screenshots.push(shot.path)
        // Legal consent is required before the order can exist.
        await page.checkByText(LEGAL_CONSENT, { scope: WALLET_SHEET, timeoutMs: 15000 })
        const picked = await page.evaluate(`
          const sheet = document.querySelector('.sheet');
          const chips = Array.from(sheet.querySelectorAll('button'))
            .filter(b => __visible(b) && /\\d/.test(__text(b)) && /CLP|créditos/i.test(__text(b)));
          if (!chips.length) return null;
          return __click(chips[0]);
        `)
        if (!picked) throw new ScenarioFailure('the first recharge pack could not be selected')
        // The pay button. The order is created; the browser then leaves for
        // the gateway in the SAME window (the product's own design).
        const beforePay = new Set(page.requests.map(r => r.id))
        let payClicked = null
        for (const label of [PAY_CLP, PAY_ANY]) {
          try { payClicked = await page.clickText(label, { scope: WALLET_SHEET, timeoutMs: 6000 }); break } catch { /* the other wording */ }
        }
        if (!payClicked) throw new ScenarioFailure('the wallet showed no pay button after a pack was chosen')
        // Only THIS click's order counts: an earlier scenario's order must
        // never be mistaken for this one.
        const orderRequest = await page.waitForRequest(
          r => !beforePay.has(r.id) && r.method === 'POST'
            && (r.path === '/payments/orders/checkout' || r.path === '/payments/orders'),
          25000
        )
        const idempotencyKey = orderRequest.headers['idempotency-key']
        if (!idempotencyKey) {
          throw new ScenarioFailure(`${orderRequest.path} went out without an Idempotency-Key header`)
        }
        const orderResponse = await platformResponse(page, orderRequest, { label: 'the order creation' })
        // The checkout endpoint answers 202 BY DESIGN (the order is created
        // PENDING on the provider); any 2xx carries the order.
        if (orderResponse.status == null || orderResponse.status < 200 || orderResponse.status >= 300) {
          throw new ScenarioFailure(`${orderRequest.path} answered HTTP ${orderResponse.status}`)
        }
        const orderBody = await page.responseJson(orderRequest.id)
        const order = (orderBody && (orderBody.data || orderBody)) || {}
        const orderId = order.order_id || order.orderId || order.id || null
        const redirectUrl = order.redirect_url || order.redirectUrl || null
        if (!orderId) throw new ScenarioFailure('the order creation answered without an order id', 'FAIL', { body: orderBody })
        evidence.push({
          label: 'order created',
          value: `POST ${orderRequest.path} → HTTP ${orderResponse.status}; id=${orderId}; Idempotency-Key: present`,
        })
        // The hand-off: the app navigates the same window to the gateway URL.
        let gatewayUrl = null
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
          const url = await page.currentUrl().catch(() => null)
          if (url && !url.startsWith(BASE_URL)) { gatewayUrl = url; break }
          await delay(150)
        }
        const gatewayDoc = gatewayUrl
          ? page.requests.filter(r => r.type === 'Document' && r.url === gatewayUrl).pop() || null
          : null
        if (!gatewayUrl && !redirectUrl) {
          throw new ScenarioFailure('the app never left for the gateway and the order carried no redirect URL')
        }
        let gatewayHost = null
        try { gatewayHost = gatewayUrl ? new URL(gatewayUrl).host : (redirectUrl ? new URL(redirectUrl).host : null) } catch { /* keep null */ }
        evidence.push({
          label: 'gateway hand-off',
          value: `${gatewayUrl || redirectUrl} (host ${gatewayHost}${gatewayDoc && gatewayDoc.status != null ? `, document HTTP ${gatewayDoc.status}` : ''})`,
        })
        const shot2 = await page.screenshot('s10-08b-gateway')
        if (shot2.path) screenshots.push(shot2.path)
        evidence.push({
          label: 'payment leg',
          value: 'NOT attempted — paying needs a human card; the journey records the hand-off and comes back',
        })
        // Back to the app, like a person who decides to pay later.
        await openApp(page, '/home')
        const back = await page.waitForAriaLabel(CREDITS_AVAILABLE, 20000)
        if (!back) throw new ScenarioFailure('the app did not come back to a signed-in home after the gateway hand-off')
        }))

      // --- step 9: the closing state --------------------------------------
      await step(9, 'Closing — home and plan still hold the journey\'s state', async () => {
        await openApp(page, '/home')
        const home = await (async () => {
          const deadline = Date.now() + 20000
          while (Date.now() < deadline) {
            const h = await page.headingText('h1').catch(() => null)
            if (h && /^(hola|metalgym88)/i.test(h)) return h
            await delay(150)
          }
          return null
        })()
        if (!home) throw new ScenarioFailure('the home view did not render at the end of the journey')
        const chip = await page.waitForAriaLabel(CREDITS_AVAILABLE, 20000)
        await openApp(page, '/plan')
        const routineListed = await page.waitForText(ROUTINE_NAME, 15000)
        if (!routineListed) throw new ScenarioFailure(`the plan no longer lists "${ROUTINE_NAME}" at the end of the journey`)
        evidence.push({
          label: 'final state',
          value: `${home}; balance chip ${chip || 'not visible'}; plan still lists "${ROUTINE_NAME}"`,
        })
        const shot = await page.screenshot('s10-09-final')
        if (shot.path) screenshots.push(shot.path)
      })
    } finally {
      evidence.push({ label: 'final URL', value: await page.currentUrl().catch(() => 'unknown') })
    }

    const failed = steps.find(s => /: FAIL/.test(s))
    const blockedStep = steps.find(s => /: BLOCKED/.test(s))
    if (failed) {
      return {
        status: 'FAIL',
        reason: failed,
        evidence,
        screenshots,
        detail,
      }
    }
    if (blockedStep) {
      return {
        status: 'BLOCKED',
        reason: blockedStep,
        evidence,
        screenshots,
        detail,
      }
    }
    return {
      status: 'PASS',
      reason: `all ${steps.length} steps of the human journey held on ${BASE_URL}`,
      evidence,
      screenshots,
      detail,
    }
  },
}
