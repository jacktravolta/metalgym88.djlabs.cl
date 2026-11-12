// S1 — the contact form on the landing.
//
// Proof required: the POST /contact really left the browser for the platform
// host with the metalgym88 heart, and the UI answered with a confirmation.
import { fail } from '../runner.js'
import { API_HOST, BASE_URL, HEART, TEXT } from '../config.js'
import { platformResponse } from './helpers.js'

export default {
  id: 'S1',
  title: 'Contact — the message reaches the platform and the UI confirms it',
  async run({ page, context, log }) {
    const evidence = []
    const scope = { heading: TEXT.landingContactHeading }

    await page.goto(`${BASE_URL}/`)
    await page.expectText(TEXT.landingContactHeading, 20000)

    await page.fill(TEXT.contactName, 'Harness E2E metalgym88', { scope })
    await page.fill(TEXT.contactEmail, context.email, { scope })
    await page.fill(TEXT.contactMessage, 'Test message from the metalgym88 E2E harness.', { scope })
    log('contact form filled')

    await page.clickText(TEXT.contactSubmit, { scope })

    const request = await page.waitForRequest(
      r => r.method === 'POST' && r.path === '/contact',
      20000
    )
    if (request.host !== API_HOST) {
      throw fail(`POST /contact went to ${request.host}, expected ${API_HOST}`)
    }
    let body = {}
    try { body = JSON.parse(request.postData || '{}') } catch { /* keep the empty object */ }
    if (body.heart !== HEART) {
      throw fail(`POST /contact carried heart=${JSON.stringify(body.heart)}, expected ${HEART}`)
    }
    if (!body.email || body.email !== context.email) {
      throw fail(`POST /contact carried email=${JSON.stringify(body.email)}, expected ${context.email}`)
    }
    evidence.push({ label: 'request', value: `POST ${request.url}` })
    evidence.push({ label: 'body heart / email', value: `${body.heart} / ${body.email}` })

    const response = await platformResponse(page, request)
    if (response.status !== 200) {
      throw fail(`POST /contact answered HTTP ${response.status}`)
    }
    evidence.push({ label: 'HTTP status', value: response.status })

    const confirmed = await page.waitForText(TEXT.contactConfirmation, 15000)
    if (!confirmed) {
      throw fail('the UI did not show a confirmation after the contact message was sent', {
        pageText: await page.bodyText(4000),
      })
    }
    const message = await page.textContaining(TEXT.contactConfirmation, { scope })
    evidence.push({ label: 'UI', value: message || TEXT.contactConfirmation })
    evidence.push({ label: 'final URL', value: await page.currentUrl() })

    const shot = await page.screenshot('s1-contact-confirmation')
    return {
      reason: `POST /contact reached ${API_HOST} with heart=${HEART} (HTTP ${response.status}) and the UI confirmed it`,
      evidence,
      screenshots: shot.path ? [shot.path] : [],
    }
  },
}
