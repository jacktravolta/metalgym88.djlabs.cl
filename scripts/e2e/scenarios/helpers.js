// Helpers shared by the scenarios.
//
// The app and its landing live at the same path and are told apart by the
// hash (`/` is the landing, `/#/home` is the app), so switching between them
// needs a reload — a fragment-only navigation never re-runs the boot.
import { extractTokenUrls } from '../lib/mailbox.js'
import { blocked, fail } from '../runner.js'
import { CorsBlocked, StepTimeout } from '../page.js'
import { BASE_URL, HEART, TEXT } from '../config.js'
import { setTimeout as delay } from 'node:timers/promises'

// The platform answers in seconds, not in milliseconds (it sends a mail, it
// talks to a payment provider). The window is generous but bounded: a slow
// platform must not turn into an open-ended wait.
const PLATFORM_TIMEOUT = 90000

/** The disposable inbox, or a BLOCKED with the exact reason it is missing. */
export function requireMailbox(context) {
  if (!context.mailbox) {
    throw blocked(context.mailboxError || 'the disposable mailbox could not be created')
  }
  return context.mailbox
}

/**
 * Waits for one platform answer.
 *
 * Two things can keep the answer from coming, and they mean very different
 * things:
 *
 *  · the browser refused the call (CORS): the request never left the page.
 *    That is a product defect, so it fails fast with the whole diagnosis.
 *  · the platform is slow: the wait continues until the bound expires.
 */
export async function awaitResponse(page, predicate, { timeoutMs = PLATFORM_TIMEOUT, url = null, since = null, label = 'the platform call' } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = page.requests.find(r => r.status != null && predicate(r))
    if (found) return found
    const cors = page.corsDiagnosisFor(url, { since })
    if (cors) throw new CorsBlocked(cors.message, cors)
    await new Promise(r => setTimeout(r, 100))
  }
  throw new StepTimeout(`${label} did not answer within ${timeoutMs}ms`, {
    requests: page.requests
      .filter(r => !url || (r.url || '').includes(String(url).split('?')[0]))
      .map(r => `${r.method || '?'} ${r.url} -> ${r.status || r.errorText || 'pending'}`),
  })
}

/** Waits for the platform's answer to one already observed request. */
export async function platformResponse(page, request, options = {}) {
  return awaitResponse(
    page,
    r => r.id === request.id,
    { url: request.url, ...options }
  )
}

/** Opens the public landing (a fresh boot, hash removed). */
/**
 * Opens a route, retrying once.
 *
 * A navigation can fail for reasons that have nothing to do with the
 * product: the box's resolver dropped a lookup, the connection was cut, the
 * browser was still leaving the previous origin. One retry is the honest way
 * to tell the two apart — the second attempt says whether the product is
 * really broken. Two failures in a row are still a failure.
 */
async function openRoute(page, url, { timeoutMs = 30000, attempts = 2 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.goto(url, { timeoutMs })
      await page.reload({ timeoutMs })
      return
    } catch (e) {
      lastError = e
      await delay(500)
    }
  }
  throw lastError
}

export async function openLanding(page) {
  await openRoute(page, `${BASE_URL}/`)
}

/** Opens a route of the app itself (a fresh boot with the hash in place). */
export async function openApp(page, route = '/home') {
  await openRoute(page, `${BASE_URL}/#${route}`)
}

/**
 * Signs out through the app's own UI (Settings → Cerrar sesión → confirm).
 * Returns the logout request when the platform answered it, or null when the
 * browser held no session to begin with.
 */
export async function signOutThroughUi(page) {
  await openApp(page, '/settings')
  const signedIn = await page.waitForText(TEXT.signOut, 10000)
  if (!signedIn) return null
  await page.clickText(TEXT.signOut, { exact: true })
  await page.expectText('¿Cerrar sesión?', 15000)
  // The account view has both "Cerrar sesión" and "Cerrar sesión en todos los
  // dispositivos". The confirmation dialog is the only .center surface, so the
  // scope makes the destructive click unambiguous.
  await page.clickText(TEXT.signOut, { exact: true, scope: '.center' })
  const logout = await page.waitForResponse(r => r.method === 'POST' && r.path === '/auth/logout', 20000).catch(() => null)
  return logout
}

/** Waits for the first visible copy from a small list of locale variants. */
async function firstVisibleText(page, texts, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const text of texts) {
      if (await page.waitForText(text, 100)) return text
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return null
}

/**
 * Makes sure the browser holds a live session, signing in through the app's
 * own gate when it does not.
 */
