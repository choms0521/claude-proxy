import { getActiveBackend } from './config.js'

// Returns the id of the first backend (in config order) whose `models`
// lists the given model id, or null when none does.
function findModelBackendId(state, model) {
  if (typeof model !== 'string' || model === '') return null
  const match = Object.entries(state.backends).find(([, backend]) =>
    (backend.models ?? []).some((entry) => entry.id === model)
  )
  return match ? match[0] : null
}

// Chooses the backend for one request. A body `model` listed in some
// backend's `models` wins; anything else follows the active backend.
// Returns { backend, matchedModel } or { status, error } (no secrets).
export function selectBackend(state, model) {
  const matchedId = findModelBackendId(state, model)

  if (matchedId) {
    const backend = state.backends[matchedId]
    if (!backend.available) {
      return {
        status: 503,
        error: `Model "${model}" is served by backend "${backend.name}", which is unavailable: ${backend.unavailableReason}`,
      }
    }
    return { backend: { id: matchedId, ...backend }, matchedModel: model }
  }

  try {
    return { backend: getActiveBackend(state), matchedModel: null }
  } catch (err) {
    return { status: 502, error: 'No active backend configured', cause: err.message }
  }
}
