import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./Modals.jsx', import.meta.url), 'utf8')

describe('shared modal backdrop contract', () => {
  it('keeps centered dialogs and sheets open when the backdrop is clicked', () => {
    const inertBackdrops = source.match(/<div className="mback" \/>/g) || []
    expect(inertBackdrops).toHaveLength(2)
    expect(source).not.toMatch(/<div\s+className="mback"[^>]*onClick/)
  })

  it('preserves explicit close controls and locked swipe behavior', () => {
    expect(source).toMatch(/className="sheet-close"[\s\S]*?aria-label=\{t\('Close'\)\}[\s\S]*?onClick=\{close\}/)
    expect(source).toContain('!sheet.locked && <div className="sheet-close-anchor">')
    expect(source).toContain('if (d.delta > 90 && !sheet.locked)')
  })
})
