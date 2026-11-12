// Device facts the UI branches on.
//
// The legacy self-hosted API client that used to live here is gone: the platform
// API lives in src/lib/platform/ and the static host answers 405 to /api/*.
export const IS_ANDROID = /Android/.test(navigator.userAgent)
