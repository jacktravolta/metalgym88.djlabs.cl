// S4 — access recovery.
//
// This product is passwordless: there is no password to reset. The recovery
// path is "ask for the access link again". The scenario therefore
//   · looks for an explicit recovery entry ("recuperar acceso/contraseña") and
//     reports exactly what it found (or that there is none), and
//   · drives the real recovery door — the "sign-in link by email" entry — and
//     proves that a new link is issued.
import { fail } from '../runner.js'
import { API_HOST, HEART, TEXT } from '../config.js'
import { openLanding, platformResponse } from './helpers.js'

const RECOVERY_WORDS = /recuperar|olvid|restablecer|contraseña|password|forgot|reset/i

async function recoveryScan(page, label, evidence) {
  const text = await page.bodyText(20000)
  const sentences = String(text || '')
    .split(/\n|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s && RECOVERY_WORDS.test(s))
  const links = await page.linksWithText('contraseña').catch(() => [])
  const entries = await page.linksWithText('recuperar').catch(() => [])
  evidence.push({
    label: `${label} — recovery wording`,
    value: sentences.length ? sentences.slice(0, 6).join(' | ') : 'none',
  })
  evidence.push({
    label: `${label} — recovery links/buttons`,
    value: [...links, ...entries].length
      ? [...links, ...entries].map(l => `${l.tag}:${l.text}`).join(' | ')
      : 'none',
  })
  return { sentences, links: [...links, ...entries] }
}

export default {
  id: 'S4',
  title: 'Access recovery — the access link can be re-issued (there is no password to reset)',
  async run({ page, context, log }) {
    const evidence = []

    // The landing's own recovery door: "Iniciar sesión" in the registration
    // panel re-issues the same passwordless access link for an existing
    // account. It does not require ending the current session first.
    await openLanding(page)
    await page.expectText(TEXT.landingRegisterHeading, 20000)
    const scope = { heading: TEXT.landingRegisterHeading }
    const landingScan = await recoveryScan(page, 'landing', evidence)

    const explicitEntry = landingScan.links.find(l =>
      /recuperar|olvid|restablecer/i.test(l.text || '')
    )
    evidence.push({
      label: 'explicit "recover access/password" entry',
      value: explicitEntry ? `${explicitEntry.tag}:${explicitEntry.text}` : 'none — the product is passwordless',
    })

    // The recovery door that does exist: "Iniciar sesión" asks for the same
    // access link again, without a password and without re-registering.
    await page.fill(TEXT.contactEmail, context.email, { scope })
    await page.checkByText(TEXT.terms, { scope })
    context.sentAt = new Date().toISOString()
    await page.clickText(TEXT.loginSubmit, { scope })

    const request = await page.waitForRequest(
      r => r.method === 'POST' && r.path === '/auth/magic-link',
      20000
    )
    if (request.host !== API_HOST) {
      throw fail(`POST /auth/magic-link went to ${request.host}, expected ${API_HOST}`)
    }
    let body = {}
    try { body = JSON.parse(request.postData || '{}') } catch { /* keep the empty object */ }
    if (body.heart !== HEART) {
      throw fail(`POST /auth/magic-link carried heart=${JSON.stringify(body.heart)}, expected ${HEART}`)
    }
    if (body.email !== context.email) {
      throw fail(`POST /auth/magic-link carried email=${JSON.stringify(body.email)}, expected ${context.email}`)
    }
    if (body.terms_accepted !== true) {
      throw fail('POST /auth/magic-link did not carry the Terms acceptance')
    }
    evidence.push({ label: 'request', value: `POST ${request.url}` })
    evidence.push({ label: 'body', value: `email=${body.email} heart=${body.heart} terms_accepted=${body.terms_accepted}` })

    const response = await platformResponse(page, request)
    if (response.status !== 200) {
      throw fail(`POST /auth/magic-link answered HTTP ${response.status}`)
    }
    evidence.push({ label: 'HTTP status', value: response.status })

    const sent = await page.waitForText(TEXT.linkSent, 15000)
    if (!sent) {
      throw fail('the UI did not confirm that a fresh access link was sent', {
        pageText: await page.bodyText(4000),
      })
    }
    evidence.push({ label: 'UI', value: await page.textContaining(TEXT.linkSent) || TEXT.linkSent })
    log('a fresh access link was requested from the recovery entry')

    const shot = await page.screenshot('s4-access-recovery')
    return {
      reason:
        `no explicit "reset password" entry exists (the product is passwordless); the recovery door ` +
        `"${TEXT.loginSubmit}" issued a new link (HTTP ${response.status})`,
      evidence,
      screenshots: shot.path ? [shot.path] : [],
    }
  },
}
