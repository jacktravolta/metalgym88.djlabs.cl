// Text prepared for speech.
//
// The coach answers in markdown: **bold**, lists, links, headings. A speech
// engine reads every one of those markers out loud — "asterisco" in the middle
// of a sentence, sometimes several times — and the sentence stops making sense.
//
// The visible bubble keeps the markdown; this cleans ONLY what is spoken. The
// rules are deliberately conservative: text that is not a marker survives
// untouched, so a price ("$15.000"), a percentage ("40%") or a code name
// ("user_id") is still read the way it was written.
import { isImageUrl } from './chat-media.js'
export function toSpeechText(input) {
  if (input == null) return ''
  let t = String(input).replace(/\r\n?/g, '\n')

  // Fenced code: keep the code, drop the fence markers.
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  // Inline code: `x` -> x
  t = t.replace(/`([^`]*)`/g, '$1')

  // Images before links (an image link would otherwise lose its alt text).
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Links: [label](url) -> label. The URL is never read out loud.
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Autolinks: <https://…> -> https://…
  t = t.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, '$1')

  // A bare URL is not speech either. The bubble shows it as a figure (an image)
  // or as a link, and the voice says the SAME thing instead of reading the
  // address out loud: "https://cdn…/press.jpg" read character by character is
  // noise, not information. The wording follows what the person sees.
  t = t.replace(/https?:\/\/[^\s<>"'`]+/gi, match => {
    const address = match.replace(/[.,;:!?]+$/, '')
    return isImageUrl(address) ? 'imagen' : 'enlace'
  })

  // Emphasis, widest first: ***both***, **bold**, __bold__, *italic*, _italic_
  // The content stays on one line: a stray "*" far away from its partner must
  // not swallow the text in between.
  t = t.replace(/(\*\*\*|___)(\S(?:[^\n]*?\S)?)\1/g, '$2')
  t = t.replace(/(\*\*|__)(\S(?:[^\n]*?\S)?)\1/g, '$2')
  t = t.replace(/(\*|_)(\S(?:[^\n]*?\S)?)\1/g, '$2')

  // Heading and blockquote markers. The leading space class is [ \t] and never
  // \s: \s also matches the line break, and the marker would then eat the blank
  // line that separated the paragraphs.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '')

  // List markers: "- ", "* ", "+ ", "1. ", "2) "
  t = t.replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, '')

  // Horizontal rules: a line of dashes, stars or underscores.
  t = t.replace(/^[ \t]{0,3}([-*_][ \t]?){3,}$/gm, '')

  // Whatever markdown punctuation is left (a stray asterisk, a pipe from a
  // table, a tilde) is not speech: it goes away.
  t = t.replace(/[*_~`#|]/g, '')

  // Tidy the spacing the removals may have left behind.
  t = t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return t
}
