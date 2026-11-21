#!/usr/bin/env node
/**
 * Records the whole-product demo into a single MP4 file.
 *
 * The browser stays visible: the owner watches the run live while this script
 * records the screen (X11) and the sound of the machine (PulseAudio: the
 * output monitor plus the microphone), and writes the result to the Documents
 * folder.
 *
 *   E2E_HEADFUL=1 node scripts/e2e/record-demo.mjs                    # phone (default)
 *   E2E_HEADFUL=1 E2E_MOBILE=0 node scripts/e2e/record-demo.mjs       # desktop
 *   E2E_HEADFUL=1 E2E_SHORT=0 node scripts/e2e/record-demo.mjs        # the long cut
 *
 * Environment:
 *   E2E_RECORD_DIR    where the file is written (default: ~/Documents)
 *   E2E_RECORD_LABEL  the name of the file (default: movil | escritorio)
 *   E2E_MOBILE=0      record the desktop layout instead of the phone one
 *   E2E_SHORT=0       record the full journey instead of the short cut
 */
import { spawn, execFile } from 'node:child_process'
import { mkdir, rm, stat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HOME = process.env.HOME || '/home/test'
const OUT_DIR = process.env.E2E_RECORD_DIR || join(HOME, 'Documents')
// The recorded browser starts on a phone: that is the format the video is
// for. E2E_MOBILE=0 records the desktop layout instead.
const MOBILE = process.env.E2E_MOBILE !== '0'
const LABEL = process.env.E2E_RECORD_LABEL || (MOBILE ? 'movil' : 'escritorio')
const FINAL = join(OUT_DIR, `demo-metalgym-${LABEL}.mp4`)
const RAW = join('/tmp/opencode', `demo-${LABEL}-raw.mp4`)
const TMP_ROOT = '/tmp/opencode'
const DISPLAY = process.env.DISPLAY || ':0.0'
const FRAME_RATE = 25
const DEMO = join(process.cwd(), 'scripts/e2e/full-demo-sandbox.mjs')
// The phone viewport the demo emulates: the video shows the phone screen,
// not the browser window around it.
const MOBILE_VIEWPORT = { width: 390, height: 620 }
// The browser's own toolbar (tab strip + address bar) sits above the page.
// Its height belongs to the Chrome version, not to the product: the crop is
// corrected by this amount and E2E_CHROME_UI_PX overrides it.
const CHROME_UI_PX = Number(process.env.E2E_CHROME_UI_PX || 92)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function shell(command, args, timeoutMs = 15000) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: timeoutMs })
    return String(stdout).trim()
  } catch {
    return ''
  }
}

/** The size of the display the recording is taken from. */
async function displaySize() {
  const output = await shell('xrandr', ['--current'])
  const line = output.split('\n').find(item => item.includes(' connected'))
  const match = line && line.match(/(\d+)x(\d+)\+/)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1366, height: 768 }
}

/**
 * The sounds of the machine: the monitor of the output (what the system
 * plays) and the microphone (what the person says while the demo runs).
 * A source that cannot be opened is simply left out; if none works the
 * recording still carries a silent audio track.
 */
async function audioInputs() {
  const sources = await shell('pactl', ['list', 'short', 'sources'])
  const monitor = sources.split('\n').find(line => line.includes('.monitor'))
  const microphone = sources.split('\n').find(line => line.includes('input') && !line.includes('.monitor'))
  const usable = []
  for (const source of [monitor, microphone]) {
    if (!source) continue
    const name = source.trim().split(/\s+/).slice(1).join(' ')
    const probe = await shell('ffmpeg', ['-hide_banner', '-f', 'pulse', '-i', name, '-t', '1', '-f', 'null', '-'])
    if (!probe.includes('Invalid argument') && !probe.includes('No such file or directory')) {
      usable.push(name)
    }
  }
  return usable
}

/**
 * The window of THIS take, with the geometry the crop needs.
 *
 * The window is found by the harness profile the demo just created: an older
 * browser may still be open on the desktop (a previous take leaves it there
 * on purpose) and its window must never be mistaken for the demo's.
 */
