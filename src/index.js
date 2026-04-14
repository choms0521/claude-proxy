import { loadConfig, getActiveBackend } from './config.js'
import { createServer } from './server.js'
import { log } from './utils.js'

try {
  const config = loadConfig()
  const active = getActiveBackend(config)
  const server = createServer(config)

  server.listen(config.port, () => {
    log('info', `Proxy router started on port ${config.port}`)
    log('info', `Active backend: ${active.name} (${active.id})`)
    log('info', `Available backends: ${Object.keys(config.backends).join(', ')}`)
    console.log(`\n🚀 Proxy ready at http://localhost:${config.port}`)
    console.log(`📡 Routing to: ${active.name}`)
    console.log(`\nUsage: ANTHROPIC_BASE_URL=http://localhost:${config.port} claude\n`)
  })
} catch (err) {
  log('error', 'Failed to start proxy', { error: err.message })
  process.exit(1)
}
