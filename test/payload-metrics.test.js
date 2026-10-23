import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../src/server.js'
import { loadConfig } from '../src/config.js'
import { DEFAULT_PAYLOAD_METRICS_PATH, writePayloadMetricsFile } from '../src/metrics.js'

const servers = []
const tempDirs = []

after(() => {
  for (const s of servers) s.close()
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'claude-proxy-metrics-'))
  tempDirs.push(dir)
  return dir
}

function listen(server) {
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
}

async function startUpstream(responseBody = { ok: true }) {
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(responseBody))
    })
  })
  return listen(server)
}

function send(routerUrl, path, { body, headers = {}, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : body
    const lengthHeader = body === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }
    const req = http.request(
      `${routerUrl}${path}`,
      {
        method,
        agent: false,
        headers: { ...lengthHeader, ...headers },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })
        )
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

async function setupRouter(extraState = {}) {
  const upstreamUrl = await startUpstream()
  const state = Object.freeze({
    activeBackend: 'claude',
    backends: Object.freeze({
      claude: Object.freeze({
        name: 'Claude API',
        baseUrl: upstreamUrl,
        apiKey: null,
        forwardClientAuth: true,
        available: true,
        models: [],
      }),
      gpt: Object.freeze({
        name: 'GPT (CLIProxyAPI)',
        baseUrl: upstreamUrl,
        apiKey: 'gpt-key',
        available: true,
        models: [{ id: 'gpt-6-astra', label: 'GPT-6 Astra' }],
      }),
    }),
    ...extraState,
  })
  const routerUrl = await listen(createServer(state))
  return { routerUrl }
}

test('GET /admin/status starts with null payload metrics before any request', async () => {
  const { routerUrl } = await setupRouter()

  const res = await send(routerUrl, '/admin/status', { method: 'GET' })
  const status = JSON.parse(res.body)

  assert.equal(res.status, 200)
  assert.equal(status.data.lastRequestPayloadBytes, null)
  assert.equal(status.data.lastRequest, null)
  assert.deepEqual(status.data.payloadByModel, {})
})

test('tracks rawBody byte length, forwarded byte length, model, backend, path, and timestamp', async () => {
  const { routerUrl } = await setupRouter()
  const rawPayload = JSON.stringify({
    model: 'gpt-6-astra',
    max_tokens: 32,
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal thoughts', signature: 'sig' },
          { type: 'text', text: 'hello' },
        ],
      },
    ],
  })
  const expectedRawBytes = Buffer.byteLength(rawPayload)

  const proxyRes = await send(routerUrl, '/v1/messages?beta=true', {
    body: rawPayload,
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(proxyRes.status, 200)

  const statusRes = await send(routerUrl, '/admin/status', { method: 'GET' })
  const { data } = JSON.parse(statusRes.body)

  assert.equal(data.lastRequestPayloadBytes, expectedRawBytes)
  assert.equal(data.lastRequest.payloadBytes, expectedRawBytes)
  assert.ok(data.lastRequest.forwardedPayloadBytes < expectedRawBytes)
  assert.equal(data.lastRequest.model, 'gpt-6-astra')
  assert.equal(data.lastRequest.backend, 'gpt')
  assert.equal(data.lastRequest.path, '/v1/messages?beta=true')
  assert.equal(typeof data.lastRequest.timestamp, 'string')
  assert.ok(!Number.isNaN(Date.parse(data.lastRequest.timestamp)))
  assert.deepEqual(data.payloadByModel['gpt-6-astra'], data.lastRequest)
})

test('empty-body GET or HEAD requests do not overwrite lastRequestPayloadBytes', async () => {
  const { routerUrl } = await setupRouter()
  const body = JSON.stringify({
    model: 'claude-opus-4-6',
    messages: [{ role: 'user', content: 'ping' }],
  })
  const expectedBytes = Buffer.byteLength(body)

  await send(routerUrl, '/v1/messages', {
    body,
    headers: { 'content-type': 'application/json' },
  })
  await send(routerUrl, '/api/hello', { method: 'HEAD' })
  await send(routerUrl, '/v1/models', { method: 'GET' })

  const statusRes = await send(routerUrl, '/admin/status', { method: 'GET' })
  const { data } = JSON.parse(statusRes.body)

  assert.equal(data.lastRequestPayloadBytes, expectedBytes)
  assert.equal(data.lastRequest.model, 'claude-opus-4-6')
})

