const SESSION_KEY = 'orca-umbrel-session'
const HOST_KEY = 'orca-umbrel-host'
const CUSTOM = '__custom__'

const $ = (id) => document.getElementById(id)

const ui = {
  status: null,
  selectedHost: localStorage.getItem(HOST_KEY) || null,
  linkRevealed: false,
  // The link shown for the selected address, and the offer it was built from.
  shownLink: { offerDeviceId: null, endpoint: null },
  webLink: { offerDeviceId: null, href: null },
  pollTimer: null,
  openLogs: new Set()
}

class Unauthorized extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {
    'X-Orca-Umbrel': '1',
    'X-Orca-Umbrel-Session': localStorage.getItem(SESSION_KEY) || ''
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  })
  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json() : await response.text()
  if (response.status === 401) {
    throw new Unauthorized(data?.error || 'Sign in required')
  }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`)
  }
  return data
}

function toast(message, kind = 'info') {
  const element = $('toast')
  element.textContent = message
  element.dataset.kind = kind
  element.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => {
    element.hidden = true
  }, 3500)
}

function relativeTime(timestamp) {
  if (!timestamp) {
    return 'never'
  }
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  return new Date(timestamp).toLocaleDateString()
}

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value)
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child)
  }
  return node
}

async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Umbrel apps usually load over plain http://, where the Clipboard API is missing.
  const scratch = element('textarea', { class: 'offscreen', readonly: '' })
  scratch.value = text
  document.body.append(scratch)
  scratch.select()
  const ok = document.execCommand('copy')
  scratch.remove()
  if (!ok) {
    throw new Error('Copy failed')
  }
}

// ---------- address choice and access link ----------

function urlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function hostChoices(status) {
  const choices = []
  const add = (value, note) => {
    if (value && !choices.some((choice) => choice.value === value)) {
      choices.push({ value, note })
    }
  }
  add(location.hostname, 'this page')
  add(status.connection.defaultHost, 'Umbrel name')
  return choices
}

function selectedHost() {
  if (ui.selectedHost === CUSTOM) {
    return $('custom-host').value.trim()
  }
  return ui.selectedHost
}

function endpointFor(host) {
  return `ws://${urlHost(host)}:${ui.status.connection.port}`
}

function renderHostChoices() {
  const status = ui.status
  const choices = hostChoices(status)
  const known = choices.some((choice) => choice.value === ui.selectedHost)
  if (!known && ui.selectedHost !== CUSTOM) {
    ui.selectedHost = choices[0].value
  }
  const container = $('host-choices')
  container.replaceChildren(
    ...choices.map((choice) =>
      element(
        'button',
        {
          type: 'button',
          class: 'choice',
          role: 'radio',
          'aria-checked': String(ui.selectedHost === choice.value),
          onclick: () => chooseHost(choice.value)
        },
        [element('span', { class: 'mono', text: choice.value }), element('small', { text: choice.note })]
      )
    ),
    element(
      'button',
      {
        type: 'button',
        class: 'choice',
        role: 'radio',
        'aria-checked': String(ui.selectedHost === CUSTOM),
        onclick: () => chooseHost(CUSTOM)
      },
      [element('span', { text: 'Other address' }), element('small', { text: 'IP or Tailscale' })]
    )
  )
  $('custom-host').hidden = ui.selectedHost !== CUSTOM
  $('orca-port').textContent = String(status.connection.port)
}

function chooseHost(value) {
  ui.selectedHost = value
  localStorage.setItem(HOST_KEY, value)
  renderHostChoices()
  if (value === CUSTOM) {
    $('custom-host').focus()
  }
  void refreshAccessLink()
}

