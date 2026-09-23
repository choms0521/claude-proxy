import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

class MissingEnvVarError extends Error {
  constructor(envVar) {
    super(`Environment variable ${envVar} is not set`)
    this.envVar = envVar
  }
}

// Supports `${VAR}` and `${VAR:-default}`. A referenced var with no default
// that is unset throws MissingEnvVarError; the caller decides how to react.
function resolveEnvVars(value) {
  if (typeof value !== 'string') return value

  let missingVar = null
  const resolved = value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, envVar, defaultValue) => {
    if (missingVar) return ''
    const envValue = process.env[envVar]
    // Shell `:-` semantics: unset AND empty both count as "not set".
    if (envValue) return envValue
    if (defaultValue !== undefined) return defaultValue
    missingVar = envVar
    return ''
  })

  if (missingVar) {
    throw new MissingEnvVarError(missingVar)
  }
  return resolved
}

function resolveBackend(backend) {
  try {
    return Object.freeze({
      ...backend,
      baseUrl: resolveEnvVars(backend.baseUrl),
      apiKey: backend.apiKey ? resolveEnvVars(backend.apiKey) : null,
      available: true,
    })
  } catch (err) {
    if (!(err instanceof MissingEnvVarError)) throw err
    return Object.freeze({
      ...backend,
      baseUrl: null,
      apiKey: null,
      available: false,
      unavailableReason: err.message,
    })
  }
}

function resolveBackends(backends) {
  return Object.fromEntries(
    Object.entries(backends).map(([id, backend]) => [id, resolveBackend(backend)])
  )
}

export function loadConfig(configPath) {
  const fullPath = configPath || resolve(__dirname, '..', 'config.json')
  const raw = JSON.parse(readFileSync(fullPath, 'utf-8'))

  return Object.freeze({
    host: process.env.PROXY_HOST || raw.host || '127.0.0.1',
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
  if (!backend.available) {
    throw new Error(
      `Active backend "${state.activeBackend}" is unavailable: ${backend.unavailableReason}`
    )
  }
  return { id: state.activeBackend, ...backend }
}

export function switchBackend(state, backendId) {
  const backend = state.backends[backendId]
  if (!backend) {
    return { success: false, error: `Unknown backend: ${backendId}` }
  }
  if (!backend.available) {
    return {
      success: false,
      error: `Backend "${backendId}" is unavailable: ${backend.unavailableReason}`,
    }
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