export async function ensureSignedIn(page, context) {
  await openApp(page, '/home')
  const existing = await page.waitForAriaLabel('créditos', 8000)
  if (existing) return { balance: existing, signedIn: true }
  // The locale chunk can load late (or fail independently). The English copy
  // is the same app control, so a delayed translation must not hide the gate.
  const linkAlternative = await firstVisibleText(page, [
    TEXT.emailLinkInstead,
    'Email me a sign-in link instead',
  ], 20000)
  if (!linkAlternative) {
    throw new StepTimeout('the sign-in gate never showed its email-link option', {
      pageText: await page.bodyText().catch(() => ''),
    })
  }
  await page.clickText(linkAlternative)
  const magicTitle = await firstVisibleText(page, [
    TEXT.magicLinkTitle,
    'Sign-in link by email',
  ], 15000)
  if (!magicTitle) throw new StepTimeout('the magic-link form never showed its heading')
  const emailField = await firstVisibleText(page, [TEXT.appEmail, 'Email'], 10000)
  if (!emailField) throw new StepTimeout('the magic-link form never showed its email field')
  await page.fill(emailField, context.email)
  const terms = await firstVisibleText(page, [TEXT.terms, 'I accept the Terms and Conditions'], 10000)
  if (!terms) throw new StepTimeout('the magic-link form never showed its terms consent')
  await page.checkByText(terms)
  context.sentAt = new Date().toISOString()
  const sendLink = await firstVisibleText(page, [TEXT.sendLink, 'Send the link'], 10000)
  if (!sendLink) throw new StepTimeout('the magic-link form never showed its send button')
  await page.clickText(sendLink)
  const request = await page.waitForRequest(r => r.method === 'POST' && r.path === '/auth/magic-link', 20000)
  // The platform has to answer BEFORE a mail can be expected: waiting for a
  // mail that was never requested would only hide the real cause.
  const response = await platformResponse(page, request)
  if (response.status !== 200) {
    throw fail(`the platform answered the magic-link request with HTTP ${response.status}`)
  }
  const { me } = await redeemLatestLink(page, context, { request })
  const balance = await page.waitForAriaLabel('créditos', 20000)
  return { balance, signedIn: true, me }
}

/**
 * Opens the app as a guest ("Continuar sin cuenta").
 *
 * The product works offline-first: without an account the training log, the
 * plan and the history live in the device. The wallet and the synced profile
 * are the parts that need a platform session.
 */
export async function continueAsGuest(page) {
  await openApp(page, '/home')
  const gate = await page.waitForText(TEXT.continueWithoutAccount, 20000)
  if (!gate) throw new StepTimeout(`the sign-in gate never showed "${TEXT.continueWithoutAccount}"`)
  await page.clickText(TEXT.continueWithoutAccount)
  const home = await waitForHomeHeading(page)
  if (!home) throw new StepTimeout('the guest mode did not open the home view')
  return home
}

/**
 * The home view greets a signed-in person ("Hola <name>") and shows the
 * product name to a guest ("metalgym88").
 */
export async function waitForHomeHeading(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const heading = await page.headingText('h1').catch(() => null)
    if (heading && /^(hola|metalgym88)/i.test(heading)) return heading
    await new Promise(r => setTimeout(r, 120))
  }
  return null
}

/**
 * Replaces window.open with a recording stub.
 *
 * The app opens the payment gateway in another tab. On this platform install
 * the gateway answers a plain GET by approving the order, so the harness
 * records the hand-off instead of following it: the URL the app produced is
 * proven, and no payment is ever completed.
 */
export async function interceptWindowOpen(page) {
  return page.evaluate(`
    window.__e2e = { gatewayUrl: null, opened: [] };
    const location = {};
    Object.defineProperty(location, 'href', {
      configurable: true,
      get: () => '',
      set: (value) => { window.__e2e.gatewayUrl = String(value); },
    });
    const stub = { location, close() {}, opener: null };
    window.open = function (url) {
      window.__e2e.opened.push(String(url == null ? '' : url));
      return stub;
    };
    return true;
  `)
}

/**
 * Reads the newest magic-link email and redeems it through the front's own
 * path (<front>/auth/verify?token=…), which is the contract the app
 * implements for a one-tap sign-in link.
 */
export async function redeemLatestLink(page, context, { timeoutMs = 120000, request = null } = {}) {
  const mailbox = requireMailbox(context)
  let found
  try {
    found = await mailbox.latestWithSubject(/Tu enlace para ingresar a metalgym88/i, {
      timeoutMs,
      since: context.sentAt || null,
    })
  } catch (e) {
    throw blocked(`no magic-link email arrived: ${e && e.message ? e.message : String(e)}`)
  }
  const { message, body } = found
  const urls = extractTokenUrls(body)
  if (!urls.length) {
    throw blocked(`the magic-link email "${message.subject}" carried no verification URL`)
  }
  const token = new URL(urls[0]).searchParams.get('token')
  if (!token) throw new Error('the verification URL carried no token')
  const verifyUrl = `${BASE_URL}/auth/verify?token=${encodeURIComponent(token)}&heart=${encodeURIComponent(HEART)}`
  // The verification is a plain navigation: it gets the same retry as the
  // app's own routes, because a dropped lookup is not a product verdict.
  let verified = null
  let verifyError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      verified = await page.goto(verifyUrl, { timeoutMs: 30000 })
      break
    } catch (e) {
      verifyError = e
      await delay(500)
    }
  }
  if (!verified) throw verifyError || new Error('the verification link could not be opened')
  const me = await awaitResponse(
    page,
    r => r.method === 'GET' && r.path === '/auth/me' && r.status === 200,
    { timeoutMs: 30000, url: '/auth/me', label: 'GET /auth/me' }
  )
  return { message, me }
}
