const CLIENT_CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'proxy-authorization', 'cookie']

function stripClientCredentials(headers) {
  const result = { ...headers }
  for (const key of Object.keys(result)) {
    if (CLIENT_CREDENTIAL_HEADERS.includes(key.toLowerCase())) {
      delete result[key]
    }
  }
  return result
}

export function buildHeaders(originalHeaders, backend, targetUrl) {
  const headers = backend.forwardClientAuth === true
    ? { ...originalHeaders }
    : stripClientCredentials(originalHeaders)

  if (backend.apiKey) {
    headers['x-api-key'] = backend.apiKey
  }
  headers['host'] = targetUrl.host

  delete headers['connection']
  delete headers['keep-alive']

  // When we intend to filter the response body as text, ask upstream for an
  // uncompressed stream so the text filter never sees compressed bytes.
  if (backend.filterChinese) {
    headers['accept-encoding'] = 'identity'
  }

  return headers
}
