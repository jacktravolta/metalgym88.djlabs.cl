#!/usr/bin/env node
// The E2E runner.
//
//   node scripts/e2e/run.js              # every scenario
//   node scripts/e2e/run.js S1 S7        # only these scenarios
//   node scripts/e2e/run.js --only=S8    # the same, by flag (comma lists work)
//
// It launches headless Chrome, drives the public deployment over the Chrome
// DevTools Protocol and writes the reports into artifacts/e2e/ (git-ignored).
//
// Exit codes: 0 = the suite ran (the verdicts live in the report), 1 = the
// harness itself could not run.
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { launchChrome, CDPConnection } from './cdp.js'
import { Page } from './page.js'
import { runScenarios } from './runner.js'
import { Mailbox } from './lib/mailbox.js'
import { attachedChildSessionId } from './lib/frames.js'
import { BASE_URL, HEART } from './config.js'

import s1Contact from './scenarios/s1-contact.js'
import s2Register from './scenarios/s2-register.js'
import s2bVerify from './scenarios/s2b-verify-link.js'
import s3Login from './scenarios/s3-login.js'
import s4Recovery from './scenarios/s4-access-recovery.js'
import s5Topup from './scenarios/s5-topup.js'
import s6Navigation from './scenarios/s6-navigation.js'
import s7Legal from './scenarios/s7-legal-pages.js'
import s8CreditBurn from './scenarios/s8-credit-burn.js'
import s9PaypalCardSandbox from './scenarios/s9-paypal-card-sandbox.js'
import s10FullJourney from './scenarios/s10-full-journey.js'

const ALL = [s1Contact, s2Register, s2bVerify, s3Login, s4Recovery, s5Topup, s6Navigation, s7Legal, s8CreditBurn, s9PaypalCardSandbox, s10FullJourney]

const OUT_DIR = resolve(process.env.E2E_OUT || join(process.cwd(), 'artifacts', 'e2e'))
const SCREENSHOT_DIR = join(OUT_DIR, 'screenshots')

// The scenario IDs the command line asked for, from positionals (S1 S7) and/or
// flags (--only=S8, --only=S5,S8, --only S8). An argument starting with "-" used
// to be dropped silently, so "--only=S8" ran the whole suite; now it selects.
function requestedIds(argv) {
  const ids = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--only' || arg === '--scenario') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        ids.push(...next.split(','))
        i++
      }
      continue
    }
    if (arg.startsWith('--only=') || arg.startsWith('--scenario=')) {
      ids.push(...arg.slice(arg.indexOf('=') + 1).split(','))
      continue
    }
    if (arg.startsWith('-')) continue
    ids.push(arg)
  }
  return ids.map(id => id.trim()).filter(Boolean)
}

