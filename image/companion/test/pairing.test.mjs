import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePairingLink, encodePairingLink, normalizeEndpoint, withEndpoint } from '../lib/pairing.mjs'

// Shaped like the offer `orca-ide serve --json` prints (values are fake).
const offer = {
  v: 2,
  endpoint: 'ws://umbrel.local:6768',
  deviceToken: 'f'.repeat(48),
  publicKeyB64: 'K/nM+KajEEKPMp1eE2M9eso1+13HCdJakRIRiAKCbxY=',
  pairedDeviceId: 'b6305978-d3a7-489b-b439-1e62ae0af4b2',
  scope: 'runtime'
}
const link = `orca://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`

test('decodes an Orca pairing link', () => {
  assert.deepEqual(decodePairingLink(link), offer)
})

test('rejects links that are not Orca offers', () => {
  assert.equal(decodePairingLink('https://example.com'), null)
  assert.equal(decodePairingLink('orca://pair?code=not-json'), null)
  const missingToken = Buffer.from(JSON.stringify({ v: 2, endpoint: 'ws://x' })).toString('base64url')
  assert.equal(decodePairingLink(`orca://pair?code=${missingToken}`), null)
})

test('encodes without base64 padding, like Orca', () => {
  const encoded = encodePairingLink(offer)
  assert.equal(encoded, link)
  assert.ok(!encoded.slice('orca://pair?code='.length).includes('='))
})

test('swaps only the endpoint', () => {
  const swapped = decodePairingLink(withEndpoint(link, 'ws://100.64.1.20:6768'))
  assert.deepEqual(swapped, { ...offer, endpoint: 'ws://100.64.1.20:6768' })
  // Key order is kept, so the payload reads exactly like one Orca minted.
  assert.deepEqual(Object.keys(swapped), Object.keys(offer))
})

test('keeps a path for proxied endpoints', () => {
  const swapped = decodePairingLink(withEndpoint(link, 'wss://umbrel.local:6769/web/rpc'))
  assert.equal(swapped.endpoint, 'wss://umbrel.local:6769/web/rpc')
})

test('normalizes endpoints the way Orca formats them', () => {
  assert.equal(normalizeEndpoint('ws://umbrel.local:6768/'), 'ws://umbrel.local:6768')
  assert.equal(normalizeEndpoint(' ws://[fd7a:115c::1]:6768 '), 'ws://[fd7a:115c::1]:6768')
})

test('refuses endpoints a client could not or should not dial', () => {
  for (const bad of [
    'http://umbrel.local:6768',
    'umbrel.local:6768',
    'ws://0.0.0.0:6768',
    'ws://[::]:6768',
    'ws://user:pass@umbrel.local:6768',
    'ws://umbrel.local:6768/?token=x',
    'ws://umbrel.local:6768/#x',
    `ws://${'a'.repeat(600)}.local`,
    42,
    null
  ]) {
    assert.equal(normalizeEndpoint(bad), null, String(bad))
    assert.equal(withEndpoint(link, bad), null, String(bad))
  }
})
