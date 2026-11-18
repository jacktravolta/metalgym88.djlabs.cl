// Semantic helpers for inputs rendered inside cross-origin frames.
//
// The provider is not part of the contract: a frame is classified by the
// attributes of the input it actually contains (autocomplete, accessible
// label, placeholder or name). No provider class name or host is used.

const FIELD_DEFINITIONS = {
  number: {
    autocomplete: 'cc-number',
    patterns: [
      /card\s*(?:number|no\.?|numero)/i,
      /account\s*number/i,
      /debit\s*card/i,
      /credit\s*card/i,
    ],
    selectors: [
      'input[autocomplete="cc-number"]',
      'input[aria-label*="card number" i]',
      'input[placeholder*="card number" i]',
      'input[name*="cardnumber" i]',
    ],
  },
  expiry: {
    autocomplete: 'cc-exp',
    patterns: [
      /expir(?:y|ation)/i,
      /exp\s*date/i,
      /valid\s*(?:thru|through)/i,
      /mm\s*\/\s*yy/i,
    ],
    selectors: [
      'input[autocomplete="cc-exp"]',
      'input[aria-label*="expiration" i]',
      'input[aria-label*="expiry" i]',
      'input[placeholder*="expiration" i]',
      'input[placeholder*="expiry" i]',
      'input[name*="expiry" i]',
      'input[name*="expdate" i]',
    ],
  },
  cvv: {
    autocomplete: 'cc-csc',
    patterns: [
      /\bcvv2?\b/i,
      /security\s*code/i,
      /card\s*verification/i,
    ],
    selectors: [
      'input[autocomplete="cc-csc"]',
      'input[aria-label*="cvv" i]',
      'input[placeholder*="cvv" i]',
      'input[name*="cvv" i]',
      'input[aria-label*="security code" i]',
      'input[placeholder*="security code" i]',
    ],
  },
  name: {
    autocomplete: 'cc-name',
    patterns: [
      /name\s*on\s*card/i,
      /cardholder(?:\s*name)?/i,
      /name\s*(?:on|of)\s*(?:the\s*)?card/i,
      /^(?:name|cardholder\s*name)$/i,
    ],
    selectors: [
      'input[autocomplete="cc-name"]',
      'input[aria-label*="name on card" i]',
      'input[placeholder*="name on card" i]',
      'input[name*="cardholder" i]',
      'input[aria-label*="cardholder" i]',
      'input[placeholder*="cardholder" i]',
    ],
  },
}

/** The semantic field names understood by the frame helpers. */
export const FRAME_FIELDS = Object.keys(FIELD_DEFINITIONS)

/**
 * Reads the flattened child session id from a Target.attachedToTarget event.
 *
 * Chrome puts it in the event params; the connection-level session id is only
 * a fallback for clients that expose it there.
 */
export function attachedChildSessionId(params = {}, eventSessionId = null) {
  return params.sessionId || eventSessionId || null
}

/** The CSS selectors that can locate a semantic field inside a frame. */
export function frameFieldSelectors(field) {
  const definition = FIELD_DEFINITIONS[field]
  return definition ? definition.selectors : []
}

function attributesToObject(attributes) {
  const out = {}
  if (Array.isArray(attributes)) {
    // DOM.getAttributes returns a flat [name, value, name, value] array.
    for (let index = 0; index + 1 < attributes.length; index += 2) {
      out[String(attributes[index]).toLowerCase()] = String(attributes[index + 1] || '')
    }
    return out
  }
  for (const attribute of attributes || []) {
    if (attribute && attribute.name) out[String(attribute.name).toLowerCase()] = String(attribute.value || '')
  }
  return out
}

/**
 * Classifies one frame input from its own attributes.
 *
 * The accessible label and placeholder are preferred because they are what a
 * person sees. The HTML name and autocomplete value are only fallbacks.
 */
export function classifyFrameField(attributes) {
  const attrs = attributes && !Array.isArray(attributes)
    ? Object.fromEntries(Object.entries(attributes).map(([key, value]) => [String(key).toLowerCase(), String(value || '')]))
    : attributesToObject(attributes)
  const autocomplete = String(attrs.autocomplete || '').toLowerCase()
  for (const field of FRAME_FIELDS) {
    if (autocomplete === FIELD_DEFINITIONS[field].autocomplete) return field
  }

  const label = String(attrs['aria-label'] || attrs.placeholder || attrs.name || '').trim()
  if (!label) return null
  for (const field of FRAME_FIELDS) {
    if (FIELD_DEFINITIONS[field].patterns.some(pattern => pattern.test(label))) return field
  }
  return null
}

/** Removes known sensitive values from text before it is retained or reported. */
export function redactSensitiveValues(text, values = []) {
  let output = String(text == null ? '' : text)
  for (const value of values) {
    const secret = String(value || '')
    if (secret) output = output.split(secret).join('[REDACTED]')
  }
  return output
}