async function main() {
  const requested = requestedIds(process.argv.slice(2))
  const scenarios = requested.length
    ? ALL.filter(s => requested.some(id => id.toLowerCase() === s.id.toLowerCase()))
    : ALL
  if (!scenarios.length) {
    console.error(`no scenario matches ${requested.join(', ')}`)
    process.exitCode = 1
    return
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true })
  // A run starts with an empty gallery: a screenshot left by an older run must
  // never be mistaken for evidence of this one.
  for (const file of await readdir(SCREENSHOT_DIR).catch(() => [])) {
    if (file.endsWith('.png')) await unlink(join(SCREENSHOT_DIR, file)).catch(() => {})
  }

  console.log(`metalgym88 E2E — ${BASE_URL} (heart ${HEART})`)
  const chrome = await launchChrome()
  console.log(`Chrome ${chrome.version.Browser} on port ${chrome.port}`)

  let connection = null
  try {
    connection = await new CDPConnection(chrome.version.webSocketDebuggerUrl).connect()
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(connection, sessionId, {
      artifactDir: OUT_DIR,
      screenshotDir: SCREENSHOT_DIR,
    })
    await page.enable()
    // The deployed service worker currently fails some asset clones and can
    // leave the app document blank. The suite tests the app and the API, not
    // the worker's cache implementation, so it talks to the network directly.
    await page.send('Network.setBypassServiceWorker', { bypass: true })

    // Safety net: a popup (the payment gateway tab, for instance) is paused
    // before it can navigate and then closed, so no stray tab can approve a
    // payment behind the suite's back.
    await connection.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    })
    // The browser-level auto-attach catches new browser pages. The page-scoped
    // call is what attaches OOPIF children (PayPal's card fields) to this
    // page, which is where the flattened child session id comes from.
    await page.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    })
    connection.on('Target.attachedToTarget', async (params, sessionId) => {
      const info = params.targetInfo || {}
      if (info.targetId === targetId) return
      // In flattened mode the child session id travels inside the event params.
      const childSessionId = attachedChildSessionId(params, sessionId)
      // Keep every child session and its target metadata. Cross-origin card
      // fields are driven in the session that owns the frame.
      page.trackChildSession(childSessionId, info)
      if (info.type === 'page' || info.type === 'webview') {
        try { await connection.send('Target.closeTarget', { targetId: info.targetId }) } catch { /* gone already */ }
      }
      if (childSessionId) {
        try {
          await connection.send('Runtime.runIfWaitingForDebugger', {}, childSessionId)
          await page.enableChildSession(childSessionId)
        } catch { /* gone already */ }
      }
    })
    connection.on('Target.detachedFromTarget', params => {
      page.removeChildSession(params && params.sessionId)
    })

    const context = {
      baseUrl: BASE_URL,
      heart: HEART,
      chromeVersion: chrome.version.Browser,
      // The scenarios this run selected: a scenario that must not share the
      // suite's inbox (S8 registers a brand-new account) can tell whether that
      // inbox is still untouched.
      selectedScenarios: scenarios.map(s => s.id),
      email: null,
      mailbox: null,
      mailboxError: null,
      mailboxKind: null,
      reportAccount: null,
      sensitiveValues: [],
      sentAt: null,
    }

    // A pinned mailbox gives the suite a stable identity (required by the
    // sandbox allowlist). Without the variables, the historical random inbox
    // is created exactly as before. The pinned address is never logged or
    // written to a report.
    try {
      const pinned = Mailbox.fromEnvironment()
      if (pinned) {
        await pinned.authenticate()
        context.mailbox = pinned
        context.email = pinned.address
        context.mailboxKind = 'pinned'
        context.reportAccount = 'pinned mailbox (redacted)'
        context.sensitiveValues = [pinned.address, pinned.password]
        console.log('Pinned inbox: configured')
      } else {
        context.mailbox = await Mailbox.create()
        context.email = context.mailbox.address
        context.mailboxKind = 'disposable'
        context.reportAccount = context.email
        console.log(`Disposable inbox: ${context.email}`)
      }
    } catch (e) {
      context.mailboxError = e && e.message ? e.message : String(e)
      context.email = 'harness-e2e@fldubai.com'
      console.error(`Disposable inbox unavailable: ${context.mailboxError}`)
    }

    const { results, summary } = await runScenarios({
      scenarios,
      page,
      context,
      outDir: OUT_DIR,
      baseUrl: BASE_URL,
    })

    console.log('')
    console.log(`  ${summary.pass} PASS · ${summary.fail} FAIL · ${summary.blocked} BLOCKED`)
    console.log(`  report:  ${join(OUT_DIR, 'report.md')}`)
    console.log(`  machine: ${join(OUT_DIR, 'report.json')}`)
    console.log(`  shots:   ${SCREENSHOT_DIR}`)
    for (const record of results) {
      console.log(`  ${record.status.padEnd(7)} ${record.id}: ${record.reason}`)
    }
  } catch (e) {
    console.error('the harness could not run:', e && e.stack ? e.stack : e)
    process.exitCode = 1
  } finally {
    if (connection) connection.close()
    await chrome.close()
  }
}

main()
