// An Orca pairing link is `orca://pair?code=<base64url JSON>`. The JSON holds the
// endpoint the client dials plus the device token and the server's public key. The
// server never sees which endpoint a client used, so the same offer can be handed
// out with whichever address reaches this Umbrel (LAN name, IP, Tailscale, or the
// companion's own WebSocket proxy).

const PAIRING_PREFIX = 'orca://pair?code='

function base64UrlEncode(text) {
  return Buffer.from(text, 'utf8').toString('base64url')
}

export function decodePairingLink(link) {
  if (typeof link !== 'string' || !link.startsWith(PAIRING_PREFIX)) {
    return null
  }
  try {
    const code = decodeURIComponent(link.slice(PAIRING_PREFIX.length))
    const payload = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'))
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.endpoint !== 'string' ||
      typeof payload.deviceToken !== 'string' ||
      typeof payload.publicKeyB64 !== 'string'
    ) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export function encodePairingLink(payload) {
  return PAIRING_PREFIX + base64UrlEncode(JSON.stringify(payload))
}

/** Same offer, different address. Returns null when either input is unusable. */
export function withEndpoint(link, endpoint) {
  const payload = decodePairingLink(link)
  const normalized = normalizeEndpoint(endpoint)
  if (!payload || !normalized) {
    return null
  }
  return encodePairingLink({ ...payload, endpoint: normalized })
}

/** Accepts ws(s):// URLs only; strips a bare trailing slash the way Orca formats them. */
export function normalizeEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 512) {
    return null
  }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.hostname) {
    return null
  }
  if (url.username || url.password || url.search || url.hash) {
    return null
  }
  if (isWildcardHost(url.hostname)) {
    return null
  }
  const formatted = url.toString()
  return url.pathname === '/' ? formatted.replace(/\/$/, '') : formatted
}

function isWildcardHost(hostname) {
  return hostname === '0.0.0.0' || hostname === '[::]' || hostname === '::'
}
