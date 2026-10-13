import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer } from '../src/server.js'
import { selectBackend } from '../src/routing.js'
import { buildModelPicker } from '../src/admin.js'
import { readFileSync } from 'node:fs'

// Every upstream here is a local stub server on an ephemeral port. Requests
// use `agent: false` so no keep-alive socket holds a server open after a test.

const servers = []

function listen(server) {
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
}

async function startUpstream(responseBody = { ok: true }) {
  const received = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      received.push({
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      })
      const payload = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
    })
  })
  const url = await listen(server)
  return { url, received }
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

const CLIENT_HEADERS = {
  'content-type': 'application/json',
  authorization: 'Bearer claude-oauth-token',
  cookie: 'session=abc',
  'proxy-authorization': 'Basic xyz',
  'x-api-key': 'client-key',
}

const GPT_MODELS = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
]

async function setupRouter({ activeBackend = 'claude', gpt = {}, claude = {}, minimax = {} } = {}) {
  const upstreams = {
    claude: await startUpstream(),
    gpt: await startUpstream(),
    minimax: await startUpstream(),
  }
  const state = Object.freeze({
    activeBackend,
    backends: Object.freeze({
      claude: Object.freeze({
        name: 'Claude API',
        baseUrl: upstreams.claude.url,
        apiKey: null,
        forwardClientAuth: true,
        available: true,
        models: [],
        ...claude,
      }),
      gpt: Object.freeze({
        name: 'GPT (CLIProxyAPI)',
        baseUrl: upstreams.gpt.url,
        apiKey: 'gpt-backend-key',
        available: true,
        models: GPT_MODELS,
        ...gpt,
      }),
      minimax: Object.freeze({
        name: 'MiniMax API',
        baseUrl: upstreams.minimax.url,
        apiKey: 'minimax-backend-key',
        modelMapping: 'MiniMax-M2.7',
        available: true,
        models: [],
        ...minimax,
      }),
    }),
  })
  const routerUrl = await listen(createServer(state))
  return { routerUrl, upstreams }
}

const messageBody = (model, extra = {}) =>
  JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }], ...extra })

test('a gpt model id goes to the gpt backend while claude is active', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  const res = await send(routerUrl, '/v1/messages', {
    body: messageBody('gpt-6-astra'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(res.status, 200)
  assert.equal(upstreams.gpt.received.length, 1)
  assert.equal(upstreams.claude.received.length, 0)
  assert.equal(upstreams.gpt.received[0].url, '/v1/messages')
})

test('the Claude OAuth bearer and cookies never reach the gpt backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  await send(routerUrl, '/v1/messages', { body: messageBody('gpt-5.5'), headers: CLIENT_HEADERS })

  const { headers } = upstreams.gpt.received[0]
  assert.equal(headers.authorization, undefined)
  assert.equal(headers.cookie, undefined)
  assert.equal(headers['proxy-authorization'], undefined)
  assert.equal(headers['x-api-key'], 'gpt-backend-key')
  assert.doesNotMatch(JSON.stringify(headers), /claude-oauth-token|session=abc|client-key/)
})

test('a gpt model id is forwarded unchanged to the gpt backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({
    activeBackend: 'minimax',
    gpt: { modelMapping: undefined },
  })

  await send(routerUrl, '/v1/messages', { body: messageBody('gpt-6-astra'), headers: CLIENT_HEADERS })

  assert.equal(upstreams.minimax.received.length, 0)
  assert.equal(JSON.parse(upstreams.gpt.received[0].body).model, 'gpt-6-astra')
})

test('a model-matched request keeps its id even when that backend has modelMapping', async () => {
  const { routerUrl, upstreams } = await setupRouter({
    activeBackend: 'claude',
    minimax: { models: [{ id: 'MiniMax-M3', label: 'MiniMax M3' }] },
  })

  await send(routerUrl, '/v1/messages', { body: messageBody('MiniMax-M3'), headers: CLIENT_HEADERS })

  assert.equal(JSON.parse(upstreams.minimax.received[0].body).model, 'MiniMax-M3')
})

