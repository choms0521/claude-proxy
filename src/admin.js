import { switchBackend } from './config.js'
import { sendJson, readBody, log } from './utils.js'

export function handleStatus(state) {
  return {
    success: true,
    data: {
      activeBackend: state.activeBackend,
      activeBackendName: state.backends[state.activeBackend]?.name,
      availableBackends: Object.entries(state.backends).map(([id, b]) => ({
        id,
        name: b.name,
        active: id === state.activeBackend,
        available: b.available,
        ...(b.available ? {} : { unavailableReason: b.unavailableReason }),
        models: b.models ?? [],
      })),
    },
  }
}

const SESSION_ONLY_HINT = 'press s to use for this session only'

// Builds a Claude Code settings object whose `modelPicker` rows list the
// models of every available backend. Choosing a row with Enter would save it
// as the default model for plain `claude` too, so each row says to press s.
export function buildModelPicker(state) {
  const options = Object.values(state.backends)
    .filter((b) => b.available)
    .flatMap((b) =>
      (b.models ?? []).map((m) => ({
        model: m.id,
        label: m.label ?? m.id,
        description: [m.description, b.name, SESSION_ONLY_HINT].filter(Boolean).join(' · '),
      }))
    )
  return { modelPicker: { options } }
}

// Rejects requests a browser page could forge: cross-origin fetches carry an
// Origin header, and simple (preflight-free) requests cannot set a JSON content type.
export function validateSwitchRequest(headers) {
  if (headers.origin) {
    return { status: 403, error: 'Cross-origin admin requests are not allowed' }
  }
  const contentType = (headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return { status: 415, error: 'Content-Type must be application/json' }
  }
  return null
}

export async function handleSwitch(req, state) {
  const body = await readBody(req)
  let parsed

  try {
    parsed = JSON.parse(body.toString())
  } catch {
    return { result: { success: false, error: 'Invalid JSON body' }, newState: null }
  }

  const { backend } = parsed
  if (!backend) {
    return { result: { success: false, error: 'Missing "backend" field' }, newState: null }
  }

  const switchResult = switchBackend(state, backend)

  if (!switchResult.success) {
    return { result: { success: false, error: switchResult.error }, newState: null }
  }

  const previousBackend = state.activeBackend

  log('info', `Backend switched: ${previousBackend} -> ${backend}`)

  return {
    result: {
      success: true,
      data: {
        activeBackend: backend,
        previousBackend,
        changed: switchResult.changed,
      },
    },
    newState: switchResult.state,
  }
}

export async function handleAdmin(req, res, state) {
  const { method, url } = req

  if (method === 'GET' && url === '/admin/status') {
    const result = handleStatus(state)
    sendJson(res, 200, result)
    return { newState: null }
  }

  if (method === 'GET' && url === '/admin/model-picker') {
    sendJson(res, 200, buildModelPicker(state))
    return { newState: null }
  }

  if (method === 'POST' && url === '/admin/switch') {
    const rejection = validateSwitchRequest(req.headers)
    if (rejection) {
      sendJson(res, rejection.status, { success: false, error: rejection.error })
      return { newState: null }
    }
    const { result, newState } = await handleSwitch(req, state)
    const statusCode = result.success ? 200 : 400
    sendJson(res, statusCode, result)
    return { newState }
  }

  sendJson(res, 404, { success: false, error: 'Unknown admin endpoint' })
  return { newState: null }
}
