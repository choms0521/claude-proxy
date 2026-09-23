import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../src/config.js'

const ORIGINAL_HOST = process.env.PROXY_HOST
const ORIGINAL_ALLOWED_HOSTS = process.env.PROXY_ALLOWED_HOSTS

function writeConfig(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-proxy-config-'))
  const path = join(dir, 'config.json')
  const config = {
    port: 3456,
    activeBackend: 'claude',
    backends: {
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
    },
    ...extra,
  }
  writeFileSync(path, JSON.stringify(config))
  return path
}

afterEach(() => {
  if (ORIGINAL_HOST === undefined) {
    delete process.env.PROXY_HOST
  } else {
    process.env.PROXY_HOST = ORIGINAL_HOST
  }
  if (ORIGINAL_ALLOWED_HOSTS === undefined) {
    delete process.env.PROXY_ALLOWED_HOSTS
  } else {
    process.env.PROXY_ALLOWED_HOSTS = ORIGINAL_ALLOWED_HOSTS
  }
})

test('binds to loopback by default', () => {
  delete process.env.PROXY_HOST

  const config = loadConfig(writeConfig())

  assert.equal(config.host, '127.0.0.1')
})

test('uses host from config file when set', () => {
  delete process.env.PROXY_HOST

  const config = loadConfig(writeConfig({ host: '0.0.0.0' }))

  assert.equal(config.host, '0.0.0.0')
})

test('PROXY_HOST environment variable overrides the config file', () => {
  process.env.PROXY_HOST = '0.0.0.0'

  const config = loadConfig(writeConfig({ host: '127.0.0.1' }))

  assert.equal(config.host, '0.0.0.0')
})

test('backend models default to an empty list', () => {
  const config = loadConfig(writeConfig())

  assert.deepEqual(config.backends.claude.models, [])
})

test('backend models keep id, label and description', () => {
  const config = loadConfig(
    writeConfig({
      backends: {
        claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
        gpt: {
          name: 'GPT',
          baseUrl: 'http://127.0.0.1:8317',
          apiKey: null,
          models: [
            { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Frontier' },
            { id: 'gpt-5.5' },
          ],
        },
      },
    })
  )

  assert.deepEqual(config.backends.gpt.models, [
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Frontier' },
    { id: 'gpt-5.5', label: 'gpt-5.5' },
  ])
  assert.ok(Object.isFrozen(config.backends.gpt.models))
})

test('a model entry without a string id fails with a clear message', () => {
  const path = writeConfig({
    backends: {
      claude: {
        name: 'Claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: null,
        models: [{ label: 'No id' }],
      },
    },
  })

  assert.throws(() => loadConfig(path), /Backend "claude": models\[0\] needs a non-empty string "id"/)
})

test('models that are not an array fail with a clear message', () => {
  const path = writeConfig({
    backends: {
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null, models: 'gpt-5.5' },
    },
  })

  assert.throws(() => loadConfig(path), /Backend "claude": "models" must be an array/)
})

test('allowedHosts is empty by default', () => {
  delete process.env.PROXY_ALLOWED_HOSTS

  const config = loadConfig(writeConfig())

  assert.deepEqual(config.allowedHosts, [])
})

test('PROXY_ALLOWED_HOSTS adds lower-cased host:port entries', () => {
  process.env.PROXY_ALLOWED_HOSTS = ' Router.Internal:3456, ,claude-proxy-router:3456 '

  const config = loadConfig(writeConfig())

  assert.deepEqual(config.allowedHosts, ['router.internal:3456', 'claude-proxy-router:3456'])
})

test('warns when the same model id is listed under two backends', (t) => {
  const lines = []
  t.mock.method(console, 'log', (line) => lines.push(line))

  const config = loadConfig(
    writeConfig({
      backends: {
        claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
        gpt: { name: 'GPT', baseUrl: 'http://a', apiKey: null, models: [{ id: 'gpt-5.5' }] },
        other: { name: 'Other', baseUrl: 'http://b', apiKey: null, models: [{ id: 'gpt-5.5' }] },
      },
    })
  )

  assert.equal(config.backends.other.models[0].id, 'gpt-5.5')
  const warning = lines.map((line) => JSON.parse(line)).find((entry) => entry.level === 'warn')
  assert.ok(warning, 'expected a warn log entry')
  assert.match(warning.message, /gpt-5\.5/)
  assert.match(warning.message, /gpt/)
  assert.match(warning.message, /other/)
})

test('does not warn when model ids are unique', (t) => {
  const lines = []
  t.mock.method(console, 'log', (line) => lines.push(line))

  loadConfig(
    writeConfig({
      backends: {
        claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
        gpt: { name: 'GPT', baseUrl: 'http://a', apiKey: null, models: [{ id: 'gpt-5.5' }] },
      },
    })
  )

  assert.equal(lines.length, 0)
})
