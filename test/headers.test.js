import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHeaders } from '../src/headers.js'

const targetUrl = new URL('https://api.example.com/v1/messages')

test('non-forwarding backend strips client credential headers and injects backend key', () => {
  const originalHeaders = {
    Authorization: 'Bearer client-oauth-token',
    'X-Api-Key': 'client-key',
    Cookie: 'session=abc',
    'Proxy-Authorization': 'Basic xyz',
    'content-type': 'application/json',
  }
  const backend = { apiKey: 'backend-secret', forwardClientAuth: false }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['Authorization'], undefined)
  assert.equal(headers['authorization'], undefined)
  assert.equal(headers['X-Api-Key'], undefined)
  assert.equal(headers['Cookie'], undefined)
  assert.equal(headers['cookie'], undefined)
  assert.equal(headers['Proxy-Authorization'], undefined)
  assert.equal(headers['proxy-authorization'], undefined)
  assert.equal(headers['x-api-key'], 'backend-secret')
  assert.equal(headers['content-type'], 'application/json')
})

test('non-forwarding backend with no apiKey sends no credentials at all', () => {
  const originalHeaders = {
    authorization: 'Bearer client-oauth-token',
    'x-api-key': 'client-key',
    cookie: 'session=abc',
  }
  const backend = { apiKey: null, forwardClientAuth: false }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['authorization'], undefined)
  assert.equal(headers['x-api-key'], undefined)
  assert.equal(headers['cookie'], undefined)
})

test('forwardClientAuth backend keeps client authorization header', () => {
  const originalHeaders = {
    authorization: 'Bearer client-oauth-token',
    'x-api-key': 'client-key',
  }
  const backend = { apiKey: null, forwardClientAuth: true }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['authorization'], 'Bearer client-oauth-token')
  assert.equal(headers['x-api-key'], 'client-key')
})

test('forwardClientAuth backend with apiKey still overwrites x-api-key but keeps authorization', () => {
  const originalHeaders = {
    authorization: 'Bearer client-oauth-token',
    'x-api-key': 'client-key',
  }
  const backend = { apiKey: 'backend-secret', forwardClientAuth: true }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['authorization'], 'Bearer client-oauth-token')
  assert.equal(headers['x-api-key'], 'backend-secret')
})

test('host header is set to target host', () => {
  const backend = { apiKey: null, forwardClientAuth: true }
  const headers = buildHeaders({ host: 'localhost:3456' }, backend, targetUrl)

  assert.equal(headers['host'], targetUrl.host)
})

test('connection and keep-alive headers are removed', () => {
  const originalHeaders = { connection: 'keep-alive', 'keep-alive': 'timeout=5' }
  const backend = { apiKey: null, forwardClientAuth: true }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['connection'], undefined)
  assert.equal(headers['keep-alive'], undefined)
})

test('filterChinese backend sets accept-encoding to identity', () => {
  const backend = { apiKey: null, forwardClientAuth: true, filterChinese: true }
  const headers = buildHeaders({}, backend, targetUrl)

  assert.equal(headers['accept-encoding'], 'identity')
})

test('non-boolean forwardClientAuth value still strips client credentials', () => {
  const originalHeaders = { authorization: 'Bearer client-oauth-token' }
  const backend = { apiKey: null, forwardClientAuth: 'true' }

  const headers = buildHeaders(originalHeaders, backend, targetUrl)

  assert.equal(headers['authorization'], undefined)
})
