// S2b — verifying the account from the real email.
//
// The platform mails a one-tap link; the suite owns a disposable inbox
// (mail.tm) so the link can actually be read. Two things are checked:
//
//   1. the link exactly as it was delivered — does it open?
//   2. the session it is supposed to create — does GET /auth/me answer 200?
//
// The front also implements its own redemption path (<front>/auth/verify,
// see src/lib/platform/landing.js), so when the delivered link is dead the
// scenario still tries that path and says plainly which one worked.
import { extractTokenUrls } from '../lib/mailbox.js'
import { blocked, fail } from '../runner.js'
import { BASE_URL, HEART } from '../config.js'
import { awaitResponse, requireMailbox } from './helpers.js'

export default {
  id: 'S2b',
  title: 'Verification — the mailed link opens and the session comes alive',
  async run({ page, context, log }) {
    const evidence = []

    // The registration call never reached the platform: there is no mail to
    // read, and waiting for one would only hide the real cause.
    if (context.cors) {
      throw fail(`the magic link was never requested — ${context.cors.message}`, context.cors)
    }

    let mail
    try {
      mail = await requireMailbox(context).latestWithSubject(
        /Tu enlace para ingresar a metalgym88/i,
        { timeoutMs: 120000 }
      )
    } catch (e) {
      throw blocked(`no magic-link email arrived: ${e && e.message ? e.message : String(e)}`)
    }
    const { message, body } = mail
    evidence.push({ label: 'email', value: `${message.subject} (from ${message.from && message.from.address})` })

    const urls = extractTokenUrls(body)
    if (!urls.length) {
      throw fail('the magic-link email arrived without a verification URL', {
        subject: message.subject,
        size: message.size,
      })
    }
    const link = urls[0]
    const parsed = new URL(link)
    const token = parsed.searchParams.get('token')
    if (!token) throw fail('the verification URL carried no token')
    evidence.push({
      label: 'link as delivered',
      value: `${parsed.origin}${parsed.pathname}?token=REDACTED`,
    })

    // 1. the link exactly as it was delivered
    const delivered = await page.goto(link, { timeoutMs: 30000 })
    const deliveredStatus = delivered.status
    const deliveredTitle = await page.title()
    evidence.push({ label: 'delivered link — final URL', value: delivered.finalUrl })
    evidence.push({ label: 'delivered link — HTTP status', value: deliveredStatus })
    evidence.push({ label: 'delivered link — title', value: deliveredTitle })
    const shotDead = await page.screenshot('s2b-delivered-link')

    // 2. the session the link was supposed to create.
    // The token is single-use. The delivered URL above is often a dead mirror
    // (a GitHub Pages path in this deployment), so redeem the SAME token on the
    // public front's own verification path. A second redemption of an already
    // consumed token must not be mistaken for a failed session.
    const verifyUrl = `${BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&heart=${encodeURIComponent(HEART)}`
    await page.goto(verifyUrl, { timeoutMs: 30000 })
    const me = await awaitResponse(
      page,
      r => r.method === 'GET' && r.path === '/auth/me' && r.status === 200,
      { timeoutMs: 30000, url: '/auth/me', label: 'GET /auth/me' }
    )
    evidence.push({ label: 'GET /auth/me', value: `HTTP ${me.status} ${me.url}` })
    context.sessionEstablished = true

    const finalUrl = await page.currentUrl()
    if (/token=/.test(finalUrl)) {
      throw fail('the sign-in token is still in the address bar after the session was established')
    }
    evidence.push({ label: 'final URL', value: finalUrl })

    const balanceLabel = await page.ariaLabelWithText('créditos')
    evidence.push({ label: 'balance chip', value: balanceLabel || 'not visible' })

    const shot = await page.screenshot('s2b-session-established')

    if (deliveredStatus !== 200) {
      return {
        status: 'FAIL',
        reason:
          `the delivered link answered HTTP ${deliveredStatus} at ${parsed.origin}${parsed.pathname}; ` +
          `the session was only reachable through the front's own /auth/verify path (GET /auth/me → 200)`,
        evidence,
        screenshots: [shotDead.path, shot.path].filter(Boolean),
      }
    }

    return {
      reason: `the delivered link answered HTTP ${deliveredStatus} and GET /auth/me returned 200`,
      evidence,
      screenshots: [shotDead.path, shot.path].filter(Boolean),
    }
  },
}
