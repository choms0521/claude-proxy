import http from 'node:http'
import { handleAdmin } from './admin.js'
import { proxyRequest } from './proxy.js'
import { sendJson, log } from './utils.js'

export function createServer(initialState) {
  let state = initialState

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/admin/')) {
        const { newState } = await handleAdmin(req, res, state)
        if (newState) {
          state = newState
        }
        return
      }

      await proxyRequest(req, res, state)
    } catch (err) {
      log('error', 'Unhandled server error', { error: err.message })
      if (!res.headersSent) {
        sendJson(res, 500, { success: false, error: 'Internal proxy error' })
      }
    }
  })

  return server
}
