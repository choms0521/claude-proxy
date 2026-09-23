import http from 'node:http'
import { handleAdmin } from './admin.js'
import { proxyRequest } from './proxy.js'
import { validateRequest } from './guard.js'
import { sendJson, log } from './utils.js'

export function createServer(initialState) {
  let state = initialState

  const server = http.createServer(async (req, res) => {
    try {
      const rejection = validateRequest(req, state.allowedHosts)
      if (rejection) {
        log('warn', `Rejected ${req.method} ${req.url}: ${rejection.error}`)
        sendJson(res, rejection.status, { success: false, error: rejection.error })
        return
      }

      if (req.url.startsWith('/admin/')) {
        const { newState } = await handleAdmin(req, res, state)
        if (newState) {
          state = newState
        }
        return
      }

      await proxyRequest(req, res, state)
    } catch (err) {
      const status = err.statusCode ?? 500
      log('error', 'Request failed', { error: err.message })
      if (!res.headersSent) {
        sendJson(res, status, {
          success: false,
          error: status === 500 ? 'Internal proxy error' : err.message,
        })
      }
    }
  })

  return server
}
