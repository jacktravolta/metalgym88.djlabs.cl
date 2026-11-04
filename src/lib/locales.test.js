import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import es from '../locales/es.js'
import { getLang } from './i18n.js'

// English source strings are the i18n keys; t() silently falls back to the
// English source when a locale file misses one, so a Spanish gap shows up as
// mixed-language UI instead of a failing build. This test pins the DEFAULT
// locale (es) to the full key set actually used in the components: any new
// t('...') literal without a Spanish entry fails here with the exact key.
// Only es is asserted — the other locales are upstream packs that may trail.

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'locales' || name === 'instr' || name === 'node_modules') continue
      yield* walk(p)
    } else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) {
      yield p
    }
  }
}

// Extracts the first string literal of every t('...') / t("...") call and
// evaluates it exactly as the JS parser would (handles \uXXXX, \n, \', …),
// so the key here equals the key i18n receives at runtime.
function keysOf(source) {
  const keys = new Set()
  const rx = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g
  let m
  while ((m = rx.exec(source)) !== null) {
    let lit
    try {
      lit = Function(`"use strict"; return (${m[1]})`)()
    } catch {
      lit = m[1].slice(1, -1).replace(/\\(['"\\])/g, '$1')
    }
    if (typeof lit === 'string' && lit.trim() !== '') keys.add(lit)
  }
  return keys
}

describe('es locale covers every literal t() key used in src', () => {
  it('starts in Spanish by default (new install, no stored preference)', () => {
    expect(getLang()).toBe('es')
    // The store's initial state and the App fallback are read from source: the
    // store module needs a DOM (document), which the test environment has not.
    const store = readFileSync(join(root, 'store/useStore.js'), 'utf8')
    const app = readFileSync(join(root, 'App.jsx'), 'utf8')
    expect(store).toMatch(/lang:\s*'es'/)
    expect(app).toMatch(/S\.lang \|\| 'es'/)
  })

  it('has a Spanish entry for each key (no silent English fallbacks)', () => {
    const used = new Set()
    for (const file of walk(root)) {
      for (const k of keysOf(readFileSync(file, 'utf8'))) used.add(k)
    }
    const missing = [...used].filter(k => !(k in es)).sort()
    expect(missing, `${missing.length} key(s) missing from es.js`).toEqual([])
  })
})
