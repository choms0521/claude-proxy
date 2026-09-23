import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, getActiveBackend, switchBackend } from '../src/config.js'

const TRACKED_VARS = ['CLAUDE_PROXY_TEST_VAR', 'CLAUDE_PROXY_TEST_KEY']
const ORIGINAL_ENV = Object.fromEntries(TRACKED_VARS.map((name) => [name, process.env[name]]))

function writeConfig(backends, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-proxy-config-env-'))
  const path = join(dir, 'config.json')
  const config = {
    port: 3456,
    activeBackend: 'claude',
    backends,
    ...extra,
  }
  writeFileSync(path, JSON.stringify(config))
  return path
}

afterEach(() => {
  for (const name of TRACKED_VARS) {
    if (ORIGINAL_ENV[name] === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = ORIGINAL_ENV[name]
    }
  }
})

test('resolves ${VAR} from the environment', () => {
  process.env.CLAUDE_PROXY_TEST_VAR = 'https://resolved.example.com'

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: { name: 'Probe', baseUrl: '${CLAUDE_PROXY_TEST_VAR}', apiKey: null },
    })
  )

  assert.equal(config.backends.probe.baseUrl, 'https://resolved.example.com')
  assert.equal(config.backends.probe.available, true)
})

test('falls back to the default in ${VAR:-default} when the env var is unset', () => {
  delete process.env.CLAUDE_PROXY_TEST_VAR

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: '${CLAUDE_PROXY_TEST_VAR:-http://127.0.0.1:8317}',
        apiKey: null,
      },
    })
  )

  assert.equal(config.backends.probe.baseUrl, 'http://127.0.0.1:8317')
  assert.equal(config.backends.probe.available, true)
})

test('${VAR:-default} prefers the environment value when set', () => {
  process.env.CLAUDE_PROXY_TEST_VAR = 'http://192.168.1.1:9000'

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: '${CLAUDE_PROXY_TEST_VAR:-http://127.0.0.1:8317}',
        apiKey: null,
      },
    })
  )

  assert.equal(config.backends.probe.baseUrl, 'http://192.168.1.1:9000')
})

test('a missing required env var marks only that backend unavailable, without crashing startup', () => {
  delete process.env.CLAUDE_PROXY_TEST_KEY

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: 'https://probe.example.com',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  assert.equal(config.backends.probe.available, false)
  assert.equal(
    config.backends.probe.unavailableReason,
    'Environment variable CLAUDE_PROXY_TEST_KEY is not set'
  )
  assert.equal(config.backends.claude.available, true)
})

test('unavailable backend does not retain a half-resolved value', () => {
  delete process.env.CLAUDE_PROXY_TEST_KEY

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: 'https://probe.example.com',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  assert.equal(config.backends.probe.apiKey, null)
})

test('the unavailable reason never includes a secret value', () => {
  process.env.CLAUDE_PROXY_TEST_KEY = 'super-secret-value'

  delete process.env.CLAUDE_PROXY_TEST_VAR
  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: '${CLAUDE_PROXY_TEST_VAR}',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  assert.equal(config.backends.probe.available, false)
  assert.ok(!JSON.stringify(config.backends.probe).includes('super-secret-value'))
})

test('startup still fails clearly when the default activeBackend is unavailable', () => {
  delete process.env.CLAUDE_PROXY_TEST_KEY

  const config = loadConfig(
    writeConfig(
      {
        claude: {
          name: 'Claude',
          baseUrl: 'https://api.anthropic.com',
          apiKey: '${CLAUDE_PROXY_TEST_KEY}',
        },
      },
      { activeBackend: 'claude' }
    )
  )

  assert.throws(() => getActiveBackend(config), /unavailable/i)
})

test('getActiveBackend returns the backend unchanged when available', () => {
  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
    })
  )

  const active = getActiveBackend(config)

  assert.equal(active.id, 'claude')
  assert.equal(active.name, 'Claude')
})

test('switchBackend refuses to switch to an unavailable backend', () => {
  delete process.env.CLAUDE_PROXY_TEST_KEY

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: 'https://probe.example.com',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  const result = switchBackend(config, 'probe')

  assert.equal(result.success, false)
  assert.match(result.error, /unavailable/i)
})

test('an empty-string env var is treated as unset, not as a valid empty value', () => {
  process.env.CLAUDE_PROXY_TEST_KEY = ''

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: 'https://probe.example.com',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  assert.equal(config.backends.probe.available, false)
  assert.equal(
    config.backends.probe.unavailableReason,
    'Environment variable CLAUDE_PROXY_TEST_KEY is not set'
  )
})

test('an empty-string env var falls back to the default in ${VAR:-default}', () => {
  process.env.CLAUDE_PROXY_TEST_VAR = ''

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: '${CLAUDE_PROXY_TEST_VAR:-http://127.0.0.1:8317}',
        apiKey: null,
      },
    })
  )

  assert.equal(config.backends.probe.baseUrl, 'http://127.0.0.1:8317')
  assert.equal(config.backends.probe.available, true)
})

test('switchBackend still switches successfully to an available backend', () => {
  process.env.CLAUDE_PROXY_TEST_KEY = 'a-key'

  const config = loadConfig(
    writeConfig({
      claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: null },
      probe: {
        name: 'Probe',
        baseUrl: 'https://probe.example.com',
        apiKey: '${CLAUDE_PROXY_TEST_KEY}',
      },
    })
  )

  const result = switchBackend(config, 'probe')

  assert.equal(result.success, true)
  assert.equal(result.changed, true)
  assert.equal(result.state.activeBackend, 'probe')
})
