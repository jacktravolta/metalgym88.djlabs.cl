// S2 — registration on the landing.
//
// The product is passwordless: registering asks the platform for a magic link
// (POST /auth/magic-link) with the Terms accepted. The proof is the request
// itself and the "check your email" state in the UI.
import { fail } from '../runner.js'
import { API_HOST, BASE_URL, HEART, TEXT } from '../config.js'
import { platformResponse } from './helpers.js'

export default {
  id: 'S2',
  title: 'Registration — the access link is issued and the UI confirms it',
  async run({ page, context, log }) {
    const evidence = []
    const scope = { heading: TEXT.landingRegisterHeading }

    await page.goto(`${BASE_URL}/`)
    await page.expectText(TEXT.landingRegisterHeading, 20000)

    await page.fill(TEXT.registerName, 'Harness E2E', { scope })
    await page.fill(TEXT.contactEmail, context.email, { scope })
    const terms = await page.checkByText(TEXT.terms, { scope })
    if (!terms.checked) throw fail('the Terms checkbox did not get ticked')
    log('registration form filled and Terms accepted')

    const before = Date.now()
    context.sentAt = new Date(before).toISOString()
    await page.clickText(TEXT.registerSubmit, { scope })

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
    context.sentAt = before
    evidence.push({ label: 'request', value: `POST ${request.url}` })
    evidence.push({ label: 'body', value: `email=${body.email} heart=${body.heart} terms_accepted=${body.terms_accepted}` })

    const response = await platformResponse(page, request)
    if (response.status !== 200) {
      throw fail(`POST /auth/magic-link answered HTTP ${response.status}`)
    }
    evidence.push({ label: 'HTTP status', value: response.status })

    const sent = await page.waitForText(TEXT.linkSent, 15000)
    if (!sent) {
      throw fail('the UI did not confirm that the link was sent', {
        pageText: await page.bodyText(4000),
      })
    }
    const message = await page.textContaining(TEXT.linkSent, { scope })
    evidence.push({ label: 'UI', value: message || TEXT.linkSent })

    const shot = await page.screenshot('s2-registration-link-sent')
    return {
      reason: `POST /auth/magic-link reached ${API_HOST} with heart=${HEART} and terms accepted (HTTP ${response.status}); the UI asked to check the inbox`,
      evidence,
      screenshots: shot.path ? [shot.path] : [],
    }
  },
}
