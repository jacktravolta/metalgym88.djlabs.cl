// S6 — walking the product.
//
// Landing → home → exercise catalogue → plan → a training session → progress
// → history → settings → wallet. Every view has to render its own key text,
// the run must not produce console errors, and no request may answer 404/5xx.
//
// The product is offline-first: without a platform account the training log,
// the plan and the history live in the device. When the platform refuses the
// session (the browser blocks the platform calls), the walk still runs as a
// guest and the report says exactly which part could not be reached.
import { fail } from '../runner.js'
import { TEXT } from '../config.js'
import { CorsBlocked } from '../page.js'
import { continueAsGuest, ensureSignedIn, openApp, openLanding, waitForHomeHeading } from './helpers.js'

export default {
  id: 'S6',
  title: 'Navigation — the walk through every view of the product',
  async run({ page, context, log }) {
    const evidence = []
    const screenshots = []
    const rendered = []
    const consoleMark = page.consoleEntries.length
    const requestMark = page.requests.length

    // A session is the best case; a guest walk is still a real walk.
    let session = null
    let sessionProblem = null
    try {
      session = await ensureSignedIn(page, context)
      log(`signed in (${session.balance})`)
    } catch (e) {
      if (!(e instanceof CorsBlocked)) throw e
      sessionProblem = e
      log('no platform session: the browser refused the platform call')
    }

    // 1 — the public landing
    await openLanding(page)
    let heading = await page.waitForHeading('Tu rutina, tu peso y tu coach', 20000)
    if (!heading) throw fail('the landing did not render its hero')
    let shot = await page.screenshot('s6-01-landing')
    screenshots.push(shot.path)
    rendered.push(`landing (${heading})`)
    log('landing rendered')

    // 2 — the app home
    if (session) {
      await openApp(page, '/home')
    } else {
      await continueAsGuest(page)
    }
    heading = await waitForHomeHeading(page)
    if (!heading) throw fail('the home view did not render its greeting')
    if (session) {
      await page.expectText('Tu billetera', 15000)
    }
    shot = await page.screenshot('s6-02-home')
    screenshots.push(shot.path)
    rendered.push(`home (${heading}${session ? '' : ', guest'})`)
    log('home rendered')

    // 3 — the exercise catalogue (through the tab bar, as a person would)
    await page.clickText(TEXT.exercises, { exact: true })
    heading = await page.waitForHeading(TEXT.exercises, 20000)
    if (!heading) throw fail('the exercise catalogue did not render')
    const searched = await page.fill('Buscar', 'press banca')
    if (!searched) throw fail('the exercise catalogue has no search field')
    shot = await page.screenshot('s6-03-exercises')
    screenshots.push(shot.path)
    rendered.push(`exercise catalogue (${heading}, search filled)`)
    log('exercise catalogue rendered')

    // 4 — the plan, with the starter plan loaded into it
    await page.clickText(TEXT.plan, { exact: true })
    heading = await page.waitForHeading(TEXT.plan, 20000)
    if (!heading) throw fail('the plan view did not render')
    await page.clickText(TEXT.starterPlan)
    const loaded = await page.waitForText(TEXT.starterPlanToast, 15000)
    if (!loaded) throw fail('the starter plan was not loaded (no confirmation appeared)')
    shot = await page.screenshot('s6-04-plan')
    screenshots.push(shot.path)
    rendered.push(`plan (${heading}, starter plan loaded)`)
    log('plan rendered')
    evidence.push({ label: 'starter plan', value: 'loaded and confirmed in the UI' })

    // 5 — register a training session
    await page.clickText(TEXT.start, { exact: true })
    heading = await page.waitForHeading('Empezar entrenamiento', 20000)
    if (!heading) throw fail('the workout view did not render')
    await page.clickText('Día de empuje')
    const weighIn = await page.waitForText(TEXT.startWithoutWeighing, 15000)
    if (!weighIn) throw fail('the weigh-in sheet never appeared, so no training could be registered')
    await page.clickText(TEXT.startWithoutWeighing)
    const exercise = await page.waitForText('Ejercicio 1', 20000)
    if (!exercise) throw fail('the training session did not render its exercise list')
    shot = await page.screenshot('s6-05-workout')
    screenshots.push(shot.path)
    rendered.push('workout (Día de empuje, exercise list)')
    log('workout rendered')

    // Finish the session so the scenario proves a workout can actually be
    // registered, not merely opened. The button says "Terminar entrenamiento"
    // when every exercise is done and "Terminar antes · 0/6" when it is not,
    // so both wordings are tried.
    let finishClicked = null
    for (const wording of ['Terminar entrenamiento', 'Terminar antes']) {
      try {
        finishClicked = await page.clickText(wording, { timeoutMs: 6000 })
        break
      } catch (e) { /* the other wording may be the one on screen */ }
    }
    if (!finishClicked) throw fail('the workout view showed no way to finish the session')
    const finishConfirm = await page.waitForText('Nada registrado aún', 15000)
    if (!finishConfirm) throw fail('the finish confirmation never appeared')
    await page.clickText('Terminar igualmente', { exact: true })
    const completed = await page.waitForText('¡Entrenamiento completado!', 20000)
    if (!completed) {
      throw fail('the finished workout was not recorded in the completion summary', {
        pageText: await page.bodyText(4000),
      })
    }
    await page.clickText('¡Genial!', { exact: true })
    const homeAgain = await waitForHomeHeading(page)
    if (!homeAgain) throw fail('the workout completion did not return to the home view')
    evidence.push({ label: 'training session', value: 'started (Día de empuje), finished and confirmed in the completion summary' })

    // 6 — progress
    await page.clickText(TEXT.stats, { exact: true })
    heading = await page.waitForHeading(TEXT.stats, 20000)
    if (!heading) throw fail('the progress view did not render')
    await page.expectText(TEXT.bodyWeight, 15000)
    shot = await page.screenshot('s6-06-progress')
    screenshots.push(shot.path)
    rendered.push(`progress (${heading})`)
    log('progress rendered')

    // 7 — history
    await page.clickText(TEXT.history, { exact: true })
    heading = await page.waitForHeading(TEXT.history, 20000)
    if (!heading) throw fail('the history view did not render')
    shot = await page.screenshot('s6-07-history')
    screenshots.push(shot.path)
    rendered.push(`history (${heading})`)
    log('history rendered')

    // 8 — settings
    await page.clickText(TEXT.settings, { exact: true })
    heading = await page.waitForHeading(TEXT.settings, 20000)
    if (!heading) throw fail('the settings view did not render')
    if (session) {
      await page.expectText(TEXT.wallet, 15000)
    } else {
      // A guest has no platform account: the wallet row is not there, and the
      // view says so out loud.
      const guestNote = await page.waitForText('Modo invitado', 15000)
      if (!guestNote) throw fail('the settings view did not show its guest-mode state')
      evidence.push({ label: 'settings (guest)', value: 'the account section shows the guest state instead of the wallet' })
    }
    shot = await page.screenshot('s6-08-settings')
    screenshots.push(shot.path)
    rendered.push(`settings (${heading})`)
    log('settings rendered')

    // 9 — the wallet (it belongs to a platform account)
    if (session) {
      await page.clickText(TEXT.wallet, { exact: true })
      const wallet = await page.waitForText(TEXT.limitsLine, 20000)
      if (!wallet) throw fail('the wallet did not open')
      shot = await page.screenshot('s6-09-wallet')
      screenshots.push(shot.path)
      rendered.push('wallet (balance, limits and top-up)')
      log('wallet rendered')
    } else {
      evidence.push({
        label: 'wallet',
        value: 'not reachable without a platform session: the wallet belongs to a signed-in account, ' +
          'and the browser refused the platform call that would have created one',
      })
      rendered.push('wallet (not reachable without a session)')
    }

    evidence.push({ label: 'views rendered', value: rendered.join(' → ') })
    evidence.push({ label: 'final URL', value: await page.currentUrl() })

    // --- the run must be clean ---------------------------------------------
    // The browser logs a console error for every failed response ("Failed to
    // load resource"). Those are counted separately: the criterion is about
    // real errors (exceptions, CSP violations) and about 404/5xx answers.
    const consoleErrors = page.consoleEntries.slice(consoleMark).filter(e => e.level === 'error' || e.source === 'exception')
    const corsErrors = consoleErrors.filter(e => /blocked by CORS policy/i.test(e.text || ''))
    const resourceErrors = consoleErrors.filter(e => /Failed to load resource/i.test(e.text))
    const realErrors = consoleErrors.filter(e =>
      !/Failed to load resource/i.test(e.text) &&
      !/Cloudflare Insights|beacon\.min\.js/i.test(e.text) &&
      !/blocked by CORS policy/i.test(e.text)
    )
    const failed = page.requests.slice(requestMark).filter(r => r.errorText || (typeof r.status === 'number' && r.status >= 400))
    const serverErrors = failed.filter(r => !r.errorText && (r.status === 404 || r.status >= 500))
    const otherFailures = failed.filter(r => !serverErrors.includes(r))

    const countBy = (entries, pick) => {
      const counts = new Map()
      for (const entry of entries) {
        const key = pick(entry)
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      return [...counts.entries()].map(([key, n]) => `${n}× ${key}`).join(' | ')
    }

    evidence.push({
      label: 'console errors (real)',
      value: realErrors.length ? countBy(realErrors, e => e.text.slice(0, 120)) : 'none',
    })
    evidence.push({
      label: 'console errors (CORS refusals)',
      value: corsErrors.length ? countBy(corsErrors, e => e.text.slice(0, 140)) : 'none',
    })
    evidence.push({
      label: 'console errors (failed resources)',
      value: resourceErrors.length ? countBy(resourceErrors, e => e.text.slice(0, 90)) : 'none',
    })
    evidence.push({
      label: 'console errors (Cloudflare Insights CSP)',
      value: countBy(consoleErrors.filter(e => /Cloudflare Insights|beacon\.min\.js/i.test(e.text)), e => 'CSP blocked beacon.min.js') || 'none',
    })
    evidence.push({
      label: 'failed requests (4xx/5xx)',
      value: otherFailures.length
        ? countBy(otherFailures, r => `${r.method || '?'} ${r.url} → ${r.status || r.errorText}`.slice(0, 140))
        : 'none',
    })

    if (corsErrors.length) {
      const diagnosis = page.corsDiagnosisFor(null, { since: { console: consoleMark, requests: requestMark } })
      throw fail(
        `the walk rendered ${rendered.length} views (${rendered.join(', ')}) but the platform refused ${corsErrors.length} call(s) from the browser — ${diagnosis ? diagnosis.message : corsErrors[0].text}`,
        diagnosis || { console: corsErrors[0].text }
      )
    }
    if (realErrors.length) {
      const first = realErrors[0].text.replace(/\s+/g, ' ').slice(0, 180)
      throw fail(`the walk produced ${realErrors.length} console error(s) — first: ${first}`, {
        consoleErrors: countBy(realErrors, e => e.text.slice(0, 200)),
      })
    }
    if (serverErrors.length) {
      throw fail(`the walk produced ${serverErrors.length} request(s) answering 404/5xx`, {
        failedRequests: serverErrors.slice(0, 8).map(r => `${r.method || '?'} ${r.url} → ${r.status}`),
      })
    }
    if (resourceErrors.length) {
      const first = resourceErrors[0].text.replace(/\s+/g, ' ').slice(0, 180)
      throw fail(`the walk produced ${resourceErrors.length} failed-resource console error(s) — first: ${first}`, {
        failedRequests: otherFailures.slice(0, 8).map(r => `${r.method || '?'} ${r.url} → ${r.status || r.errorText}`),
      })
    }

    if (sessionProblem) {
      throw fail(
        `every view rendered (${rendered.join(', ')}), but the walk needed a platform session and the browser refused the platform call — ${sessionProblem.message}`,
        sessionProblem.diagnosis || null
      )
    }

    return {
      reason:
        `${rendered.length} views rendered (${rendered.join(', ')}), no application console error and no 404/5xx response` +
        (otherFailures.length ? `; ${otherFailures.length} failed request(s) reported in the evidence` : ''),
      evidence,
      screenshots: screenshots.filter(Boolean),
    }
  },
}
