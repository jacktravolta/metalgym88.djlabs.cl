// S3 — signing in with the account the suite registered.
//
// The journey starts signed out: the app's own "Cerrar sesión" ends the
// session, and then the landing's "Iniciar sesión" asks the platform for a
// fresh access link. The proof is a live session (GET /auth/me → 200) and the
// balance on screen.
import { fail } from '../runner.js'
import { API_HOST, BASE_URL, HEART, TEXT } from '../config.js'
import { openLanding, platformResponse, redeemLatestLink, signOutThroughUi } from './helpers.js'

export default {
  id: 'S3',
  title: 'Login — a signed-out session comes back with its balance',
  async run({ page, context, log }) {
    const evidence = []

    const logout = await signOutThroughUi(page)
    evidence.push({
      label: 'sign out',
      value: logout ? `POST ${logout.url} → HTTP ${logout.status}` : 'no /auth/logout request seen',
    })
    log('signed out through the app')

    await openLanding(page)
    await page.expectText(TEXT.landingRegisterHeading, 20000)
    const scope = { heading: TEXT.landingRegisterHeading }
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
    evidence.push({ label: 'request', value: `POST ${request.url}` })

    const response = await platformResponse(page, request)
    if (response.status !== 200) {
      throw fail(`POST /auth/magic-link answered HTTP ${response.status}`)
    }
    evidence.push({ label: 'HTTP status', value: response.status })

    const sent = await page.waitForText(TEXT.linkSent, 15000)
    if (!sent) throw fail('the UI did not confirm that the sign-in link was sent')
    evidence.push({ label: 'UI', value: await page.textContaining(TEXT.linkSent, { scope }) || TEXT.linkSent })

    const { me } = await redeemLatestLink(page, context)
    evidence.push({ label: 'GET /auth/me', value: `HTTP ${me.status} ${me.url}` })

    const balanceLabel = await page.waitForAriaLabel('créditos', 20000)
    if (!balanceLabel) {
      throw fail('the session is alive but the credit balance is not visible anywhere on screen', {
        pageText: await page.bodyText(4000),
      })
    }
    evidence.push({ label: 'balance on screen', value: balanceLabel })
    evidence.push({ label: 'final URL', value: await page.currentUrl() })

    const shot = await page.screenshot('s3-login-session')
    return {
      reason: `the sign-in link was issued (HTTP ${response.status}), the session answered HTTP ${me.status} on /auth/me and the balance shows as "${balanceLabel}"`,
      evidence,
      screenshots: shot.path ? [shot.path] : [],
    }
  },
}
