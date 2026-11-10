import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

// Where the app is published.
//
// The app is a PURE FRONT: a static bundle served by a static host. On GitHub
// Pages that host puts it UNDER A PATH PREFIX
// (https://<user>.github.io/<repo>/), so the bundle can never assume it
// lives at the root of the domain.
//
// The bundle therefore keeps RELATIVE asset URLs (base: './') and the shell
// carries a <base> element that says where the app root is. BASE_PATH is
// that root, as a path prefix:
//
//   BASE_PATH=''                     → '/'                              (subdomain root)
//   BASE_PATH='/metalgym88.djlabs.cl/' → '/metalgym88.djlabs.cl/'       (Pages)
//
// The <base> matters on the deep path of the magic-link landing
// (<root>/auth/verify): without it the relative assets would be asked for
// under <root>/auth/ and the app would boot blank.
const rawBase = String(process.env.BASE_PATH || '').trim()
const appBase = rawBase ? '/' + rawBase.replace(/^\/+|\/+$/g, '') + '/' : '/'

/**
 * The shell of the static host.
 *
 * GitHub Pages has no SPA fallback: every path that is not a file answers
 * 404. The site ships a copy of the built index.html as 404.html, and Pages
 * serves that copy for every unknown path — the app boots from the copy and
 * reads the URL it was asked for (the magic-link landing).
 *
 * The same hook injects the <base> element, so the relative URLs of the
 * bundle resolve against the app root and not against the current
 * directory.
 */
function staticHostShell() {
  return {
    name: 'metalgym88-static-host-shell',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      if (/<base\s/i.test(html)) return html
      return html.replace(/<head>/i, `<head>\n    <base href="${appBase}">`)
    },
    generateBundle(_options, bundle) {
      const shell = bundle['index.html']
      if (!shell || shell.type !== 'asset') return
      // The copy is byte for byte the shell the host serves at the root.
      this.emitFile({ type: 'asset', fileName: '404.html', source: shell.source })
    },
  }
}

export default defineConfig({
  plugins: [react(), staticHostShell()],
  // Relative base: the assets resolve against the document, so the SAME
  // bundle works at the root of a subdomain and inside a subdirectory.
  // The <base> element (see above) is what keeps them on the app root.
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
