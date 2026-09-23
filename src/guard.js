const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]']
const WRITE_METHODS = ['POST', 'PUT', 'PATCH']

function isJsonContentType(value) {
  return (value || '').split(';')[0].trim().toLowerCase() === 'application/json'
}

// Rejects requests a web page could send or read. Browsers attach an Origin
// header to cross-origin requests; DNS rebinding keeps the attacker's
// hostname in Host; and preflight-free requests cannot use a JSON content
// type. Claude Code sends JSON, no Origin, and Host 127.0.0.1:<port>.
export function validateRequest(req, allowedHosts = []) {
  if (req.headers.origin !== undefined) {
    return { status: 403, error: 'Cross-origin requests are not allowed' }
  }

  const host = (req.headers.host || '').toLowerCase()
  const port = req.socket.localPort
  const permitted = [...LOOPBACK_HOSTNAMES.map((name) => `${name}:${port}`), ...allowedHosts]
  if (!permitted.includes(host)) {
    return { status: 403, error: 'Host header is not allowed' }
  }

  if (WRITE_METHODS.includes(req.method) && !isJsonContentType(req.headers['content-type'])) {
    return { status: 415, error: 'Content-Type must be application/json' }
  }

  return null
}