test('count_tokens with a gpt model id also goes to the gpt backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  await send(routerUrl, '/v1/messages/count_tokens', {
    body: messageBody('gpt-6-astra'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(upstreams.gpt.received.length, 1)
  assert.equal(upstreams.gpt.received[0].url, '/v1/messages/count_tokens')
  assert.equal(upstreams.gpt.received[0].headers.authorization, undefined)
})

test('an unlisted claude model follows the active claude backend with client auth', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  await send(routerUrl, '/v1/messages', {
    body: messageBody('claude-haiku-4-5'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(upstreams.gpt.received.length, 0)
  assert.equal(upstreams.claude.received.length, 1)
  assert.equal(upstreams.claude.received[0].headers.authorization, 'Bearer claude-oauth-token')
})

test('an unlisted model follows the active gpt backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'gpt' })

  await send(routerUrl, '/v1/messages', {
    body: messageBody('claude-opus-4-6'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(upstreams.claude.received.length, 0)
  assert.equal(upstreams.gpt.received.length, 1)
  assert.equal(upstreams.gpt.received[0].headers.authorization, undefined)
})

test('a model listed under claude goes to claude while gpt is active', async () => {
  const { routerUrl, upstreams } = await setupRouter({
    activeBackend: 'gpt',
    claude: { models: [{ id: 'claude-opus-4-6', label: 'Opus' }] },
  })

  await send(routerUrl, '/v1/messages', {
    body: messageBody('claude-opus-4-6'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(upstreams.gpt.received.length, 0)
  assert.equal(upstreams.claude.received.length, 1)
  assert.equal(upstreams.claude.received[0].headers.authorization, 'Bearer claude-oauth-token')
})

test('modelMapping still applies to requests that follow the active backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'minimax' })

  await send(routerUrl, '/v1/messages', {
    body: messageBody('claude-opus-4-6'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(JSON.parse(upstreams.minimax.received[0].body).model, 'MiniMax-M2.7')
})

test('thinking blocks are stripped from requests routed by model', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })
  const body = messageBody('gpt-6-astra', {
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret', signature: 'sig' },
          { type: 'text', text: 'answer' },
        ],
      },
    ],
  })

  await send(routerUrl, '/v1/messages', { body, headers: CLIENT_HEADERS })

  const forwarded = JSON.parse(upstreams.gpt.received[0].body)
  assert.deepEqual(forwarded.messages[0].content, [{ type: 'text', text: 'answer' }])
  assert.equal(
    upstreams.gpt.received[0].headers['content-length'],
    String(Buffer.byteLength(upstreams.gpt.received[0].body))
  )
})

test('an unavailable matched backend returns 503 without contacting any upstream', async () => {
  const { routerUrl, upstreams } = await setupRouter({
    activeBackend: 'claude',
    gpt: {
      baseUrl: null,
      apiKey: null,
      available: false,
      unavailableReason: 'Environment variable CLIPROXY_KEY is not set',
    },
  })

  const res = await send(routerUrl, '/v1/messages', {
    body: messageBody('gpt-6-astra'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(res.status, 503)
  assert.equal(upstreams.gpt.received.length, 0)
  assert.equal(upstreams.claude.received.length, 0)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.success, false)
  assert.match(parsed.error, /gpt-6-astra/)
  assert.match(parsed.error, /GPT \(CLIProxyAPI\)/)
  assert.match(parsed.error, /CLIPROXY_KEY/)
  assert.doesNotMatch(res.body, /claude-oauth-token|client-key/)
})

test('a non-JSON body is forwarded unchanged to the active backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  await send(routerUrl, '/v1/messages', {
    body: 'not json gpt-6-astra',
    headers: CLIENT_HEADERS,
  })

  assert.equal(upstreams.gpt.received.length, 0)
  assert.equal(upstreams.claude.received[0].body, 'not json gpt-6-astra')
})

for (const [name, model] of [
  ['__proto__', '__proto__'],
  ['constructor', 'constructor'],
  ['a number', 42],
  ['an object', { id: 'gpt-5.5' }],
  ['an array', ['gpt-5.5']],
]) {
  test(`a model value of ${name} follows the active backend`, async () => {
    const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

    const res = await send(routerUrl, '/v1/messages', {
      body: messageBody(model),
      headers: CLIENT_HEADERS,
    })

    assert.equal(res.status, 200)
    assert.equal(upstreams.gpt.received.length, 0)
    assert.equal(upstreams.claude.received.length, 1)
  })
}

test('a __proto__ key in the body is forwarded as data, not as a prototype', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })
  const body = '{"model":"claude-opus-4-6","__proto__":{"model":"gpt-5.5"},"messages":[]}'

  await send(routerUrl, '/v1/messages', { body, headers: CLIENT_HEADERS })

  assert.equal(upstreams.gpt.received.length, 0)
  const forwarded = JSON.parse(upstreams.claude.received[0].body)
  assert.equal(forwarded.model, 'claude-opus-4-6')
  assert.deepEqual(Object.getOwnPropertyDescriptor(forwarded, '__proto__').value, { model: 'gpt-5.5' })
})