async function refreshAccessLink() {
  const pairing = ui.status?.pairing
  const host = selectedHost()
  const field = $('access-link')
  if (!pairing?.link || !host) {
    field.value = ''
    ui.shownLink = { offerDeviceId: null, endpoint: null }
    $('copy-link').disabled = true
    return
  }
  const endpoint = endpointFor(host)
  if (ui.shownLink.offerDeviceId === pairing.deviceId && ui.shownLink.endpoint === endpoint) {
    return
  }
  try {
    const { link } = await api('/api/pairing-link', { method: 'POST', body: { endpoint } })
    field.value = link
    ui.shownLink = { offerDeviceId: pairing.deviceId, endpoint }
    $('copy-link').disabled = false
  } catch (error) {
    field.value = ''
    ui.shownLink = { offerDeviceId: null, endpoint: null }
    $('copy-link').disabled = true
    if (ui.selectedHost !== CUSTOM) {
      toast(error.message, 'error')
    }
  }
}

async function refreshWebLink() {
  const pairing = ui.status?.pairing
  const open = $('open-web')
  const base = '/web/web-index.html'
  $('web-hint').hidden = !pairing?.used
  if (!pairing?.link) {
    open.href = base
    ui.webLink = { offerDeviceId: null, href: null }
    return
  }
  if (ui.webLink.offerDeviceId === pairing.deviceId) {
    open.href = ui.webLink.href
    return
  }
  // Same origin as this page, through the companion's WebSocket proxy.
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  try {
    const { link } = await api('/api/pairing-link', {
      method: 'POST',
      body: { endpoint: `${scheme}://${location.host}/web/rpc` }
    })
    ui.webLink = { offerDeviceId: pairing.deviceId, href: `${base}#pairing=${encodeURIComponent(link)}` }
    open.href = ui.webLink.href
  } catch {
    open.href = base
  }
}

// ---------- rendering ----------

const STATE_LABELS = {
  loading: 'Loading…',
  starting: 'Starting…',
  ready: 'Running',
  restarting: 'Restarting…',
  stopped: 'Stopped'
}

function renderServer(status) {
  const { server } = status
  const pill = $('server-pill')
  pill.dataset.state = server.state
  pill.textContent = STATE_LABELS[server.state] ?? server.state

  const slowStart = server.state === 'starting' && Date.now() - (server.startedAt ?? Date.now()) > 90_000
  const problem = server.homeError || server.state === 'restarting' || server.state === 'stopped' || slowStart
  $('server-problem').hidden = !problem
  if (problem) {
    $('server-problem-title').textContent = server.homeError
      ? 'The home directory is not usable'
      : slowStart
        ? 'The Orca server is taking long to start'
        : 'The Orca server is not running'
    $('server-problem-text').textContent =
      server.homeError ??
      (server.lastExit
        ? `It exited (code ${server.lastExit.code ?? 'none'}, signal ${server.lastExit.signal ?? 'none'}) and restarted ${server.restarts} time(s).`
        : 'The first start downloads Orca’s runtime, which can take a minute.')
    $('server-output').textContent = server.recentOutput.join('\n') || 'No output yet.'
  }

  const parts = []
  if (server.orcaVersion) parts.push(`Orca ${server.orcaVersion}`)
  if (server.runtimeVersion) parts.push(`orcad ${server.runtimeVersion}`)
  if (server.terminalDaemon) parts.push(`terminals ${server.terminalDaemon}`)
  $('versions').textContent = parts.join(' · ')
}

function renderPairing(status) {
  const pairing = status.pairing
  $('link-ready').hidden = !pairing?.link
  $('link-used').hidden = !pairing?.used
  $('link-missing').hidden = Boolean(pairing)
  $('new-link').textContent = pairing?.used ? 'Create new link' : 'Replace link'
  $('new-link').classList.toggle('primary', Boolean(pairing?.used))
  $('new-link').disabled = status.server.state !== 'ready'
}

