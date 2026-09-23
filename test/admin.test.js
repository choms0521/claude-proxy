import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSwitchRequest } from '../src/admin.js'

test('accepts a JSON switch request without an Origin header', () => {
  const result = validateSwitchRequest({ 'content-type': 'application/json' })

  assert.equal(result, null)
})

test('accepts JSON content type with a charset parameter', () => {
  const result = validateSwitchRequest({ 'content-type': 'application/json; charset=utf-8' })

  assert.equal(result, null)
})

test('rejects a switch request carrying an Origin header', () => {
  const result = validateSwitchRequest({
    'content-type': 'application/json',
    origin: 'https://example.com',
  })

  assert.equal(result.status, 403)
})

test('rejects a switch request without a JSON content type', () => {
  const result = validateSwitchRequest({ 'content-type': 'text/plain' })

  assert.equal(result.status, 415)
})

test('rejects a switch request with no content type', () => {
  const result = validateSwitchRequest({})

  assert.equal(result.status, 415)
})
