import http from 'node:http'
import { AgentManager } from './lib/agents.mjs'
import { Auth } from './lib/auth.mjs'
import { loadConfig } from './lib/config.mjs'
import { isUnusedOffer, listDevices, removeDevices } from './lib/devices.mjs'
import { prepareHome } from './lib/home.mjs'
import {
  isTrustedMutation,
  readJsonBody,
  redirect,
  sendJson,
  sendStaticFile,
  sendText
} from './lib/http-util.mjs'
import { log, logError } from './lib/log.mjs'
import { OrcaServe } from './lib/orca-serve.mjs'
import { decodePairingLink, withEndpoint } from './lib/pairing.mjs'
import { proxyWebSocket } from './lib/ws-proxy.mjs'

const config = loadConfig()
// Orca terminals and agents inherit this process's environment; keep the password out.
delete process.env.ORCA_UMBREL_PASSWORD
const orca = new OrcaServe(config)
const agents = new AgentManager()
const auth = new Auth(config.password)
let homeError = null

const UI_HEADERS = {
  'Cache-Control': 'no-cache',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
}

// Pairing changes restart Orca; never let two of them interleave.
let adminQueue = Promise.resolve()
function runExclusive(task) {
  const run = adminQueue.then(task, task)
  adminQueue = run.catch(() => {})
  return run
}

async function currentOffer() {
  const link = orca.pairingLink
  const payload = link ? decodePairingLink(link) : null
  if (!payload) {
    return null
  }
  const deviceId = payload.pairedDeviceId ?? orca.status.ready?.pairing?.deviceId ?? null
  const devices = await listDevices(config.userDataDir).catch(() => [])
  const device = devices.find((entry) => entry.deviceId === deviceId)
  return { link, deviceId, used: Boolean(device && device.lastSeenAt > 0) }
}

async function buildStatus() {
  const { state, startedAt, restarts, lastExit, ready } = orca.status
  let devices = []
  let devicesError = null
  try {
    devices = await listDevices(config.userDataDir)
  } catch (error) {
    devicesError = error.message
  }
  const offer = await currentOffer()
  return {
    server: {
      state,
      startedAt,
      restarts,
      lastExit,
      orcaVersion: config.orcaVersion,
      runtimeVersion: ready?.health?.buildVersion ?? null,
      terminalDaemon: ready?.health?.terminalDaemon?.state ?? null,
      homeError,
      recentOutput: state === 'ready' ? [] : orca.recentOutput
    },
    connection: {
      port: config.orcaPublicPort,
      defaultHost: config.pairingHost
    },
    // A used offer is that client's credential now; it is not handed out again.
    pairing: offer
      ? { link: offer.used ? null : offer.link, deviceId: offer.deviceId, used: offer.used }
      : null,
    devices: devices.map((device) => ({ ...device, current: device.deviceId === offer?.deviceId })),
    devicesError,
    agents: await agents.list(),
    tools: await agents.tools()
  }
}

async function handlePost(pathname, body, response) {
  switch (pathname) {
    case '/api/pairing-link': {
      const offer = await currentOffer()
      if (!offer || offer.used) {
        return sendJson(response, 409, { error: 'No unused access link. Create a new one first.' })
      }
      const link = withEndpoint(offer.link, body.endpoint)
      if (!link) {
        return sendJson(response, 400, { error: 'That address is not a valid ws:// or wss:// endpoint.' })
      }
      return sendJson(response, 200, { link })
    }
    case '/api/pairing/replace': {
      // Drops every offer no client has used yet, so a leaked link stops working,
      // then restarts Orca, which mints a fresh offer.
      await runExclusive(() =>
        orca.restart({ whileStopped: () => removeDevices(config.userDataDir, isUnusedOffer) })
      )
      return sendJson(response, 200, await buildStatus())
    }
    case '/api/devices/revoke': {
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
      const devices = await listDevices(config.userDataDir)
      if (!devices.some((device) => device.deviceId === deviceId)) {
        return sendJson(response, 404, { error: 'Unknown client.' })
      }
      // Restarting also drops the revoked client's live connections.
      await runExclusive(() =>
        orca.restart({
          whileStopped: () => removeDevices(config.userDataDir, (entry) => entry.deviceId === deviceId)
        })
      )
      return sendJson(response, 200, await buildStatus())
    }
    case '/api/server/restart': {
      await runExclusive(() => orca.restart())
      return sendJson(response, 200, await buildStatus())
    }
    case '/api/agents/install': {
      const result = agents.install(String(body.id ?? ''))
      return sendJson(response, result.ok ? 202 : 400, result)
    }
    default:
      return sendText(response, 404, 'Not found')
  }
}

