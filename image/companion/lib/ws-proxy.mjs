import net from 'node:net'

// Headers that belong to the browser↔Umbrel hop. Orca authenticates with the pairing
// token inside the WebSocket session, so Umbrel's login cookie must not reach it.
const DROPPED_HEADERS = new Set(['host', 'cookie', 'authorization'])

/**
 * Splices a WebSocket upgrade through to Orca's RPC listener. Orca accepts upgrades on
 * any path and does not check Origin, so a byte-level relay is all it takes, and it
 * keeps the browser client on this page's origin (and on HTTPS when umbrelOS serves
 * the app over HTTPS, where a direct ws:// connection would be blocked).
 */
export function proxyWebSocket(request, socket, head, upstreamPort) {
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort })
  const destroyBoth = () => {
    socket.destroy()
    upstream.destroy()
  }
  socket.on('error', destroyBoth)
  upstream.on('error', destroyBoth)
  socket.on('close', () => upstream.destroy())
  upstream.on('close', () => socket.destroy())

  upstream.once('connect', () => {
    socket.setNoDelay(true)
    upstream.setNoDelay(true)
    const lines = [`GET / HTTP/1.1`, `Host: 127.0.0.1:${upstreamPort}`]
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index]
      if (!DROPPED_HEADERS.has(name.toLowerCase())) {
        lines.push(`${name}: ${request.rawHeaders[index + 1]}`)
      }
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) {
      upstream.write(head)
    }
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
}
