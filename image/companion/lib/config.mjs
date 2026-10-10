import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const companionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parsePort(raw, fallback) {
  if (raw === undefined || raw === '') {
    return fallback
  }
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`)
  }
  return port
}

export function loadConfig(env = process.env) {
  const home = env.HOME || os.homedir()
  const orcaPort = parsePort(env.ORCA_PORT, 6768)
  return {
    home,
    orcaPort,
    // The host port Orca clients dial. Equal to orcaPort unless Docker remaps it.
    orcaPublicPort: parsePort(env.ORCA_PUBLIC_PORT, orcaPort),
    companionPort: parsePort(env.COMPANION_PORT, 8080),
    // umbrelOS exports DEVICE_DOMAIN_NAME (usually umbrel.local) to app compose files.
    pairingHost: (env.ORCA_PAIRING_HOST || env.DEVICE_DOMAIN_NAME || 'umbrel.local').trim(),
    // Where `orca-ide` keeps its runtime state on Linux (Electron's userData).
    userDataDir:
      env.ORCA_UMBREL_USER_DATA_DIR ||
      path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'orca'),
    orcaCommand: env.ORCA_UMBREL_ORCA_COMMAND || 'orca-ide',
    orcaVersion: env.ORCA_UMBREL_ORCA_VERSION || null,
    // Required to use the status API; empty disables the check (local development).
    password: env.ORCA_UMBREL_PASSWORD || null,
    webClientDir: env.ORCA_UMBREL_WEB_CLIENT_DIR || null,
    publicDir: path.join(companionRoot, 'public')
  }
}
