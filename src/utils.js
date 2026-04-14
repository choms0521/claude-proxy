export function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
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
