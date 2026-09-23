import https from 'node:https'
import http from 'node:http'
import zlib from 'node:zlib'
import { sendJson, readBody, log } from './utils.js'
import { createChineseFilter } from './filters.js'
import { buildHeaders } from './headers.js'
import { selectBackend } from './routing.js'

function buildTargetUrl(backend, path) {
  const base = backend.baseUrl.replace(/\/$/, '')
  return new URL(base + path)
}

// Returns the parsed JSON object body, or null for empty, non-JSON or
// non-object bodies (those are forwarded unchanged).
function parseJsonObject(body) {
  if (body.length === 0) return null
  try {
    const parsed = JSON.parse(body.toString())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stripThinkingBlocks(messages) {
  return messages.map((msg) => {
    if (!Array.isArray(msg?.content)) return msg
    return { ...msg, content: msg.content.filter((block) => block?.type !== 'thinking') }
  })
}

// A model id matched through `models` is already an upstream-native id, so
// the backend's `modelMapping` only applies to requests that follow the
// active backend.
function rewriteMessagesBody(parsed, backend, matchedModel) {
  const mapped =
    backend.modelMapping && parsed.model && !matchedModel
      ? { ...parsed, model: backend.modelMapping }
      : parsed
  const stripped = Array.isArray(mapped.messages)
    ? { ...mapped, messages: stripThinkingBlocks(mapped.messages) }
    : mapped
  return Buffer.from(JSON.stringify(stripped))
}

function pipeFilteredResponse(proxyRes, clientRes) {
  const filteredHeaders = { ...proxyRes.headers }
  delete filteredHeaders['content-length']
  // The filtered body is emitted uncompressed, so any upstream
  // content-encoding no longer describes what the client receives.
  delete filteredHeaders['content-encoding']
  filteredHeaders['transfer-encoding'] = 'chunked'
  clientRes.writeHead(proxyRes.statusCode, filteredHeaders)

  // Defense in depth: even though we request `accept-encoding: identity`,
  // upstream may still compress. Decompress before the text filter so it
  // never operates on compressed bytes (which would corrupt the stream).
  const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase()
  const decompressor =
    encoding === 'gzip' ? zlib.createGunzip()
    : encoding === 'br' ? zlib.createBrotliDecompress()
    : encoding === 'deflate' ? zlib.createInflate()
    : null

  const filter = createChineseFilter()
  const source = decompressor ? proxyRes.pipe(decompressor) : proxyRes
  source.pipe(filter).pipe(clientRes)
}

function describeChoice(matchedModel) {
  return matchedModel ? `chosen because model ${matchedModel} is listed` : 'active backend'
}

export async function proxyRequest(clientReq, clientRes, state) {
  // The body is read first because its `model` field decides the backend.
  const rawBody = await readBody(clientReq)
  const parsed = parseJsonObject(rawBody)
  const selection = selectBackend(state, parsed?.model)

  if (selection.error) {
    log('error', 'No backend for request', { error: selection.cause ?? selection.error })
    sendJson(clientRes, selection.status, { success: false, error: selection.error })
    return
  }

  const { backend, matchedModel } = selection
  const targetUrl = buildTargetUrl(backend, clientReq.url)
  const headers = buildHeaders(clientReq.headers, backend, targetUrl)
  const transport = targetUrl.protocol === 'https:' ? https : http
  const body =
    parsed && clientReq.url.includes('/messages')
      ? rewriteMessagesBody(parsed, backend, matchedModel)
      : rawBody

  if (body !== rawBody) {
    headers['content-length'] = String(body.length)
  }

  log(
    'info',
    `Proxying ${clientReq.method} ${clientReq.url} -> ${backend.name} (${describeChoice(matchedModel)})`
  )

  const proxyReq = transport.request(targetUrl, { method: clientReq.method, headers }, (proxyRes) => {
    if (backend.filterChinese) {
      pipeFilteredResponse(proxyRes, clientRes)
    } else {
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(clientRes)
    }
  })

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
