// One active request run inside the coach panel.
//
// The panel can be closed while the platform is still answering. Every run owns
// an AbortController, and only the CURRENT run may write to the panel. Closing
// the panel aborts the active request and makes its run stale, so a late answer
// cannot append itself to the transcript — not even after the panel is reopened.
export function createCoachRunGuard() {
  let active = null

  return {
    begin() {
      if (active) active.controller.abort()
      const run = { controller: new AbortController() }
      active = run
      return run
    },

    isCurrent(run) {
      return !!run && active === run
    },

    complete(run) {
      if (active === run) active = null
    },

    abort(run = active) {
      if (!run) return
      run.controller.abort()
      if (active === run) active = null
    },
  }
}
