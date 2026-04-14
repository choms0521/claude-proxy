import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveEnvVars(value) {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{(\w+)\}/g, (_, envVar) => {
    const resolved = process.env[envVar]
    if (!resolved) {
      throw new Error(`Environment variable ${envVar} is not set`)
    }
    return resolved
  })
}

function resolveBackends(backends) {
  return Object.fromEntries(
    Object.entries(backends).map(([id, backend]) => [
      id,
      Object.freeze({
        ...backend,
        baseUrl: resolveEnvVars(backend.baseUrl),
        apiKey: backend.apiKey ? resolveEnvVars(backend.apiKey) : null,
      }),
    ])
  )
}

export function loadConfig(configPath) {
  const fullPath = configPath || resolve(__dirname, '..', 'config.json')
  const raw = JSON.parse(readFileSync(fullPath, 'utf-8'))

  return Object.freeze({
    port: raw.port || 3456,
    activeBackend: raw.activeBackend || 'claude',
    backends: Object.freeze(resolveBackends(raw.backends)),
  })
}

export function getActiveBackend(state) {
  const backend = state.backends[state.activeBackend]
  if (!backend) {
    throw new Error(`Active backend "${state.activeBackend}" not found in config`)
  }
  return { id: state.activeBackend, ...backend }
}

export function switchBackend(state, backendId) {
  if (!state.backends[backendId]) {
    return { success: false, error: `Unknown backend: ${backendId}` }
  }
  if (state.activeBackend === backendId) {
    return { success: true, state, changed: false }
  }
  const newState = Object.freeze({
    ...state,
    activeBackend: backendId,
  })
  return { success: true, state: newState, changed: true }
}
