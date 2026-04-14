import https from 'node:https'
import http from 'node:http'
import { getActiveBackend } from './config.js'
import { sendJson, readBody, log } from './utils.js'
import { createChineseFilter } from './filters.js'

function buildTargetUrl(backend, path) {
  const base = backend.baseUrl.replace(/\/$/, '')
  return new URL(base + path)
}

function buildHeaders(originalHeaders, backend, targetUrl) {
  const headers = { ...originalHeaders }

  if (backend.apiKey) {
    headers['x-api-key'] = backend.apiKey
  }
  headers['host'] = targetUrl.host

  delete headers['connection']
  delete headers['keep-alive']

  return headers
}

export async function proxyRequest(clientReq, clientRes, state) {
  let backend

  try {
    backend = getActiveBackend(state)
  } catch (err) {
    log('error', 'No active backend', { error: err.message })
    sendJson(clientRes, 502, { success: false, error: 'No active backend configured' })
    return
  }

  const targetUrl = buildTargetUrl(backend, clientReq.url)
  const headers = buildHeaders(clientReq.headers, backend, targetUrl)
  const transport = targetUrl.protocol === 'https:' ? https : http

  log('info', `Proxying ${clientReq.method} ${clientReq.url} -> ${backend.name}`)

  let body = await readBody(clientReq)

  if (body.length > 0 && clientReq.url.includes('/messages')) {
    try {
      const parsed = JSON.parse(body.toString())
      let modified = { ...parsed }

      if (backend.modelMapping && modified.model) {
        modified = { ...modified, model: backend.modelMapping }
      }

      if (modified.messages) {
        modified = {
          ...modified,
          messages: modified.messages.map((msg) => {
            if (!Array.isArray(msg.content)) return msg
            const filtered = msg.content.filter((block) => block.type !== 'thinking')
            return { ...msg, content: filtered }
          }),
        }
      }

      body = Buffer.from(JSON.stringify(modified))
      headers['content-length'] = String(body.length)
    } catch {
      // not JSON, forward as-is
    }
  }

  const proxyReq = transport.request(
    targetUrl,
    {
      method: clientReq.method,
      headers,
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)

      if (backend.filterChinese) {
        const filter = createChineseFilter()
        proxyRes.pipe(filter).pipe(clientRes)
      } else {
        proxyRes.pipe(clientRes)
      }
    }
  )

  proxyReq.on('error', (err) => {
    log('error', `Proxy request failed: ${backend.name}`, { error: err.message })
    if (!clientRes.headersSent) {
      sendJson(clientRes, 502, {
        success: false,
        error: `Backend "${backend.name}" connection failed: ${err.message}`,
      })
    }
  })

  if (body.length > 0) {
    proxyReq.write(body)
  }
  proxyReq.end()
}