function renderAgents(status) {
  const list = $('agent-list')
  list.replaceChildren(
    ...status.agents.map((agent) => {
      const running = agent.job?.state === 'running'
      const failed = agent.job?.state === 'failed'
      const versionText = running
        ? 'Installing…'
        : agent.installed
          ? agent.version || 'Installed'
          : 'Not installed'
      const logOpen = ui.openLogs.has(agent.id)
      const logBlock = agent.job
        ? element('details', { class: 'log', open: logOpen ? '' : null }, [
            element('summary', {
              text: failed ? 'Install failed — show log' : 'Install log',
              onclick: (event) => {
                const details = event.currentTarget.parentElement
                setTimeout(() => {
                  if (details.open) ui.openLogs.add(agent.id)
                  else ui.openLogs.delete(agent.id)
                  if (details.open) void loadLog(agent.id, details.querySelector('pre'))
                })
              }
            }),
            element('pre', { 'data-log': agent.id })
          ])
        : null
      const item = element('li', { class: 'agent' }, [
        element('div', { class: 'agent-head' }, [
          element('div', {}, [
            element('strong', { text: agent.name }),
            element('span', { class: agent.installed ? 'version' : 'version muted', text: versionText })
          ]),
          element('button', {
            type: 'button',
            disabled: running ? '' : null,
            class: agent.installed ? '' : 'primary',
            text: running ? 'Installing…' : agent.installed ? 'Update' : 'Install',
            onclick: () => installAgent(agent.id)
          })
        ]),
        agent.installed
          ? element('p', { class: 'hint' }, [
              'Sign in: run ',
              element('code', { text: agent.signInCommand }),
              ' in an Orca terminal on this server.'
            ])
          : null,
        logBlock
      ])
      if (logOpen) {
        void loadLog(agent.id, item.querySelector('pre'))
      }
      return item
    })
  )
  const tools = Object.entries(status.tools)
    .filter(([, version]) => version)
    .map(([name, version]) => `${name} ${version.replace(/^(git version|gh version|Python) /i, '').replace(/^v/, '')}`)
  $('tools').textContent = tools.length ? `Also on this server — ${tools.join(' · ')}` : ''
}

async function loadLog(id, pre) {
  try {
    pre.textContent = (await api(`/api/agents/${id}/log`)) || 'No output yet.'
    pre.scrollTop = pre.scrollHeight
  } catch (error) {
    pre.textContent = error.message
  }
}

function renderClients(status) {
  const devices = [...status.devices].sort((a, b) => (b.lastSeenAt || b.pairedAt) - (a.lastSeenAt || a.pairedAt))
  $('no-clients').hidden = devices.length > 0 || Boolean(status.devicesError)
  if (status.devicesError) {
    $('no-clients').hidden = false
    $('no-clients').textContent = `Could not read paired clients: ${status.devicesError}`
  }
  $('client-list').replaceChildren(
    ...devices.map((device) => {
      const waiting = device.lastSeenAt === 0
      // `orca serve` names every offer "CLI <date>", which says nothing about the client.
      const named = device.name && !/^CLI \d/.test(device.name)
      const label = waiting ? 'Access link — not used yet' : named ? device.name : 'Orca client'
      const detail = waiting
        ? `Created ${relativeTime(device.pairedAt)}`
        : `Paired ${relativeTime(device.pairedAt)} · last seen ${relativeTime(device.lastSeenAt)}`
      const revoke = element('button', { type: 'button', class: 'danger-quiet', text: waiting ? 'Discard' : 'Revoke' })
      revoke.addEventListener('click', () => {
        if (revoke.dataset.armed !== 'true') {
          revoke.dataset.armed = 'true'
          revoke.textContent = 'Confirm'
          revoke.classList.add('danger')
          setTimeout(() => {
            revoke.dataset.armed = 'false'
            revoke.textContent = waiting ? 'Discard' : 'Revoke'
            revoke.classList.remove('danger')
          }, 4000)
          return
        }
        void revokeDevice(device.deviceId)
      })
      return element('li', { class: 'client' }, [
        element('div', {}, [element('strong', { text: label }), element('span', { class: 'muted', text: detail })]),
        revoke
      ])
    })
  )
}

