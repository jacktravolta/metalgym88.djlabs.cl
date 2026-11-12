// The scenario runner.
//
// Every scenario returns a verdict the runner can defend: PASS, FAIL or
// BLOCKED. The distinction matters — a FAIL means the product broke; a
// BLOCKED means the suite could not finish the journey (no mail arrived, the
// payment gateway needs a human, a step never happened in time). A blocked
// scenario is never reported as a pass.
//
// The runner also writes two reports: a machine-readable JSON one and a
// Markdown one for humans. Everything that goes into them is redacted.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redactValue } from './redact.js'
import { StepTimeout, CorsBlocked } from './page.js'

export class ScenarioFailure extends Error {
  constructor(message, kind = 'FAIL', detail = null) {
    super(message)
    this.name = 'ScenarioFailure'
    this.kind = kind
    this.detail = detail
  }
}

/** The product did something wrong. */
export const fail = (message, detail = null) => new ScenarioFailure(message, 'FAIL', detail)

/** The suite could not complete the journey. */
export const blocked = (message, detail = null) => new ScenarioFailure(message, 'BLOCKED', detail)

const STATUS_MARK = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' }

/**
 * Runs the scenarios in order, one browser session for all of them.
 * A failing scenario never stops the run: the next one still gets its turn.
 */
export async function runScenarios({ scenarios, page, context, outDir, baseUrl }) {
  const results = []
  for (const scenario of scenarios) {
    const startedAt = Date.now()
    const record = {
      id: scenario.id,
      title: scenario.title,
      status: 'FAIL',
      reason: '',
      detail: null,
      evidence: [],
      screenshots: [],
      consoleErrors: [],
      failedRequests: [],
      durationMs: 0,
    }
    const markRequest = () => {
      record.requests = page.requests.slice(requestMark).map(r => ({
        method: r.method,
        url: r.url,
        status: r.status,
        error: r.errorText || null,
      }))
    }
    // Only what happened during this scenario is reported: the page object is
    // shared by the whole run, and an error from an earlier scenario must not
    // be charged to this one.
    const consoleMark = page.consoleEntries.length
    const requestMark = page.requests.length
    try {
      const outcome = await scenario.run({ page, context, log: makeLog(scenario.id) })
      // A scenario may hand back an explicit verdict (a journey that completed
      // but proved a defect, for instance). Without one, reaching the end of
      // the scenario means PASS.
      record.status = outcome && outcome.status ? outcome.status : 'PASS'
      record.reason = (outcome && outcome.reason) || 'Every assertion held'
      record.evidence = (outcome && outcome.evidence) || []
      record.screenshots = (outcome && outcome.screenshots) || []
    } catch (e) {
      if (e instanceof ScenarioFailure) {
        record.status = e.kind
        record.reason = e.message
        record.detail = e.detail || null
      } else if (e instanceof CorsBlocked) {
        // The browser refused the platform call: the journey is broken for a
        // person, not for the suite. That is a FAIL, with the evidence.
        record.status = 'FAIL'
        record.reason = e.message
        record.detail = e.diagnosis || null
        const d = e.diagnosis || {}
        record.evidence = [
          { label: 'page origin', value: d.origin || 'unknown' },
          { label: 'platform host', value: d.apiHost || 'unknown' },
          { label: 'blocked call', value: d.url || 'unknown' },
          {
            label: 'CORS preflight',
            value: d.preflight ? `HTTP ${d.preflight.status} ${d.preflight.url}` : 'not captured',
          },
          { label: 'browser console', value: d.console || 'not captured' },
        ]
        // Later scenarios can explain themselves with the same root cause.
        context.cors = d
      } else if (e instanceof StepTimeout) {
        record.status = 'BLOCKED'
        record.reason = `Step timed out: ${e.message}`
        record.detail = e.lastState || null
      } else {
        record.status = 'FAIL'
        record.reason = e && e.message ? e.message : String(e)
        record.detail = e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : null
      }
    } finally {
      record.durationMs = Date.now() - startedAt
      record.consoleErrors = page.consoleEntries.slice(consoleMark).filter(e => e.level === 'error' || e.source === 'exception')
      record.failedRequests = page.requests.slice(requestMark).filter(r => r.errorText || (typeof r.status === 'number' && r.status >= 400))
      record.screenshots = record.screenshots.length ? record.screenshots : page.screenshots.slice(-3)
      markRequest()
    }
    results.push(record)
    printScenario(record)
  }

  const summary = {
    total: results.length,
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    blocked: results.filter(r => r.status === 'BLOCKED').length,
  }
  await writeReports({ results, summary, context, outDir, baseUrl })
  return { results, summary }
}

