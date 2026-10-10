import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { isUnusedOffer, listDevices, removeDevices } from '../lib/devices.mjs'

async function registryDir(entries) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-devices-'))
  if (entries !== undefined) {
    await fs.writeFile(path.join(dir, 'orca-devices.json'), JSON.stringify(entries), { mode: 0o600 })
  }
  return dir
}

const used = {
  deviceId: 'used-1',
  name: 'CLI 10/10/2026',
  token: 'secret-used',
  scope: 'runtime',
  pairedAt: 1000,
  lastSeenAt: 2000,
  pairingReach: 'network'
}
const unused = { ...used, deviceId: 'unused-1', token: 'secret-unused', lastSeenAt: 0 }

test('a missing registry means no clients', async () => {
  assert.deepEqual(await listDevices(await registryDir()), [])
})

test('lists clients without their tokens', async () => {
  const devices = await listDevices(await registryDir([used, unused]))
  assert.deepEqual(devices, [
    { deviceId: 'used-1', name: 'CLI 10/10/2026', scope: 'runtime', pairedAt: 1000, lastSeenAt: 2000 },
    { deviceId: 'unused-1', name: 'CLI 10/10/2026', scope: 'runtime', pairedAt: 1000, lastSeenAt: 0 }
  ])
  assert.ok(!JSON.stringify(devices).includes('secret'))
})

test('removes unused offers and keeps paired clients', async () => {
  const dir = await registryDir([used, unused])
  assert.equal(await removeDevices(dir, isUnusedOffer), 1)
  const file = path.join(dir, 'orca-devices.json')
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), [used])
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await fs.readdir(dir), ['orca-devices.json'])
})

test('leaves the file alone when nothing matches', async () => {
  const dir = await registryDir([used])
  const file = path.join(dir, 'orca-devices.json')
  const before = await fs.readFile(file, 'utf8')
  assert.equal(await removeDevices(dir, isUnusedOffer), 0)
  assert.equal(await fs.readFile(file, 'utf8'), before)
})

test('refuses a registry in a format it does not know', async () => {
  const dir = await registryDir({ devices: [used] })
  await assert.rejects(listDevices(dir), /Unrecognized format/)
  await assert.rejects(removeDevices(dir, () => true), /Unrecognized format/)
})
