// S7 — the legal pages the landing points at.
//
// The front links "Términos y Condiciones" and "Privacidad" to the platform
// host. This scenario opens both and shows what the server really answers:
// the final URL, the status, the title and a byte/hash comparison, so the
// defect is evidence and not a suspicion.
import { createHash } from 'node:crypto'
import { fail } from '../runner.js'
import { BASE_URL, TEXT } from '../config.js'
import { openLanding } from './helpers.js'

function fingerprint(body) {
  return {
    bytes: Buffer.byteLength(body, 'utf8'),
    sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  }
}

async function inspect(page, url) {
  const from = page.requests.length
  const navigation = await page.goto(url, { timeoutMs: 30000 })
  const documents = page.requests.slice(from).filter(r => r.type === 'Document')
  const document = documents[documents.length - 1] || null
  const status = document ? document.status : navigation.status
  const redirects = documents
    .filter(r => r.redirectStatus)
    .map(r => `${r.redirectStatus} ${r.redirectUrl} → ${r.url}`)
  let body = ''
  if (document) {
    body = (await page.responseBody(document.id)) || ''
  }
  const title = await page.title().catch(() => '')
  const marker = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ''
  const h1 = (body.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1] || ''
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
  return {
    requested: url,
    finalUrl: navigation.finalUrl,
    status,
    redirects,
    title,
    titleTag: clean(marker),
    heading: clean(h1.replace(/<[^>]+>/g, '')),
    body,
    ...fingerprint(body),
  }
}

export default {
  id: 'S7',
  title: 'Legal pages — what the Terms and Privacy links really answer',
  async run({ page, context, log }) {
    const evidence = []
    const screenshots = []

    await openLanding(page)
    await page.expectText(TEXT.termsLink, 20000)

    const termsLinks = await page.linksWithText(TEXT.termsLink)
    const privacyLinks = await page.linksWithText(TEXT.privacyLink)
    if (!termsLinks.length) throw fail('the landing has no "Términos y Condiciones" link')
    if (!privacyLinks.length) throw fail('the landing has no "Privacidad" link')

    const termsHref = termsLinks[0].href
    const privacyHref = privacyLinks[0].href
    evidence.push({ label: 'Terms link', value: termsHref })
    evidence.push({ label: 'Privacy link', value: privacyHref })
    evidence.push({
      label: 'every Terms link points to the same URL',
      value: [...new Set(termsLinks.map(l => l.href))].join(' | '),
    })

    const terms = await inspect(page, termsHref)
    const shotTerms = await page.screenshot('s7-legal-terminos')
    screenshots.push(shotTerms.path)
    evidence.push({ label: 'Terms — requested URL', value: terms.requested })
    evidence.push({ label: 'Terms — final URL', value: terms.finalUrl })
    evidence.push({ label: 'Terms — HTTP status', value: terms.status })
    evidence.push({ label: 'Terms — redirect chain', value: terms.redirects.join(' | ') || 'none' })
    evidence.push({ label: 'Terms — title', value: terms.title || terms.titleTag })
    evidence.push({ label: 'Terms — bytes / sha256', value: `${terms.bytes} / ${terms.sha256}` })
    evidence.push({ label: 'Terms — heading', value: terms.heading })

    const privacy = await inspect(page, privacyHref)
    const shotPrivacy = await page.screenshot('s7-legal-privacidad')
    screenshots.push(shotPrivacy.path)
    evidence.push({ label: 'Privacy — requested URL', value: privacy.requested })
    evidence.push({ label: 'Privacy — final URL', value: privacy.finalUrl })
    evidence.push({ label: 'Privacy — HTTP status', value: privacy.status })
    evidence.push({ label: 'Privacy — redirect chain', value: privacy.redirects.join(' | ') || 'none' })
    evidence.push({ label: 'Privacy — title', value: privacy.title || privacy.titleTag })
    evidence.push({ label: 'Privacy — bytes / sha256', value: `${privacy.bytes} / ${privacy.sha256}` })
    evidence.push({ label: 'Privacy — heading', value: privacy.heading })

    const identical = terms.sha256 === privacy.sha256 && terms.bytes === privacy.bytes
    evidence.push({
      label: 'both documents identical',
      value: identical ? `yes — the same ${terms.bytes}-byte document` : 'no',
    })

    // A legal document does not change between two visits. Fetching the same
    // URL again tells a static page (a real legal text) from a live one (a
    // marketing page of another product that moves with every request).
    const again = await inspect(page, termsHref)
    evidence.push({
      label: 'same URL fetched again',
      value: `${again.bytes} bytes, sha256 ${again.sha256.slice(0, 16)}…` +
        (again.bytes === terms.bytes && again.sha256 === terms.sha256
          ? ' (identical: a static document)'
          : ' (different: the page changes between requests — a live page, not a legal text)'),
    })

    const foreign = /jur[ií]d|abogado|legal|asesor/i.test(`${terms.title} ${terms.heading} ${terms.body.slice(0, 4000)}`)
    evidence.push({
      label: 'document belongs to another product',
      value: foreign ? 'yes — the body names a legal assistant, not metalgym88' : 'no marker found',
    })

    const offOrigin = !termsHref.startsWith(BASE_URL) || !privacyHref.startsWith(BASE_URL)
    evidence.push({
      label: 'links served by the front origin',
      value: offOrigin ? 'no — both point at the platform host' : 'yes',
    })

    if (!identical) {
      return {
        status: 'PASS',
        reason: 'the two legal links answer two different documents',
        evidence,
        screenshots: screenshots.filter(Boolean),
      }
    }

    return {
      status: 'FAIL',
      reason:
        `both legal links answer the SAME ${terms.bytes}-byte document (sha256 ${terms.sha256.slice(0, 16)}…, ` +
        `title "${terms.title || terms.titleTag}") served by ${new URL(termsHref).host} — not a metalgym88 legal page`,
      evidence,
      screenshots: screenshots.filter(Boolean),
    }
  },
}
