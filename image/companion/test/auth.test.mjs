import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Auth, SESSION_HEADER } from '../lib/auth.mjs'
import { isTrustedMutation } from '../lib/http-util.mjs'
import { redact } from '../lib/log.mjs'

const request = (headers) => ({ headers })

test('a correct password yields a session the API accepts', () => {
  const auth = new Auth('app-password')
  const session = auth.login('app-password')
  assert.equal(typeof session, 'string')
  assert.ok(session.length > 20)
  assert.ok(!session.includes('app-password'))
  assert.ok(auth.isAuthorized(request({ [SESSION_HEADER]: session })))
})

test('wrong passwords and sessions are refused', () => {
  const auth = new Auth('app-password')
  assert.equal(auth.login('nope'), null)
  assert.equal(auth.login(''), null)
  assert.equal(auth.login(undefined), null)
  assert.ok(!auth.isAuthorized(request({})))
  assert.ok(!auth.isAuthorized(request({ [SESSION_HEADER]: 'forged' })))
  assert.ok(!auth.isAuthorized(request({ [SESSION_HEADER]: new Auth('other').login('other') })))
})

test('without a password the API is open', () => {
  const auth = new Auth(null)
  assert.equal(auth.enabled, false)
  assert.ok(auth.isAuthorized(request({})))
})

test('mutations need the page header and a same-origin Origin', () => {
  const host = 'umbrel.local:6769'
  assert.ok(!isTrustedMutation(request({ host })))
  assert.ok(isTrustedMutation(request({ host, 'x-orca-umbrel': '1' })))
  assert.ok(isTrustedMutation(request({ host, 'x-orca-umbrel': '1', origin: 'http://umbrel.local:6769' })))
  assert.ok(!isTrustedMutation(request({ host, 'x-orca-umbrel': '1', origin: 'http://evil.example' })))
  assert.ok(!isTrustedMutation(request({ host, 'x-orca-umbrel': '1', origin: 'http://umbrel.local:80' })))
  assert.ok(!isTrustedMutation(request({ host, 'x-orca-umbrel': '1', origin: 'null' })))
})

test('a proxy that rewrites Host still passes via X-Forwarded-Host', () => {
  const headers = {
    host: 'yanffernandes-orca_server_1:8080',
    'x-forwarded-host': 'umbrel.local:6769',
    'x-orca-umbrel': '1',
    origin: 'https://umbrel.local:6769'
  }
  assert.ok(isTrustedMutation(request(headers)))
})

test('pairing links never reach the logs', () => {
  const line = 'pairing: orca://pair?code=eyJ2IjoyLCJlbmRwb2ludCI6IndzOi8v and more'
  assert.equal(redact(line), 'pairing: orca://pair?code=<redacted> and more')
  assert.equal(redact('"url":"orca://pair?code=abc_-123"'), '"url":"orca://pair?code=<redacted>"')
})
