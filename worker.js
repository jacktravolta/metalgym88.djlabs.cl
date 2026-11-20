// Cloudflare Worker entry for the static bundle.
//
// The app is built as a plain static site under dist/, but the Pages-style
// middleware in functions/_middleware.js is what stamps every HTML response
// with a fresh CSP nonce. A Worker in front of the assets binding is the one
// entry point that runs that middleware for _every_ response, including the
// SPA fallback document, without duplicating its policy here.
//
// Keep this file dependency-free: it only wires the asset server into the
// existing onRequest contract.
import { onRequest } from './functions/_middleware.js'

export default {
  async fetch(request, env) {
    return onRequest({
      request,
      next: nextRequest => env.ASSETS.fetch(nextRequest || request),
    })
  },
}
