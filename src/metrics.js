import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { MAX_BODY_BYTES, log } from './utils.js'

export const DEFAULT_PAYLOAD_METRICS_PATH = '/tmp/claude-proxy-last-payload.json'

let tempCounter = 0

export function buildPayloadMetric({
  payloadBytes,
  forwardedPayloadBytes = payloadBytes,
  maxPayloadBytes = MAX_BODY_BYTES,
  model = null,
  backend = null,
  path = null,
  timestamp = new Date().toISOString(),
}) {
  return Object.freeze({
    payloadBytes,
    forwardedPayloadBytes,
    maxPayloadBytes,
    model: typeof model === 'string' && model !== '' ? model : null,
    backend: typeof backend === 'string' && backend !== '' ? backend : null,
    path: typeof path === 'string' && path !== '' ? path : null,
    timestamp,
  })
}

export function updatePayloadMetrics(prevMetrics, metric) {
  if (!metric) return prevMetrics ?? null
  const prevByModel = prevMetrics?.byModel ?? {}
  const byModel = metric.model
    ? Object.freeze({ ...prevByModel, [metric.model]: metric })
    : Object.freeze({ ...prevByModel })
  return Object.freeze({
    lastRequestPayloadBytes: metric.payloadBytes,
    lastRequest: metric,
    byModel,
  })
}

export function writePayloadMetricsFile(filePath, payloadMetrics) {
  if (typeof filePath !== 'string' || filePath === '' || !payloadMetrics?.lastRequest) {
    return false
  }
  const { lastRequest, byModel } = payloadMetrics
  const payload = JSON.stringify({
    lastRequestPayloadBytes: lastRequest.payloadBytes,
    ...lastRequest,
    lastRequest,
    byModel: byModel ?? {},
  })
  const tmpPath = `${filePath}.${process.pid}.${++tempCounter}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(tmpPath, payload, 'utf-8')
    renameSync(tmpPath, filePath)
    return true
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {}
    log('warn', 'Failed to write payload metrics file', {
      path: filePath,
      error: err.message,
    })
    return false
  }
}
