import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { log } from './log.mjs'

const execFileAsync = promisify(execFile)
const LOG_LIMIT_BYTES = 256 * 1024

// Official install commands. Each one installs under $HOME, which is persistent, so
// the CLIs survive app updates and can update themselves.
export const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    signIn: 'claude',
    docs: 'https://docs.claude.com/en/docs/claude-code/overview'
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    install: 'npm install -g @openai/codex@latest',
    signIn: 'codex login --device-auth',
    docs: 'https://github.com/openai/codex'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    signIn: 'opencode auth login',
    docs: 'https://opencode.ai/docs'
  }
]

const TOOLS = [
  { id: 'git', command: 'git', args: ['--version'] },
  { id: 'gh', command: 'gh', args: ['--version'] },
  { id: 'node', command: 'node', args: ['--version'] },
  { id: 'python', command: 'python3', args: ['--version'] }
]

async function findOnPath(command) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) {
      continue
    }
    const candidate = path.join(dir, command)
    try {
      await fs.access(candidate, fs.constants.X_OK)
      const stat = await fs.stat(candidate)
      if (stat.isFile()) {
        return { path: candidate, mtimeMs: stat.mtimeMs }
      }
    } catch {
      // Not here.
    }
  }
  return null
}

async function readVersion(file, args) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: 15_000,
      env: { ...process.env, NO_COLOR: '1' }
    })
    return (stdout || stderr).trim().split('\n')[0] || null
  } catch {
    return null
  }
}

export class AgentManager {
  #versions = new Map()
  #jobs = new Map()

  async list() {
    return Promise.all(
      AGENTS.map(async (agent) => {
        const found = await findOnPath(agent.command)
        const job = this.#jobs.get(agent.id)
        return {
          id: agent.id,
          name: agent.name,
          installCommand: agent.install,
          signInCommand: agent.signIn,
          docs: agent.docs,
          installed: Boolean(found),
          version: found ? await this.#cachedVersion(found, ['--version']) : null,
          job: job
            ? {
                state: job.state,
                startedAt: job.startedAt,
                finishedAt: job.finishedAt,
                exitCode: job.exitCode
              }
            : null
        }
      })
    )
  }

  async tools() {
    const entries = await Promise.all(
      TOOLS.map(async (tool) => {
        const found = await findOnPath(tool.command)
        return [tool.id, found ? await this.#cachedVersion(found, tool.args) : null]
      })
    )
    return Object.fromEntries(entries)
  }

  /** Starts an install unless one is already running; returns immediately. */
  install(id) {
    const agent = AGENTS.find((candidate) => candidate.id === id)
    if (!agent) {
      return { ok: false, error: 'unknown_agent' }
    }
    if (this.#jobs.get(id)?.state === 'running') {
      return { ok: true, alreadyRunning: true }
    }
    const job = { state: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, output: '' }
    this.#jobs.set(id, job)
    const append = (chunk) => {
      job.output += chunk.toString('utf8')
      if (job.output.length > LOG_LIMIT_BYTES) {
        job.output = job.output.slice(-LOG_LIMIT_BYTES)
      }
    }
    append(`$ ${agent.install}\n`)
    log(`installing ${agent.name}`)
    const child = spawn('bash', ['-c', agent.install], {
      cwd: process.env.HOME,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      append(`\n${error.message}\n`)
    })
    child.on('close', (code) => {
      job.state = code === 0 ? 'succeeded' : 'failed'
      job.exitCode = code
      job.finishedAt = Date.now()
      append(`\n[exit ${code}]\n`)
      log(`${agent.name} install ${job.state} (exit ${code})`)
    })
    return { ok: true }
  }

  output(id) {
    return this.#jobs.get(id)?.output ?? ''
  }

  async #cachedVersion(found, args) {
    const cached = this.#versions.get(found.path)
    if (cached && cached.mtimeMs === found.mtimeMs) {
      return cached.version
    }
    const version = await readVersion(found.path, args)
    this.#versions.set(found.path, { mtimeMs: found.mtimeMs, version })
    return version
  }
}
