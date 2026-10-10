import fs from 'node:fs/promises'
import path from 'node:path'

// Orca's per-client grants: one entry per pairing offer, keyed by a revocable token.
// An entry with lastSeenAt === 0 is an offer no client has used yet.
const DEVICE_REGISTRY_FILE = 'orca-devices.json'

function registryPath(userDataDir) {
  return path.join(userDataDir, DEVICE_REGISTRY_FILE)
}

async function readRegistry(userDataDir) {
  let text
  try {
    text = await fs.readFile(registryPath(userDataDir), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const entries = JSON.parse(text)
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry?.deviceId !== 'string')) {
    throw new Error(`Unrecognized format in ${DEVICE_REGISTRY_FILE}`)
  }
  return entries
}

/** Entries without their tokens. */
export async function listDevices(userDataDir) {
  const entries = await readRegistry(userDataDir)
  return entries.map((entry) => ({
    deviceId: entry.deviceId,
    name: typeof entry.name === 'string' ? entry.name : '',
    scope: typeof entry.scope === 'string' ? entry.scope : 'runtime',
    pairedAt: Number(entry.pairedAt) || 0,
    lastSeenAt: Number(entry.lastSeenAt) || 0
  }))
}

/**
 * Drops matching entries. Orca keeps the registry in memory and rewrites it, so call
 * this only while `orca serve` is stopped.
 */
export async function removeDevices(userDataDir, shouldRemove) {
  const entries = await readRegistry(userDataDir)
  const kept = entries.filter((entry) => !shouldRemove(entry))
  const removed = entries.length - kept.length
  if (removed > 0) {
    const file = registryPath(userDataDir)
    const temp = `${file}.${process.pid}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temp, file)
  }
  return removed
}

export function isUnusedOffer(entry) {
  return (Number(entry.lastSeenAt) || 0) === 0
}