async function browserWindow(profile) {
  if (!profile) return null
  const listing = await shell('wmctrl', ['-lGx'])
  const line = listing.split('\n').find(item => item.includes(profile))
  if (!line) return null
  const fields = line.trim().split(/\s+/)
  const id = fields[0]
  // The client area is the window without the window manager's frame, and it
  // is the only source that does not depend on wmctrl's column order.
  const client = await clientArea(id)
  if (client) return { id, ...client }
  const numbers = fields.map(Number)
  const x = numbers[2]
  const y = numbers[3]
  const width = numbers[4]
  const height = numbers[5]
  if ([x, y, width, height].some(number => !Number.isFinite(number))) return null
  return { id, x, y, width, height }
}

/** The area of a window without the window manager's decorations. */
async function clientArea(id) {
  const output = await shell('xwininfo', ['-id', id])
  const value = pattern => {
    const match = output.match(pattern)
    return match ? Number(match[1]) : null
  }
  const x = value(/^  Absolute upper-left X:\s*(-?\d+)/m)
  const y = value(/^  Absolute upper-left Y:\s*(-?\d+)/m)
  const width = value(/^  Width:\s*(\d+)/m)
  const height = value(/^  Height:\s*(\d+)/m)
  if ([x, y, width, height].some(number => number === null)) return null
  return { x, y, width, height }
}

