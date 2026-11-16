// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
let audioCtx = null
export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.connect(g); g.connect(audioCtx.destination)
    o.frequency.value = freq || 880; o.type = 'sine'
    const t0 = audioCtx.currentTime + (when || 0)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
  } catch (e) { /* */ }
}

// A quiet downward sweep marks a reply without competing with the voice or the
// conversation. It uses the same AudioContext as every other app sound.
export function swish(enabled) {
  if (!enabled) return
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    const t0 = audioCtx.currentTime
    o.type = 'sine'
    o.frequency.setValueAtTime(1100, t0)
    o.frequency.exponentialRampToValueAtTime(700, t0 + 0.12)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
    o.connect(g); g.connect(audioCtx.destination)
    o.start(t0); o.stop(t0 + 0.13)
  } catch (e) { /* */ }
}
export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
