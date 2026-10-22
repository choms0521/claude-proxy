import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { loadConfig, switchBackend } from '../src/config.js'
import { selectBackend } from '../src/routing.js'
import { buildModelPicker } from '../src/admin.js'
import { createServer } from '../src/server.js'

const EXAMPLE_PATH = fileURLToPath(new URL('../config.example.json', import.meta.url))
const PRO_MODEL = 'gemini-pro-agent'
const FLASH_MODEL = 'gemini-3-flash'
const PROXY_KEY = 'test-local-proxy-key'
const CLIENT_HEADERS = {
  'content-type': 'application/json',
  authorization: 'Bearer test-claude-oauth',
  cookie: 'session=test-client',
  'x-api-key': 'test-client-key',
  'proxy-authorization': 'Basic test-client-proxy',
}

function loadExample({ key = PROXY_KEY, baseUrl = 'http://127.0.0.1:8317' } = {}) {
  const overrides = { CLIPROXY_KEY: key, CLIPROXY_BASE_URL: baseUrl }
  const previous = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]))
  try {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === null) delete process.env[name]
      else process.env[name] = value
    }
    return loadConfig(EXAMPLE_PATH)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

async function listen(t, server) {
  t.after(() => {
    server.closeAllConnections?.()
    server.close()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${server.address().port}`
}

async function upstream(t, { payload = '{"ok":true}', contentType = 'application/json' } = {}) {
  const received = []
  const url = await listen(t, http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) })
      res.writeHead(200, { 'content-type': contentType })
      res.write(payload)
      res.end()
    })
  }))
  return { url, received }
}

async function setup(t, { key = PROXY_KEY, response } = {}) {
  const claude = await upstream(t)
  const cliproxy = await upstream(t, response)
  const config = loadExample({ key, baseUrl: cliproxy.url })
  const state = {
    ...config,
    backends: {
      ...config.backends,
      claude: { ...config.backends.claude, baseUrl: claude.url },
    },
  }
  const url = await listen(t, createServer(state))
  return { url, claude, cliproxy }
}

function request(url, path, body, headers = CLIENT_HEADERS) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(`${url}${path}`, {
      method: 'POST',
      agent: false,
      headers: { ...headers, 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

const message = (model, extra = {}) => ({
  model,
  max_tokens: 16,
  messages: [{ role: 'user', content: 'hi' }],
  ...extra,
})

test('the example routes Gemini models without changing the default Claude or GPT routes', () => {
  const state = loadExample()

  assert.equal(selectBackend(state, PRO_MODEL).backend.id, 'gemini')
  assert.equal(selectBackend(state, FLASH_MODEL).backend.id, 'gemini')
  assert.equal(selectBackend(state, 'gpt-6-astra').backend.id, 'gpt')
  assert.equal(selectBackend(state, 'claude-sonnet-5-5').backend.id, 'claude')
  assert.equal(state.activeBackend, 'claude')
})

test('the example exposes both Gemini subscription models in the session picker', () => {
  const { modelPicker } = buildModelPicker(loadExample())

  const gemini = modelPicker.options.filter((option) => option.model.startsWith('gemini'))
  assert.deepEqual(gemini.map((option) => option.model), [PRO_MODEL, FLASH_MODEL])
  assert.deepEqual(gemini.map((option) => option.label), ['Gemini 3.1 Pro (High)', 'Gemini 3 Flash'])
  assert.ok(gemini.every((option) => option.description.includes('press s')))
  assert.ok(modelPicker.options.some((option) => option.model === 'gpt-6-astra'))
})

test('a missing proxy key hides Gemini and rejects switching without disabling Claude', () => {
  const state = loadExample({ key: null })

  assert.equal(selectBackend(state, PRO_MODEL).status, 503)
  assert.equal(switchBackend(state, 'gemini').success, false)
  assert.equal(selectBackend(state, 'claude-sonnet-5-5').backend.id, 'claude')
  assert.ok(!buildModelPicker(state).modelPicker.options.some((option) => option.model === PRO_MODEL))
})

test('Gemini messages and token counting preserve model IDs and isolate client credentials', async (t) => {
  const { url, claude, cliproxy } = await setup(t)

  for (const [path, model] of [
    ['/v1/messages', FLASH_MODEL],
    ['/v1/messages/count_tokens', PRO_MODEL],
  ]) {
    const result = await request(url, path, message(model))
    assert.equal(result.status, 200)
  }

  assert.equal(claude.received.length, 0)
  assert.deepEqual(cliproxy.received.map((entry) => entry.url), ['/v1/messages', '/v1/messages/count_tokens'])
  assert.deepEqual(cliproxy.received.map((entry) => entry.body.model), [FLASH_MODEL, PRO_MODEL])
  for (const { headers } of cliproxy.received) {
    assert.equal(headers['x-api-key'], PROXY_KEY)
    assert.equal(headers.authorization, undefined)
    assert.equal(headers.cookie, undefined)
    assert.equal(headers['proxy-authorization'], undefined)
    assert.doesNotMatch(JSON.stringify(headers), /test-claude-oauth|test-client/)
  }
})

test('switching to Gemini maps Claude requests but preserves explicit GPT model selection', async (t) => {
  const { url, cliproxy } = await setup(t)
  const switched = await request(url, '/admin/switch', { backend: 'gemini' })

  assert.equal(switched.status, 200)
  assert.equal(JSON.parse(switched.body).data.activeBackend, 'gemini')
  await request(url, '/v1/messages', message('claude-sonnet-5-5'))
  await request(url, '/v1/messages', message('gpt-6-astra'))

  assert.deepEqual(cliproxy.received.map((entry) => entry.body.model), [PRO_MODEL, 'gpt-6-astra'])
})

test('switching back to Claude restores its client-authenticated route', async (t) => {
  const { url, claude, cliproxy } = await setup(t)
  const toGemini = await request(url, '/admin/switch', { backend: 'gemini' })
  const toClaude = await request(url, '/admin/switch', { backend: 'claude' })
  assert.equal(toGemini.status, 200)
  assert.equal(toClaude.status, 200)

  const result = await request(url, '/v1/messages', message('claude-sonnet-5-5'))

  assert.equal(result.status, 200)
  assert.equal(cliproxy.received.length, 0)
  assert.equal(claude.received[0].body.model, 'claude-sonnet-5-5')
  assert.equal(claude.received[0].headers.authorization, 'Bearer test-claude-oauth')
})

test('an unavailable Gemini model returns 503 without contacting either upstream', async (t) => {
  const { url, claude, cliproxy } = await setup(t, { key: null })

  const result = await request(url, '/v1/messages', message(PRO_MODEL))

  assert.equal(result.status, 503)
  assert.match(JSON.parse(result.body).error, /CLIPROXY_KEY/)
  assert.equal(claude.received.length, 0)
  assert.equal(cliproxy.received.length, 0)
})

test('a Gemini SSE response passes through the configured example unchanged', async (t) => {
  const payload = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
  const { url, claude, cliproxy } = await setup(t, {
    response: { payload, contentType: 'text/event-stream' },
  })

  const result = await request(url, '/v1/messages', message(FLASH_MODEL, { stream: true }))

  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'text/event-stream')
  assert.equal(result.body, payload)
  assert.equal(cliproxy.received[0].body.stream, true)
  assert.equal(claude.received.length, 0)
})
