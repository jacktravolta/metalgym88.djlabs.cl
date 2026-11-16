// Media in a coach answer.
//
// The model can return a URL in three shapes: a markdown image, a markdown link
// or a bare URL. This parser turns only safe web URLs into media segments;
// every other value stays ordinary text. That keeps `javascript:`, `data:` and
// `file:` out of clickable elements without hiding them from the person.
//
// The parser is deliberately dependency-free and side-effect-free: the speech
// cleaner uses the same result, so the visible answer and the spoken answer
// describe the same thing.

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
]

const MEDIA_PATTERN = /!\[([^\]]*)\]\(([^)\n]+)\)|\[([^\]]*)\]\(([^)\n]+)\)|https?:\/\/[^\s<>"'`]+/gi
const BARE_HTTP_PATTERN = /https?:\/\/[^\s<>"'`]+/gi

/** True only for an absolute HTTP or HTTPS URL. */
export function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** True when an HTTP URL ends in a supported image extension. */
export function isImageUrl(value) {
  if (!isHttpUrl(value)) return false
  try {
    const pathname = new URL(String(value).trim()).pathname.toLowerCase()
    return IMAGE_EXTENSIONS.some(extension => pathname.endsWith(extension))
  } catch {
    return false
  }
}

/** The host shown beside a link label, without the scheme or credentials. */
export function hostOf(value) {
  if (!isHttpUrl(value)) return ''
  try {
    return new URL(String(value).trim()).hostname
  } catch {
    return ''
  }
}

function markdownDestination(value) {
  const destination = String(value || '').trim()
  if (!destination) return ''
  // Markdown allows an optional title after the destination: (url "title").
  const first = destination.split(/\s+/)[0]
  return first.replace(/^<|>$/g, '')
}

function cleanLinkLabel(value) {
  const withoutUrls = String(value || '').replace(BARE_HTTP_PATTERN, ' ')
  return withoutUrls.replace(/\s+/g, ' ').trim()
}

function splitTrailingPunctuation(value) {
  let url = value
  let suffix = ''
  while (/[.,!?;:]$/.test(url)) {
    suffix = url.slice(-1) + suffix
    url = url.slice(0, -1)
  }
  while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    suffix = `)${suffix}`
    url = url.slice(0, -1)
  }
  return { url, suffix }
}

function pushText(segments, text) {
  if (!text) return
  const previous = segments[segments.length - 1]
  if (previous && previous.type === 'text') previous.text += text
  else segments.push({ type: 'text', text })
}

/**
 * Parse one coach answer into text, image and link segments.
 *
 * Images are numbered within this message only. A bare URL is an image when its
 * path ends in a supported image extension; markdown syntax is explicit, so a
 * markdown image is always an image and a markdown link is always a link.
 */
export function parseChatMedia(text) {
  const input = text == null ? '' : String(text)
  const segments = []
  let cursor = 0
  let figure = 0

  MEDIA_PATTERN.lastIndex = 0
  let match
  while ((match = MEDIA_PATTERN.exec(input)) !== null) {
    const [full, imageAlt, imageDestination, linkLabel, linkDestination] = match
    pushText(segments, input.slice(cursor, match.index))

    if (imageAlt !== undefined) {
      const url = markdownDestination(imageDestination)
      if (isHttpUrl(url)) {
        figure += 1
        segments.push({ type: 'image', url, alt: imageAlt.trim(), figure })
      } else {
        pushText(segments, full)
      }
    } else if (linkLabel !== undefined) {
      const url = markdownDestination(linkDestination)
      if (isHttpUrl(url)) {
        segments.push({
          type: 'link',
          url,
          label: cleanLinkLabel(linkLabel),
          host: hostOf(url),
        })
      } else {
        pushText(segments, full)
      }
    } else {
      const { url, suffix } = splitTrailingPunctuation(full)
      if (!isHttpUrl(url)) {
        pushText(segments, full)
      } else if (isImageUrl(url)) {
        figure += 1
        segments.push({ type: 'image', url, alt: '', figure })
        pushText(segments, suffix)
      } else {
        segments.push({ type: 'link', url, label: '', host: hostOf(url) })
        pushText(segments, suffix)
      }
    }

    cursor = match.index + full.length
  }

  pushText(segments, input.slice(cursor))
  return segments
}
