import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { PassThrough } from 'node:stream'
import { createServer } from '../src/server.js'
import { readBody } from '../src/utils.js'

// The router must only answer local, non-browser clients: requests with an
// Origin header, a foreign Host header (DNS rebinding), or a non-JSON body
// on a write method are rejected before any upstream is contacted.

const servers = []

function listen(server) {
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function startUpstream() {
  const received = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  const port = await listen(server)
  return { url: `http://127.0.0.1:${port}`, received }
}

async function setupRouter(extra = {}) {
  const upstream = await startUpstream()
  const state = Object.freeze({
    activeBackend: 'claude',
    backends: Object.freeze({
      claude: { name: 'Claude API', baseUrl: upstream.url, apiKey: null, forwardClientAuth: true, available: true, models: [] },
      gpt: {
        name: 'GPT',
        baseUrl: upstream.url,
        apiKey: 'gpt-backend-key',
        available: true,
        models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }],
      },
    }),
    ...extra,
  })
  const port = await listen(createServer(state))
  return { port, upstream }
}

function send(port, path, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body)
    const req = http.request(
      { host: '127.0.0.1', port, path, method, agent: false, headers },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      }
    )
    req.on('error', reject)
    req.end(payload ?? undefined)
  })
}

const JSON_HEADERS = { 'content-type': 'application/json' }
const GPT_BODY = JSON.stringify({ model: 'gpt-5.5', messages: [] })

test('a Claude Code style request passes', async () => {
  const { port, upstream } = await setupRouter()

  const res = await send(port, '/v1/messages?beta=true', { body: GPT_BODY, headers: JSON_HEADERS })

  assert.equal(res.status, 200)
  assert.equal(upstream.received.length, 1)
})

test('JSON content type with a charset parameter passes', async () => {
  const { port } = await setupRouter()

  const res = await send(port, '/v1/messages', {
    body: GPT_BODY,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

  assert.equal(res.status, 200)
})

for (const path of ['/v1/messages', '/admin/status', '/admin/model-picker']) {
  test(`a request with an Origin header to ${path} is rejected with 403`, async () => {
    const { port, upstream } = await setupRouter()

    const res = await send(port, path, {
      method: path.startsWith('/admin/') ? 'GET' : 'POST',
      body: path.startsWith('/admin/') ? undefined : GPT_BODY,
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
    })

    assert.equal(res.status, 403)
    assert.equal(upstream.received.length, 0)
  })
}

test('a foreign Host header is rejected with 403', async () => {
  const { port, upstream } = await setupRouter()

  const res = await send(port, '/v1/messages', {
    body: GPT_BODY,
    headers: { ...JSON_HEADERS, host: `evil.example:${port}` },
  })

  assert.equal(res.status, 403)
  assert.equal(upstream.received.length, 0)
  assert.doesNotMatch(res.body, /gpt-backend-key/)
})

test('a loopback Host on another port is rejected', async () => {
  const { port } = await setupRouter()

  const res = await send(port, '/admin/status', { method: 'GET', headers: { host: `127.0.0.1:${port + 1}` } })

  assert.equal(res.status, 403)
})

for (const hostname of ['127.0.0.1', 'localhost', 'LOCALHOST', '[::1]']) {
  test(`Host ${hostname}:<port> is accepted`, async () => {
    const { port } = await setupRouter()

    const res = await send(port, '/admin/status', { method: 'GET', headers: { host: `${hostname}:${port}` } })

    assert.equal(res.status, 200)
  })
}

test('hosts listed in allowedHosts are accepted', async () => {
  const { port } = await setupRouter({ allowedHosts: ['router.internal:3456'] })

  const ok = await send(port, '/admin/status', { method: 'GET', headers: { host: 'router.internal:3456' } })
  const bad = await send(port, '/admin/status', { method: 'GET', headers: { host: 'router.internal:9999' } })

  assert.equal(ok.status, 200)
  assert.equal(bad.status, 403)
})

for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null]) {
  test(`a POST with content type ${contentType} is rejected with 415`, async () => {
    const { port, upstream } = await setupRouter()

    const res = await send(port, '/v1/messages', {
      body: GPT_BODY,
      headers: contentType ? { 'content-type': contentType } : {},
    })

    assert.equal(res.status, 415)
    assert.equal(upstream.received.length, 0)
  })
}

test('a body over the size limit is rejected with 413', async () => {
  const { port, upstream } = await setupRouter()
  const body = `{"model":"gpt-5.5","pad":"${'x'.repeat(33 * 1024 * 1024)}"}`

  const res = await send(port, '/v1/messages', { body, headers: JSON_HEADERS })

  assert.equal(res.status, 413)
  assert.equal(upstream.received.length, 0)
})

test('readBody drains an oversized body and then rejects with 413', async () => {
  const stream = new PassThrough()
  const pending = readBody(stream, 8)
  stream.write('12345')
  stream.write('67890')
  stream.end('abc')

  await assert.rejects(pending, (err) => err.statusCode === 413)
  assert.equal(stream.readableEnded, true)
})

test('readBody returns the body under the limit', async () => {
  const stream = new PassThrough()
  const pending = readBody(stream, 8)
  stream.end('1234')

  assert.equal((await pending).toString(), '1234')
})

after(() => {
  for (const server of servers) {
    server.closeAllConnections?.()
    server.close()
  }
})