test('a GET with no body follows the active backend', async () => {
  const { routerUrl, upstreams } = await setupRouter({ activeBackend: 'claude' })

  const res = await send(routerUrl, '/v1/models', { method: 'GET', headers: { authorization: 'Bearer t' } })

  assert.equal(res.status, 200)
  assert.equal(upstreams.gpt.received.length, 0)
  assert.equal(upstreams.claude.received[0].url, '/v1/models')
  assert.equal(upstreams.claude.received[0].body, '')
})

test('the response filter follows the backend chosen by model', async () => {
  const filtered = await startUpstream('data: {"delta":{"text":"hi \u4E2D\u6587"}}\n\n')
  const { routerUrl } = await setupRouter({
    activeBackend: 'claude',
    gpt: { baseUrl: filtered.url, filterChinese: true },
  })

  const res = await send(routerUrl, '/v1/messages', {
    body: messageBody('gpt-6-astra'),
    headers: CLIENT_HEADERS,
  })

  assert.match(res.body, /\[removed\]/)
  assert.equal(filtered.received[0].headers['accept-encoding'], 'identity')
})

test('selectBackend reports why each backend was chosen', () => {
  const state = {
    activeBackend: 'claude',
    backends: {
      claude: { name: 'Claude', available: true },
      gpt: { name: 'GPT', available: true, models: GPT_MODELS },
    },
  }

  const byModel = selectBackend(state, 'gpt-5.5')
  const byActive = selectBackend(state, 'claude-opus-4-6')
  const noModel = selectBackend(state, undefined)

  assert.equal(byModel.backend.id, 'gpt')
  assert.equal(byModel.matchedModel, 'gpt-5.5')
  assert.equal(byActive.backend.id, 'claude')
  assert.equal(byActive.matchedModel, null)
  assert.equal(noModel.backend.id, 'claude')
})

after(() => {
  for (const server of servers) {
    server.closeAllConnections?.()
    server.close()
  }
})

test('config.example.json lists GPT-6.1 Sol in the picker and forwards it unchanged', async () => {
  const example = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'))
  const models = example.backends.gpt.models
  const entry = models.find((m) => m.id === 'gpt-6.1-sol')
  assert.equal(entry?.label, 'GPT-6.1 Sol')

  const { routerUrl, upstreams } = await setupRouter({ gpt: { models } })
  const picker = buildModelPicker({
    activeBackend: 'claude',
    backends: { gpt: { name: 'GPT (CLIProxyAPI)', available: true, models } },
  })
  assert.ok(picker.modelPicker.options.some((o) => o.model === 'gpt-6.1-sol' && o.label === 'GPT-6.1 Sol'))

  const res = await send(routerUrl, '/v1/messages', {
    body: messageBody('gpt-6.1-sol'),
    headers: CLIENT_HEADERS,
  })

  assert.equal(res.status, 200)
  assert.equal(upstreams.gpt.received.length, 1)
  assert.equal(JSON.parse(upstreams.gpt.received[0].body).model, 'gpt-6.1-sol')
})
