// Pairing links carry the device token that grants full control of the server, so
// they never reach container logs (umbrelOS shows those in its UI).
const PAIRING_LINK = /orca:\/\/pair\?code=[^\s"'<>]+/g

export function redact(text) {
  return String(text).replace(PAIRING_LINK, 'orca://pair?code=<redacted>')
}

export function log(message) {
  process.stdout.write(`[orca-umbrel] ${redact(message)}\n`)
}

export function logError(message, error) {
  const detail = error instanceof Error ? error.message : error ? String(error) : ''
  process.stderr.write(`[orca-umbrel] ${redact(detail ? `${message}: ${detail}` : message)}\n`)
}
