import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { validateSwitchRequest, handleStatus, buildModelPicker } from '../src/admin.js'
import { createServer } from '../src/server.js'

test('accepts a JSON switch request without an Origin header', () => {
  const result = validateSwitchRequest({ 'content-type': 'application/json' })

  assert.equal(result, null)
})

test('accepts JSON content type with a charset parameter', () => {
  const result = validateSwitchRequest({ 'content-type': 'application/json; charset=utf-8' })

  assert.equal(result, null)
})

test('rejects a switch request carrying an Origin header', () => {
  const result = validateSwitchRequest({
    'content-type': 'application/json',
    origin: 'https://example.com',
  })

  assert.equal(result.status, 403)
})

test('rejects a switch request without a JSON content type', () => {
  const result = validateSwitchRequest({ 'content-type': 'text/plain' })

  assert.equal(result.status, 415)
})

test('rejects a switch request with no content type', () => {
  const result = validateSwitchRequest({})

  assert.equal(result.status, 415)
})

test('status reports availability for each backend', () => {
  const state = {
    activeBackend: 'claude',
    backends: {
      claude: { name: 'Claude', available: true },
      gpt: { name: 'GPT', available: false, unavailableReason: 'Environment variable CLIPROXY_KEY is not set' },
    },
  }

  const result = handleStatus(state)

  const claude = result.data.availableBackends.find((b) => b.id === 'claude')
  const gpt = result.data.availableBackends.find((b) => b.id === 'gpt')

  assert.equal(claude.available, true)
  assert.equal(claude.unavailableReason, undefined)
  assert.equal(gpt.available, false)
  assert.equal(gpt.unavailableReason, 'Environment variable CLIPROXY_KEY is not set')
})

const PICKER_STATE = {
  activeBackend: 'claude',
  backends: {
    claude: { name: 'Claude API', available: true, models: [] },
    gpt: {
      name: 'GPT (CLIProxyAPI)',
      available: true,
      models: [
        { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
        { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Fast' },
      ],
    },
    kimi: {
      name: 'Kimi',
      available: false,
      unavailableReason: 'Environment variable KIMI_API_KEY is not set',
      models: [{ id: 'kimi-k2', label: 'Kimi K2' }],
    },
    minimax: { name: 'MiniMax API', available: true },
  },
}

test('model picker lists models from available backends with a press-s hint', () => {
  const settings = buildModelPicker(PICKER_STATE)

  assert.deepEqual(settings, {
    modelPicker: {
      options: [
        {
          model: 'gpt-6-astra',
          label: 'GPT-6 Astra',
          description: 'GPT (CLIProxyAPI) · press s to use for this session only',
        },
        {
          model: 'gpt-5.5',
          label: 'GPT-5.5',
          description: 'Fast · GPT (CLIProxyAPI) · press s to use for this session only',
        },
      ],
    },
  })
})

test('model picker omits unavailable backends', () => {
  const settings = buildModelPicker(PICKER_STATE)

  assert.ok(!settings.modelPicker.options.some((o) => o.model === 'kimi-k2'))
})

test('model picker is empty when no backend lists models', () => {
  const settings = buildModelPicker({
    activeBackend: 'claude',
    backends: { claude: { name: 'Claude API', available: true } },
  })

  assert.deepEqual(settings, { modelPicker: { options: [] } })
})

test('status includes each backend model list', () => {
  const result = handleStatus(PICKER_STATE)
  const byId = Object.fromEntries(result.data.availableBackends.map((b) => [b.id, b]))

  assert.deepEqual(byId.gpt.models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.5'])
  assert.deepEqual(byId.kimi.models.map((m) => m.id), ['kimi-k2'])
  assert.deepEqual(byId.minimax.models, [])
})

test('GET /admin/model-picker returns ready-to-write settings JSON', async () => {
  const server = createServer(PICKER_STATE)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { status, contentType, body } = await new Promise((resolve, reject) => {
      http
        .get(
          `http://127.0.0.1:${server.address().port}/admin/model-picker`,
          { agent: false },
          (res) => {
            const chunks = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                contentType: res.headers['content-type'],
                body: Buffer.concat(chunks).toString(),
              })
            )
          }
        )
        .on('error', reject)
    })

    assert.equal(status, 200)
    assert.match(contentType, /application\/json/)
    assert.deepEqual(JSON.parse(body), buildModelPicker(PICKER_STATE))
  } finally {
    server.close()
  }
})
