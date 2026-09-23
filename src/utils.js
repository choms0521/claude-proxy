export function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export const MAX_BODY_BYTES = 32 * 1024 * 1024

function bodyTooLargeError(maxBytes) {
  const err = new Error(`Request body exceeds the ${maxBytes}-byte limit`)
  err.statusCode = 413
  return err
}

// Past the limit the rest of the body is drained and discarded, so the
// client finishes sending and can read the 413 response.
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= maxBytes) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > maxBytes) {
        reject(bodyTooLargeError(maxBytes))
        return
      }
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

export function log(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  }
  const output = level === 'error' ? console.error : console.log
  output(JSON.stringify(entry))
}