/** The harness profiles on disk: one per browser the harness has opened. */
async function harnessProfiles() {
  try {
    const entries = await readdir(TMP_ROOT, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('mg88-e2e-chrome-'))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

async function ffprobe(file) {
  const output = await shell('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', file,
  ])
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir('/tmp/opencode', { recursive: true })
  await rm(RAW, { force: true })

  const size = await displaySize()
  const sources = await audioInputs()
  const startedAt = Date.now()
  console.log(`[GRABANDO] ${LABEL} → ${FINAL}`)
  console.log(`[GRABANDO] pantalla ${size.width}x${size.height} @${FRAME_RATE}fps · audio: ${sources.length ? sources.join(' + ') : 'pista muda'}`)

  // The screen is captured with a fixed frame rate, so the video keeps the
  // real timing of the run.
  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'x11grab', '-framerate', String(FRAME_RATE),
    '-video_size', `${size.width}x${size.height}`, '-i', DISPLAY,
  ]
  if (sources.length === 1) {
    ffmpegArgs.push('-f', 'pulse', '-i', sources[0])
  } else if (sources.length > 1) {
    ffmpegArgs.push('-f', 'pulse', '-i', sources[0], '-f', 'pulse', '-i', sources[1])
  } else {
    ffmpegArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
  }
  const audioMap = sources.length === 2
    ? ['-filter_complex', '[1:a][2:a]amix=inputs=2:duration=shortest:dropout_transition=0[a]', '-map', '0:v', '-map', '[a]']
    : sources.length === 1
      ? ['-map', '0:v', '-map', '1:a']
      : ['-map', '0:v', '-map', '1:a']
  ffmpegArgs.push(...audioMap)
  ffmpegArgs.push(
    // The Pulse input stalls when the machine is busy; without room in the
    // queues the frames are dropped and the recording comes out shorter than
    // the run it recorded.
    '-thread_queue_size', '1024',
    '-r', String(FRAME_RATE),
    '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', RAW,
  )

  const recorder = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
  let recorderError = ''
  recorder.stderr.on('data', chunk => { recorderError += chunk.toString() })

  // The window is sized to the screen that is being recorded: the viewer sees
  // the whole page, and the phone take really looks like a phone.
  const windowSize = MOBILE ? '390,720' : `${size.width},${Math.max(600, size.height - 60)}`
  const env = { ...process.env, E2E_HEADFUL: '1', E2E_CDP_PORT: '', E2E_WINDOW_SIZE: windowSize }
  if (MOBILE) env.E2E_MOBILE = '1'
  else delete env.E2E_MOBILE
  // The short cut: the hosted top-up takes minutes and the video is meant to
  // be watched. E2E_SHORT=0 records the full journey.
  if (process.env.E2E_SHORT === '0') delete env.E2E_SHORT
  else env.E2E_SHORT = '1'
  // The demo opens its own browser: the profile it creates is this take's.
  const profilesBefore = new Set(await harnessProfiles())

  const demo = spawn('node', [DEMO], { env, stdio: 'inherit' })

  // The window's geometry is watched while the demo runs: the recording is
  // cropped to the browser at the end.
  let geometry = null
  let raised = false
  const watcher = setInterval(async () => {
    const fresh = (await harnessProfiles()).filter(name => !profilesBefore.has(name))
    if (!fresh.length) return
    const found = await browserWindow(fresh[0])
    if (!found) return
    geometry = found
    if (!raised && found.id) {
      raised = true
      // The take must show the demo and not an older browser left open.
      await shell('wmctrl', ['-i', '-a', found.id])
    }
  }, 2000)

  const code = await new Promise(resolve => demo.on('exit', resolve))
  clearInterval(watcher)

  recorder.kill('SIGINT')
  await new Promise(resolve => recorder.on('exit', resolve))
  if (recorderError.trim()) console.log(`[GRABANDO] ffmpeg: ${recorderError.trim().split('\n').slice(-2).join(' ')}`)
  const rawInfo = await ffprobe(RAW)
  console.log(`[GRABANDO] crudo ${Math.round(Number(rawInfo?.format?.duration || 0))}s · el recorrido duro ${Math.round((Date.now() - startedAt) / 1000)}s`)

  let crop = null
  const fits = geometry
    && geometry.width <= size.width
    && geometry.height <= size.height
    && (geometry.width < size.width || geometry.height < size.height)
  if (fits) {
    let { x, y, width, height } = geometry
    if (MOBILE) {
      // The page is rendered in the emulated phone viewport, under the
      // browser's own toolbar: the video shows the phone screen, not the
      // browser window around it.
      width = Math.min(width, MOBILE_VIEWPORT.width)
      const pageTop = y + CHROME_UI_PX
      height = Math.min(MOBILE_VIEWPORT.height, size.height - pageTop)
      y = pageTop
    }
    const cropWidth = Math.max(2, Math.floor(width / 2) * 2)
    const cropHeight = Math.max(2, Math.floor(height / 2) * 2)
    const cropX = Math.max(0, Math.floor(x / 2) * 2)
    const cropY = Math.max(0, Math.floor(y / 2) * 2)
    crop = { width: cropWidth, height: cropHeight, x: cropX, y: cropY }
  }

  const cropArgs = crop
    ? ['-vf', `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']
    : ['-c', 'copy']
  // The crop re-encodes the whole recording: it needs minutes, not the
  // seconds a quick command gets.
  await shell('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', RAW, ...cropArgs, FINAL], 30 * 60 * 1000)

  let info = null
  try {
    info = await ffprobe(FINAL)
    const sizeOnDisk = (await stat(FINAL)).size
    const duration = Number(info?.format?.duration || 0)
    const streams = (info?.streams || []).map(stream => stream.codec_type === 'video'
      ? `video ${stream.codec_name} ${stream.width}x${stream.height}`
      : `audio ${stream.codec_name}`)
    console.log(`[GRABANDO] listo: ${FINAL}`)
    console.log(`[GRABANDO] duracion ${Math.round(duration)}s · ${(sizeOnDisk / 1024 / 1024).toFixed(1)} MB · ${streams.join(' + ')}`)
    console.log(`[GRABANDO] el recorrido duro ${Math.round(duration / 60)} minutos · la demo terminó con codigo ${code}`)
  } catch (e) {
    console.log(`[GRABANDO] el archivo se escribió pero no se pudo verificar: ${e.message}`)
  }
  if (process.env.E2E_KEEP_RAW === '1') {
    console.log(`[GRABANDO] el crudo se conserva en ${RAW}`)
  } else {
    await rm(RAW, { force: true })
  }
  process.exit(code === null ? 1 : code)
}

main().catch(error => {
  console.error(`[GRABANDO] falló: ${error.message}`)
  process.exit(1)
})
