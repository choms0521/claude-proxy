import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './utils.js'

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

function normalizeModel(backendId, model, index) {
  if (!model || typeof model.id !== 'string' || model.id === '') {
    throw new Error(`Backend "${backendId}": models[${index}] needs a non-empty string "id"`)
  }
  return Object.freeze({
    id: model.id,
    label: typeof model.label === 'string' && model.label ? model.label : model.id,
    ...(typeof model.description === 'string' ? { description: model.description } : {}),
  })
}

// `models` lists upstream model ids that are routed to this backend by the
// request body `model` field and offered in the Claude Code /model picker.
function normalizeModels(backendId, models) {
  if (models === undefined) return Object.freeze([])
  if (!Array.isArray(models)) {
    throw new Error(`Backend "${backendId}": "models" must be an array`)
  }
  return Object.freeze(models.map((model, index) => normalizeModel(backendId, model, index)))
}

function resolveBackend(id, rawBackend) {
  const backend = { ...rawBackend, models: normalizeModels(id, rawBackend.models) }
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
    Object.entries(backends).map(([id, backend]) => [id, resolveBackend(id, backend)])
  )
}

// Routing uses the first backend in config order, so a model id listed
// under two backends is reachable only through the first one.
function warnDuplicateModelIds(backends) {
  const owners = new Map()
  for (const [id, backend] of Object.entries(backends)) {
    for (const model of backend.models) {
      owners.set(model.id, [...(owners.get(model.id) ?? []), id])
    }
  }
  for (const [modelId, backendIds] of owners) {
    if (backendIds.length > 1) {
      log(
        'warn',
        `Model "${modelId}" is listed under backends ${backendIds.join(', ')}; requests go to ${backendIds[0]}`
      )
    }
  }
}

// Extra Host header values (host:port) the router accepts besides the
// loopback names, for example when another container reaches it by name.
function parseAllowedHosts(value) {
  return Object.freeze(
    (value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )
}

export function loadConfig(configPath) {
  const fullPath = configPath || resolve(__dirname, '..', 'config.json')
  const raw = JSON.parse(readFileSync(fullPath, 'utf-8'))
  const backends = Object.freeze(resolveBackends(raw.backends))
  warnDuplicateModelIds(backends)

  return Object.freeze({
    host: process.env.PROXY_HOST || raw.host || '127.0.0.1',
    port: raw.port || 3456,
    allowedHosts: parseAllowedHosts(process.env.PROXY_ALLOWED_HOSTS),
    activeBackend: raw.activeBackend || 'claude',
    backends,
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
