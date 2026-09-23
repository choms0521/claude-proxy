import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../src/config.js'

const ORIGINAL_HOST = process.env.PROXY_HOST

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
