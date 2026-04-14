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
      })),
    },
  }
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

  if (method === 'POST' && url === '/admin/switch') {
    const { result, newState } = await handleSwitch(req, state)
    const statusCode = result.success ? 200 : 400
    sendJson(res, statusCode, result)
    return { newState }
  }

  sendJson(res, 404, { success: false, error: 'Unknown admin endpoint' })
  return { newState: null }
}