function render(status) {
  ui.status = status
  $('login-card').hidden = true
  $('dashboard').hidden = false
  renderServer(status)
  renderHostChoices()
  renderPairing(status)
  renderAgents(status)
  renderClients(status)
  void refreshAccessLink()
  void refreshWebLink()
}

// ---------- actions ----------

async function withBusy(button, label, task) {
  const original = button.textContent
  button.disabled = true
  button.textContent = label
  try {
    return await task()
  } finally {
    button.disabled = false
    button.textContent = original
    // Labels and enabled state follow the server state, not the pre-click one.
    if (ui.status) render(ui.status)
  }
}

async function installAgent(id) {
  try {
    await api('/api/agents/install', { method: 'POST', body: { id } })
    ui.openLogs.add(id)
    await refresh()
  } catch (error) {
    handleError(error)
  }
}

async function revokeDevice(deviceId) {
  try {
    $('server-pill').dataset.state = 'restarting'
    $('server-pill').textContent = STATE_LABELS.restarting
    render(await api('/api/devices/revoke', { method: 'POST', body: { deviceId } }))
    toast('Access revoked')
  } catch (error) {
    handleError(error)
  }
}

function handleError(error) {
  if (error instanceof Unauthorized) {
    showLogin()
    return
  }
  toast(error.message, 'error')
}

function showLogin(message) {
  localStorage.removeItem(SESSION_KEY)
  $('dashboard').hidden = true
  $('login-card').hidden = false
  $('server-pill').dataset.state = 'loading'
  $('server-pill').textContent = 'Signed out'
  $('login-error').hidden = !message
  $('login-error').textContent = message ?? ''
  $('login-password').focus()
}

async function refresh() {
  try {
    render(await api('/api/status'))
  } catch (error) {
    if (error instanceof Unauthorized) {
      showLogin()
    } else {
      $('server-pill').dataset.state = 'stopped'
      $('server-pill').textContent = 'Unreachable'
    }
  }
  schedulePoll()
}

function schedulePoll() {
  clearTimeout(ui.pollTimer)
  const status = ui.status
  const busy =
    status &&
    (status.server.state !== 'ready' || status.agents.some((agent) => agent.job?.state === 'running'))
  ui.pollTimer = setTimeout(refresh, busy ? 2000 : 8000)
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const { session } = await api('/api/login', {
      method: 'POST',
      body: { password: $('login-password').value }
    })
    localStorage.setItem(SESSION_KEY, session)
    $('login-password').value = ''
    await refresh()
  } catch (error) {
    showLogin(error.message)
  }
})

$('toggle-link').addEventListener('click', () => {
  ui.linkRevealed = !ui.linkRevealed
  $('access-link').type = ui.linkRevealed ? 'text' : 'password'
  $('toggle-link').textContent = ui.linkRevealed ? 'Hide' : 'Show'
})

$('copy-link').addEventListener('click', async () => {
  const link = $('access-link').value
  if (!link) return
  try {
    await copyText(link)
    toast('Access link copied')
  } catch {
    ui.linkRevealed = true
    $('access-link').type = 'text'
    $('access-link').select()
    toast('Select the link and copy it manually', 'error')
  }
})

$('new-link').addEventListener('click', () =>
  withBusy($('new-link'), 'Restarting server…', async () => {
    try {
      render(await api('/api/pairing/replace', { method: 'POST' }))
      toast('New access link ready')
    } catch (error) {
      handleError(error)
    }
  })
)

$('restart-server').addEventListener('click', () =>
  withBusy($('restart-server'), 'Restarting…', async () => {
    try {
      render(await api('/api/server/restart', { method: 'POST' }))
    } catch (error) {
      handleError(error)
    }
  })
)

let customHostTimer = null
$('custom-host').addEventListener('input', () => {
  clearTimeout(customHostTimer)
  customHostTimer = setTimeout(() => void refreshAccessLink(), 400)
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void refresh()
  }
})

void refresh()
