import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.bcmap', 'application/octet-stream'],
  ['.pfb', 'application/octet-stream'],
  ['.txt', 'text/plain; charset=utf-8']
])

const MAX_BODY_BYTES = 16 * 1024

export function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  response.end(text)
}

export function sendText(response, status, text) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  response.end(text)
}

export function redirect(response, location) {
  response.writeHead(302, { Location: location, 'Cache-Control': 'no-store' })
  response.end()
}

/**
 * Serves `relativePath` from `root`, refusing anything that escapes it. Returns false
 * when there is no such file so the caller can 404.
 */
export async function sendStaticFile(request, response, root, relativePath, headers = {}) {
  const resolvedRoot = path.resolve(root)
  const file = path.resolve(resolvedRoot, `.${path.posix.normalize(`/${relativePath}`)}`)
  if (file !== resolvedRoot && !file.startsWith(`${resolvedRoot}${path.sep}`)) {
    return false
  }
  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    return false
  }
  if (!stat.isFile()) {
    return false
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream',
    'Content-Length': stat.size,
    ...headers
  })
  if (request.method === 'HEAD') {
    response.end()
    return true
  }
  const stream = fs.createReadStream(file)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
  return true
}

export async function readJsonBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body too large'), { status: 413 })
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) {
    return {}
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 })
  }
}

/**
 * The page sits behind Umbrel's login cookie, so a state-changing request must prove
 * it came from this page: a custom header (forms can't send one cross-site without a
 * CORS preflight, which we never grant) and, when the browser sends it, a same-origin
 * Origin.
 */
export function isTrustedMutation(request) {
  if (request.headers['x-orca-umbrel'] !== '1') {
    return false
  }
  const origin = request.headers.origin
  if (!origin) {
    return true
  }
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  // Umbrel's proxies keep Host but also send the browser's host as X-Forwarded-Host.
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  return originHost === request.headers.host || (forwardedHost !== '' && originHost === forwardedHost)
}
