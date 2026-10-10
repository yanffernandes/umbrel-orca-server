import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { log, logError, redact } from './log.mjs'

const STOP_TIMEOUT_MS = 20_000
const MAX_BACKOFF_MS = 30_000
// A run that stayed up this long resets the restart backoff.
const HEALTHY_RUN_MS = 60_000
const RECENT_OUTPUT_LINES = 60

/**
 * Runs `orca-ide serve` in the foreground and keeps it running. Orca prints one JSON
 * line of type `orca_server_ready` (endpoints, pairing offer, health) once it listens;
 * everything else is log output.
 */
export class OrcaServe {
  #config
  #child = null
  #exited = null
  #wantRunning = false
  #restartTimer = null
  #backoffMs = 1000
  #state = 'stopped'
  #ready = null
  #startedAt = null
  #lastExit = null
  #restarts = 0
  #recentOutput = []
  #readyWaiters = new Set()

  constructor(config) {
    this.#config = config
  }

  get status() {
    return {
      state: this.#state,
      startedAt: this.#startedAt,
      restarts: this.#restarts,
      lastExit: this.#lastExit,
      ready: this.#ready
    }
  }

  /** Redacted tail of Orca's own output, for diagnosing a server that won't start. */
  get recentOutput() {
    return [...this.#recentOutput]
  }

  get pairingLink() {
    return this.#ready?.pairing?.available ? this.#ready.pairing.url : null
  }

  start() {
    this.#wantRunning = true
    if (!this.#child && !this.#restartTimer) {
      this.#spawn()
    }
  }

  async stop() {
    this.#wantRunning = false
    clearTimeout(this.#restartTimer)
    this.#restartTimer = null
    await this.#terminate()
    this.#state = 'stopped'
  }

  /** Stops Orca, runs `whileStopped` (e.g. a registry edit), then starts it and waits for readiness. */
  async restart({ whileStopped, timeoutMs = 120_000 } = {}) {
    await this.stop()
    try {
      await whileStopped?.()
    } finally {
      this.#backoffMs = 1000
      this.start()
    }
    return this.waitUntilReady(timeoutMs)
  }

  waitUntilReady(timeoutMs) {
    if (this.#state === 'ready') {
      return Promise.resolve(this.#ready)
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        this.#readyWaiters.delete(waiter)
        reject(new Error('Timed out waiting for the Orca server to start'))
      }, timeoutMs)
      this.#readyWaiters.add(waiter)
    })
  }

  #spawn() {
    const { orcaCommand, orcaPort, orcaPublicPort, pairingHost, home } = this.#config
    const args = [
      'serve',
      '--port',
      String(orcaPort),
      '--pairing-address',
      `${pairingHost}:${orcaPublicPort}`,
      '--json'
    ]
    log(`starting ${orcaCommand} ${args.join(' ')}`)
    this.#ready = null
    this.#startedAt = Date.now()
    this.#state = 'starting'

    const child = spawn(orcaCommand, args, {
      cwd: home,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so a stuck stop can take down the CLI and orcad together
      // while Orca's terminal daemon (its own session) keeps agents running.
      detached: true
    })
    this.#child = child
    this.#exited = new Promise((resolve) => {
      child.once('exit', resolve)
      child.once('error', () => {
        if (child.pid === undefined) {
          resolve()
        }
      })
    })

    for (const stream of [child.stdout, child.stderr]) {
      readline.createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
        this.#handleLine(line)
      })
    }
    child.on('error', (error) => {
      logError(`could not start ${orcaCommand}`, error)
      this.#remember(`could not start ${orcaCommand}: ${error.message}`)
      // A failed spawn never emits 'exit'; treat it as one so the retry loop runs.
      if (child.pid === undefined) {
        this.#handleExit(child, null, null)
      }
    })
    child.on('exit', (code, signal) => this.#handleExit(child, code, signal))
  }

  #handleLine(line) {
    const jsonStart = line.indexOf('{')
    if (jsonStart !== -1) {
      let message = null
      try {
        message = JSON.parse(line.slice(jsonStart))
      } catch {
        // Plain log text that happens to contain a brace.
      }
      if (message?.type === 'orca_server_ready') {
        this.#handleReady(message)
        return
      }
    }
    const text = redact(line)
    this.#remember(text)
    process.stdout.write(`${text}\n`)
  }

  #handleReady(message) {
    this.#ready = {
      runtimeId: message.runtimeId ?? null,
      boundEndpoint: message.boundEndpoint ?? message.endpoint ?? null,
      advertisedEndpoint: message.advertisedEndpoint ?? null,
      pairing: message.pairing ?? null,
      health: message.health ?? null
    }
    const health = message.health ?? {}
    log(
      `Orca server ready on ${this.#ready.boundEndpoint} (runtime ${health.buildVersion ?? 'unknown'}, ` +
        `terminal daemon ${health.terminalDaemon?.state ?? 'unknown'}, ` +
        `pairing ${message.pairing?.available ? 'available' : 'unavailable'})`
    )
    this.#state = 'ready'
    for (const waiter of this.#readyWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(this.#ready)
    }
    this.#readyWaiters.clear()
  }

  #handleExit(child, code, signal) {
    if (this.#child !== child) {
      return
    }
    this.#child = null
    this.#ready = null
    this.#lastExit = { code, signal, at: Date.now() }
    if (!this.#wantRunning) {
      return
    }
    const ranFor = Date.now() - (this.#startedAt ?? Date.now())
    if (ranFor > HEALTHY_RUN_MS) {
      this.#backoffMs = 1000
    }
    const delay = this.#backoffMs
    this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS)
    this.#restarts += 1
    logError(`orca serve exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}); restarting in ${delay / 1000}s`)
    this.#state = 'restarting'
    for (const waiter of this.#readyWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`The Orca server exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`))
    }
    this.#readyWaiters.clear()
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      if (this.#wantRunning) {
        this.#spawn()
      }
    }, delay)
  }

  async #terminate() {
    const child = this.#child
    if (!child) {
      return
    }
    const exited = this.#exited
    // The CLI forwards SIGTERM to orcad and exits once it has shut down.
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, STOP_TIMEOUT_MS)
    await exited
    clearTimeout(killTimer)
  }

  #remember(line) {
    this.#recentOutput.push(line)
    if (this.#recentOutput.length > RECENT_OUTPUT_LINES) {
      this.#recentOutput.shift()
    }
  }
}
