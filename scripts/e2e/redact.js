// Report redaction.
//
// The suite exercises a real account: magic links carry single-use tokens, the
// platform hands out JWTs and the browser holds session cookies. None of that
// may reach the report (which is meant to be read by humans and committed as
// evidence), so every string that goes into the report passes through here.
//
// The raw artifacts (screenshots, network dumps) stay in artifacts/e2e/ and
// that directory is git-ignored.

const RULES = [
  // Query-string secrets: ?token=… / &code=…
  [/([?&](?:token|code|key|hash|state|access_token|refresh_token|password|otp)=)[^&\s"'<>]+/gi, '$1REDACTED'],
  // JSON / object fields: "access_token":"…"
  [/\b(access_token|refresh_token|auth_token|token|password|passwd|secret|api_key|apikey)\b(\s*[:=]\s*)("?)([^"\s,&}]+)/gi,
    (_m, key, sep, quote) => `${key}${sep}${quote}REDACTED`],
  // Authorization headers.
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer REDACTED'],
  // Raw JWTs wherever they show up.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, 'REDACTED_JWT'],
  // Cookies.
  [/(set-cookie\s*[:=]\s*)[^\n\r]+/gi, '$1REDACTED'],
  [/\b(cookie|cookies)\b(\s*[:=]\s*)("[^"]*"|[^\n,}]{1,400})/gi, (_m, key, sep) => `${key}${sep}"REDACTED"`],
]

/** Redacts secrets in a single string. */
export function redact(input) {
  if (input == null) return input
  let text = String(input)
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement)
  return text
}

/** Redacts every string inside a JSON-like structure (in place is avoided). */
export function redactValue(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item)
    return out
  }
  return value
}

/** Redacts a URL for the report: keeps origin/path, masks the secrets. */
export function redactUrl(url) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|code|key|hash|state|password|otp/i.test(key)) parsed.searchParams.set(key, 'REDACTED')
    }
    parsed.hash = parsed.hash ? '#REDACTED' : ''
    return parsed.toString()
  } catch {
    return redact(url)
  }
}