test('preserves payload metrics across /admin/switch calls', async () => {
  const { routerUrl } = await setupRouter()
  const body = JSON.stringify({
    model: 'claude-opus-4-6',
    messages: [{ role: 'user', content: 'keep metrics' }],
  })
  const expectedBytes = Buffer.byteLength(body)

  await send(routerUrl, '/v1/messages', {
    body,
    headers: { 'content-type': 'application/json' },
  })
  const switchRes = await send(routerUrl, '/admin/switch', {
    body: JSON.stringify({ backend: 'gpt' }),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(switchRes.status, 200)

  const statusRes = await send(routerUrl, '/admin/status', { method: 'GET' })
  const { data } = JSON.parse(statusRes.body)

  assert.equal(data.activeBackend, 'gpt')
  assert.equal(data.lastRequestPayloadBytes, expectedBytes)
  assert.equal(data.lastRequest.payloadBytes, expectedBytes)
})

test('atomically writes payload metrics JSON file without leaving temp files', async () => {
  const dir = makeTempDir()
  const metricsFile = join(dir, 'last-payload.json')
  const { routerUrl } = await setupRouter({ payloadMetricsPath: metricsFile })
  const body = JSON.stringify({
    model: 'gpt-6-astra',
    messages: [{ role: 'user', content: 'write metric file' }],
  })
  const expectedBytes = Buffer.byteLength(body)

  await send(routerUrl, '/v1/messages', {
    body,
    headers: { 'content-type': 'application/json' },
  })

  const written = JSON.parse(readFileSync(metricsFile, 'utf-8'))
  assert.equal(written.lastRequestPayloadBytes, expectedBytes)
  assert.equal(written.payloadBytes, expectedBytes)
  assert.equal(written.model, 'gpt-6-astra')
  assert.equal(written.backend, 'gpt')
  assert.equal(written.path, '/v1/messages')
  assert.equal(written.byModel['gpt-6-astra'].payloadBytes, expectedBytes)
  assert.deepEqual(readdirSync(dir), ['last-payload.json'])
})

test('records payload metrics even when matched backend is unavailable (503)', async () => {
  const { routerUrl } = await setupRouter({
    backends: Object.freeze({
      claude: Object.freeze({
        name: 'Claude API',
        baseUrl: 'http://127.0.0.1:1',
        available: true,
        models: [],
      }),
      gpt: Object.freeze({
        name: 'GPT (CLIProxyAPI)',
        baseUrl: null,
        available: false,
        unavailableReason: 'CLIPROXY_KEY is not set',
        models: [{ id: 'gpt-6-astra', label: 'GPT-6 Astra' }],
      }),
    }),
  })
  const body = JSON.stringify({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'hi' }] })
  const expectedBytes = Buffer.byteLength(body)

  const res = await send(routerUrl, '/v1/messages', {
    body,
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(res.status, 503)

  const statusRes = await send(routerUrl, '/admin/status', { method: 'GET' })
  const { data } = JSON.parse(statusRes.body)

  assert.equal(data.lastRequestPayloadBytes, expectedBytes)
  assert.equal(data.lastRequest.model, 'gpt-6-astra')
  assert.equal(data.lastRequest.backend, null)
})

test('writePayloadMetricsFile returns false when disabled or path is invalid', () => {
  assert.equal(writePayloadMetricsFile(null, { lastRequest: { payloadBytes: 10 } }), false)
  assert.equal(writePayloadMetricsFile('', { lastRequest: { payloadBytes: 10 } }), false)
  assert.equal(writePayloadMetricsFile('/tmp/x.json', null), false)
})

test('loadConfig sets default payloadMetricsPath outside test runner and respects CLAUDE_PROXY_PAYLOAD_FILE', () => {
  const prevFile = process.env.CLAUDE_PROXY_PAYLOAD_FILE
  const prevTestCtx = process.env.NODE_TEST_CONTEXT
  try {
    delete process.env.CLAUDE_PROXY_PAYLOAD_FILE
    const inTestRunnerCfg = loadConfig()
    assert.equal(inTestRunnerCfg.payloadMetricsPath, null)

    delete process.env.NODE_TEST_CONTEXT
    const defaultCfg = loadConfig()
    assert.equal(defaultCfg.payloadMetricsPath, DEFAULT_PAYLOAD_METRICS_PATH)

    process.env.CLAUDE_PROXY_PAYLOAD_FILE = '/tmp/custom-payload-metrics.json'
    const customCfg = loadConfig()
    assert.equal(customCfg.payloadMetricsPath, '/tmp/custom-payload-metrics.json')
  } finally {
    if (prevFile === undefined) {
      delete process.env.CLAUDE_PROXY_PAYLOAD_FILE
    } else {
      process.env.CLAUDE_PROXY_PAYLOAD_FILE = prevFile
    }
    if (prevTestCtx === undefined) {
      delete process.env.NODE_TEST_CONTEXT
    } else {
      process.env.NODE_TEST_CONTEXT = prevTestCtx
    }
  }
})