async function handleRequest(request, response) {
  const { pathname } = new URL(request.url ?? '/', 'http://companion.invalid')

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (pathname === '/' || pathname === '/index.html') {
      return sendStaticFile(request, response, config.publicDir, 'index.html', UI_HEADERS)
    }
    if (pathname.startsWith('/static/')) {
      const served = await sendStaticFile(
        request,
        response,
        config.publicDir,
        pathname.slice('/static/'.length),
        UI_HEADERS
      )
      return served || sendText(response, 404, 'Not found')
    }
    if (pathname === '/api/health') {
      const { state } = orca.status
      return sendJson(response, state === 'ready' ? 200 : 503, { state })
    }
    if (pathname.startsWith('/api/') && !auth.isAuthorized(request)) {
      return sendJson(response, 401, { error: 'Sign in with the app password.' })
    }
    if (pathname === '/api/status') {
      return sendJson(response, 200, await buildStatus())
    }
    const agentLog = pathname.match(/^\/api\/agents\/([a-z]+)\/log$/)
    if (agentLog) {
      return sendText(response, 200, agents.output(agentLog[1]))
    }
    if (pathname === '/web' || pathname === '/web/') {
      return redirect(response, '/web/web-index.html')
    }
    if (pathname.startsWith('/web/') && config.webClientDir) {
      const relative = pathname.slice('/web/'.length)
      const served = await sendStaticFile(request, response, config.webClientDir, relative, {
        'Cache-Control': relative.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'Referrer-Policy': 'no-referrer'
      })
      return served || sendText(response, 404, 'Not found')
    }
  }

  if (request.method === 'POST' && pathname.startsWith('/api/')) {
    if (!isTrustedMutation(request)) {
      return sendJson(response, 403, { error: 'Forbidden' })
    }
    const body = await readJsonBody(request)
    if (pathname === '/api/login') {
      const session = auth.login(body.password)
      return session === null
        ? sendJson(response, 401, { error: 'That password is not right.' })
        : sendJson(response, 200, { session })
    }
    if (!auth.isAuthorized(request)) {
      return sendJson(response, 401, { error: 'Sign in with the app password.' })
    }
    return handlePost(pathname, body, response)
  }

  return sendText(response, 404, 'Not found')
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    logError(`${request.method} ${request.url} failed`, error)
    if (!response.headersSent) {
      sendJson(response, error.status ?? 500, { error: error.message })
    } else {
      response.destroy()
    }
  })
})

// The browser client reaches Orca through this origin; see ws-proxy.mjs.
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://companion.invalid')
  if (pathname.startsWith('/web/')) {
    proxyWebSocket(request, socket, head, config.orcaPort)
    return
  }
  socket.destroy()
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  log(`${signal} received; stopping Orca`)
  server.close()
  await orca.stop()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await prepareHome(config.home)
} catch (error) {
  homeError = error.message
  logError('home directory is not usable', error)
}
if (!auth.enabled) {
  log('ORCA_UMBREL_PASSWORD is not set; the status API is open to anyone who can reach it')
}
orca.start()
server.listen(config.companionPort, () => {
  log(`status page listening on :${config.companionPort}; Orca clients connect on :${config.orcaPublicPort}`)
})