function makeLog(id) {
  return message => console.log(`  [${id}] ${message}`)
}

function printScenario(record) {
  const mark = STATUS_MARK[record.status] || record.status
  const ms = `${(record.durationMs / 1000).toFixed(1)}s`
  console.log(`  ${mark.padEnd(7)} ${record.id} — ${record.title} (${ms})`)
  console.log(`          ${record.reason}`)
}

/** Writes the JSON and Markdown reports. */
export async function writeReports({ results, summary, context, outDir, baseUrl }) {
  await mkdir(outDir, { recursive: true })

  const safe = redactValue({
    generatedAt: new Date().toISOString(),
    baseUrl,
    heart: context.heart,
    chrome: context.chromeVersion || null,
    account: context.email || null,
    summary,
    scenarios: results,
  })
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(safe, null, 2)}\n`)

  const lines = []
  lines.push('# E2E report — metalgym88')
  lines.push('')
  lines.push(`- Base URL: ${baseUrl}`)
  lines.push(`- Heart: \`${context.heart}\``)
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Chrome: ${context.chromeVersion || 'unknown'}`)
  lines.push(`- Account under test: \`${context.email || 'n/a'}\``)
  lines.push('')
  lines.push(`**${summary.pass} PASS · ${summary.fail} FAIL · ${summary.blocked} BLOCKED**`)
  lines.push('')
  lines.push('| ID | Result | Scenario | Reason |')
  lines.push('|----|--------|----------|--------|')
  for (const record of safe.scenarios) {
    lines.push(`| ${record.id} | ${record.status} | ${record.title} | ${escapeCell(record.reason)} |`)
  }
  lines.push('')
  for (const record of safe.scenarios) {
    lines.push(`## ${record.id} — ${record.title}`)
    lines.push('')
    lines.push(`- Result: **${record.status}**`)
    lines.push(`- Reason: ${record.reason}`)
    lines.push(`- Duration: ${(record.durationMs / 1000).toFixed(1)}s`)
    if (record.evidence && record.evidence.length) {
      lines.push('- Evidence:')
      for (const item of record.evidence) {
        lines.push(`  - ${item.label}: ${escapeCell(String(item.value))}`)
      }
    }
    if (record.detail) {
      lines.push('- Detail:')
      if (typeof record.detail === 'string') {
        for (const line of record.detail.split('\n')) lines.push(`  - ${escapeCell(line)}`)
      } else {
        for (const [key, value] of Object.entries(record.detail)) {
          if (value == null) continue
          lines.push(`  - ${key}: ${escapeCell(typeof value === 'object' ? JSON.stringify(value) : String(value))}`)
        }
      }
    }
    if (record.consoleErrors && record.consoleErrors.length) {
      lines.push('- Console errors:')
      for (const entry of record.consoleErrors) {
        lines.push(`  - \`${entry.level}\` ${escapeCell(entry.text)}${entry.url ? ` (${entry.url})` : ''}`)
      }
    }
    if (record.failedRequests && record.failedRequests.length) {
      lines.push('- Failed requests:')
      for (const request of record.failedRequests) {
        const outcome = request.status != null ? request.status : request.error || 'unknown error'
        lines.push(`  - ${request.method || '?'} ${request.url} → ${outcome}`)
      }
    }
    lines.push('')
  }
  await writeFile(join(outDir, 'report.md'), `${lines.join('\n')}\n`)
  return { jsonPath: join(outDir, 'report.json'), markdownPath: join(outDir, 'report.md') }
}

function escapeCell(text) {
  return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}
