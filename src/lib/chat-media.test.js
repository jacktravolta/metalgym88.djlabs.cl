// The parser that decides what a coach answer really contains.
//
// A raw URL in the bubble is noise for the person (and the speech engine reads
// it out loud), so the text is split into segments and the UI renders what each
// one is. The rules are pinned here: a URL is never shown as text, only http
// and https become clickable, and the figure number counts the images inside
// ONE answer.
import { describe, it, expect } from 'vitest'
import { parseChatMedia, isHttpUrl, isImageUrl, hostOf } from './chat-media.js'

const types = segments => segments.map(segment => segment.type)

describe('isHttpUrl / isImageUrl / hostOf', () => {
  it('accepts only absolute http and https addresses', () => {
    expect(isHttpUrl('https://ejemplo.cl/guia')).toBe(true)
    expect(isHttpUrl('http://127.0.0.1:8098/health')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html;base64,AAA')).toBe(false)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('/relative/path')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl(null)).toBe(false)
  })

  it('recognises an image by its extension, ignoring the query string', () => {
    expect(isImageUrl('https://cdn.ejemplo.cl/press.jpg')).toBe(true)
    expect(isImageUrl('https://cdn.ejemplo.cl/press.PNG')).toBe(true)
    expect(isImageUrl('https://cdn.ejemplo.cl/press.webp?v=2')).toBe(true)
    expect(isImageUrl('https://cdn.ejemplo.cl/guia')).toBe(false)
    expect(isImageUrl('javascript:alert(1)')).toBe(false)
  })

  it('reads the host of an address without the scheme', () => {
    expect(hostOf('https://cdn.ejemplo.cl/press.jpg')).toBe('cdn.ejemplo.cl')
    expect(hostOf('not a url')).toBe('')
  })
})

describe('parseChatMedia', () => {
  it('leaves a plain answer untouched', () => {
    expect(parseChatMedia('El press de banca se hace así.')).toEqual([
      { type: 'text', text: 'El press de banca se hace así.' },
    ])
  })

  it('turns a bare image address into a numbered figure, never into text', () => {
    const segments = parseChatMedia('Mirá esto https://cdn.ejemplo.cl/press.jpg listo')
    expect(types(segments)).toEqual(['text', 'image', 'text'])
    expect(segments[1]).toMatchObject({
      type: 'image',
      url: 'https://cdn.ejemplo.cl/press.jpg',
      alt: '',
      figure: 1,
    })
    // The address itself is nowhere in the text the person reads.
    expect(segments.map(s => s.text || '').join('')).not.toContain('https://')
  })

  it('numbers the figures inside the answer, from one', () => {
    const segments = parseChatMedia([
      'https://cdn.ejemplo.cl/uno.jpg',
      'y https://cdn.ejemplo.cl/dos.png',
      'y https://cdn.ejemplo.cl/tres.gif',
    ].join(' '))
    const figures = segments.filter(s => s.type === 'image').map(s => s.figure)
    expect(figures).toEqual([1, 2, 3])
  })

  it('keeps a markdown image with its alt text', () => {
    const segments = parseChatMedia('![Press de banca](https://cdn.ejemplo.cl/press.jpg)')
    expect(types(segments)).toEqual(['image'])
    expect(segments[0]).toMatchObject({
      type: 'image',
      url: 'https://cdn.ejemplo.cl/press.jpg',
      alt: 'Press de banca',
      figure: 1,
    })
  })

  it('turns a bare address that is not an image into a link with its host', () => {
    const segments = parseChatMedia('Mira https://ejemplo.cl/guia por favor')
    expect(types(segments)).toEqual(['text', 'link', 'text'])
    expect(segments[1]).toMatchObject({
      type: 'link',
      url: 'https://ejemplo.cl/guia',
      label: '',
      host: 'ejemplo.cl',
    })
    expect(segments.map(s => s.text || '').join('')).not.toContain('https://')
  })

  it('keeps the label of a markdown link', () => {
    const segments = parseChatMedia('Ver [la guía](https://ejemplo.cl/guia).')
    expect(types(segments)).toEqual(['text', 'link', 'text'])
    expect(segments[1]).toMatchObject({
      type: 'link',
      url: 'https://ejemplo.cl/guia',
      label: 'la guía',
      host: 'ejemplo.cl',
    })
  })

  it('never turns an unsafe scheme into something clickable', () => {
    const segments = parseChatMedia('Cuidado con javascript:alert(1) y con data:text/html,boom')
    expect(types(segments)).toEqual(['text'])
    expect(segments[0].text).toContain('javascript:alert(1)')
    expect(segments[0].text).toContain('data:text/html,boom')
  })

  it('keeps the punctuation that followed the address', () => {
    const segments = parseChatMedia('Entra a https://ejemplo.cl/guia.')
    expect(types(segments)).toEqual(['text', 'link', 'text'])
    expect(segments[1].url).toBe('https://ejemplo.cl/guia')
    expect(segments[2].text).toBe('.')
  })

  it('handles an empty answer without throwing', () => {
    expect(parseChatMedia('')).toEqual([])
    expect(parseChatMedia(null)).toEqual([])
    expect(parseChatMedia(undefined)).toEqual([])
  })
})
