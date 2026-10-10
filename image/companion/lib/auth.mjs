import crypto from 'node:crypto'

const SESSION_CONTEXT = 'orca-umbrel-session-v1'
export const SESSION_HEADER = 'x-orca-umbrel-session'

function sessionTokenFor(password) {
  return crypto.createHmac('sha256', password).update(SESSION_CONTEXT).digest('base64url')
}

function safeEqual(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * Guards the status API, which hands out access links. Umbrel's login protects the
 * route from browsers, but other containers on the shared Docker network can reach
 * this port directly, so the API also wants the app's own password (umbrelOS
 * generates it per install and shows it to the owner).
 *
 * The session token travels in a header the page reads from localStorage, never in a
 * cookie: cookies ignore ports, so every other app on the Umbrel's hostname would
 * receive it.
 */
export class Auth {
  #sessionToken

  constructor(password) {
    this.#sessionToken = password ? sessionTokenFor(password) : null
  }

  get enabled() {
    return this.#sessionToken !== null
  }

  /** Returns the session token for a correct password, else null. */
  login(password) {
    if (!this.enabled) {
      return ''
    }
    if (typeof password !== 'string' || password.length === 0 || password.length > 1024) {
      return null
    }
    const candidate = sessionTokenFor(password)
    return safeEqual(candidate, this.#sessionToken) ? this.#sessionToken : null
  }

  isAuthorized(request) {
    if (!this.enabled) {
      return true
    }
    const presented = request.headers[SESSION_HEADER]
    return typeof presented === 'string' && safeEqual(presented, this.#sessionToken)
  }
}
