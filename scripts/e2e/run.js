#!/usr/bin/env node
// The E2E runner.
//
//   node scripts/e2e/run.js              # every scenario
//   node scripts/e2e/run.js S1 S7        # only these scenarios
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
import { BASE_URL, HEART } from './config.js'

import s1Contact from './scenarios/s1-contact.js'
import s2Register from './scenarios/s2-register.js'
import s2bVerify from './scenarios/s2b-verify-link.js'
import s3Login from './scenarios/s3-login.js'
import s4Recovery from './scenarios/s4-access-recovery.js'
import s5Topup from './scenarios/s5-topup.js'
import s6Navigation from './scenarios/s6-navigation.js'
import s7Legal from './scenarios/s7-legal-pages.js'

const ALL = [s1Contact, s2Register, s2bVerify, s3Login, s4Recovery, s5Topup, s6Navigation, s7Legal]

const OUT_DIR = resolve(process.env.E2E_OUT || join(process.cwd(), 'artifacts', 'e2e'))
const SCREENSHOT_DIR = join(OUT_DIR, 'screenshots')

async function main() {
  const requested = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
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

    // Safety net: a popup (the payment gateway tab, for instance) is paused
    // before it can navigate and then closed, so no stray tab can approve a
    // payment behind the suite's back.
    await connection.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    })
    connection.on('Target.attachedToTarget', async (params, sessionId) => {
      const info = params.targetInfo || {}
      if (info.targetId === targetId) return
      if (info.type === 'page' || info.type === 'webview') {
        try { await connection.send('Target.closeTarget', { targetId: info.targetId }) } catch { /* gone already */ }
      }
      if (sessionId) {
        try { await connection.send('Runtime.runIfWaitingForDebugger', {}, sessionId) } catch { /* gone already */ }
      }
    })

    const context = {
      baseUrl: BASE_URL,
      heart: HEART,
      chromeVersion: chrome.version.Browser,
      email: null,
      mailbox: null,
      mailboxError: null,
      sentAt: null,
    }

    // The disposable inbox the magic-link scenarios read. If mail.tm is down
    // the suite still runs: the scenarios that need it report BLOCKED with the
    // exact error instead of pretending.
    try {
      context.mailbox = await Mailbox.create()
      context.email = context.mailbox.address
      console.log(`Disposable inbox: ${context.email}`)
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
