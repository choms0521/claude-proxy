import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// The launcher runs against stub docker/curl/open/node/claude executables.
// The spawned environment is built from scratch so no real keys, Docker
// engine or network endpoint is ever reached.

const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'claude-proxy')

const STUBS = {
  docker: `#!/bin/sh
echo "docker $*" >> "$STUB_DIR/calls.log"
set_up() {
  echo running > "$STUB_DIR/container_$1"
  case "$1" in
    cli-proxy-api) echo 404 > "$STUB_DIR/code_cliproxy" ;;
    claude-proxy-router) echo 200 > "$STUB_DIR/code_router" ;;
  esac
}
case "$1" in
  info) [ -f "$STUB_DIR/engine_up" ]; exit $? ;;
  inspect)
    for name; do :; done
    [ -f "$STUB_DIR/container_$name" ] || exit 1
    cat "$STUB_DIR/container_$name" ;;
  start|unpause) set_up "$2" ;;
  compose)
    echo "compose-cwd $(pwd)" >> "$STUB_DIR/calls.log"
    for last; do :; done
    case "$last" in
      router) set_up claude-proxy-router ;;
      cli-proxy-api) set_up cli-proxy-api ;;
    esac
    [ ! -f "$STUB_DIR/compose_fail" ] ;;
esac
`,
  curl: `#!/bin/sh
for url; do :; done
case "$url" in
  *:8317*) f="$STUB_DIR/code_cliproxy" ;;
  */admin/status) f="$STUB_DIR/code_router" ;;
esac
if [ -n "$f" ] && [ -f "$f" ]; then tr -d '\\n' < "$f"; exit 0; fi
printf 000
exit 7
`,
  open: `#!/bin/sh
echo "open $*" >> "$STUB_DIR/calls.log"
touch "$STUB_DIR/engine_up"
`,
  node: `#!/bin/sh
echo "node $*" >> "$STUB_DIR/calls.log"
if [ "$STUB_NODE_HEALTHY" = 1 ]; then echo 200 > "$STUB_DIR/code_router"; fi
while :; do sleep 1; done
`,
  claude: `#!/bin/sh
out="$STUB_DIR/claude.out"
echo "ANTHROPIC_BASE_URL=\${ANTHROPIC_BASE_URL-unset}" > "$out"
echo "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=\${CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC-unset}" >> "$out"
for name in ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL ANTHROPIC_SMALL_FAST_MODEL \\
  ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL \\
  CLAUDE_CODE_MAX_CONTEXT_TOKENS; do
  eval "v=\\\${$name+set}"
  echo "$name=\${v:-unset}" >> "$out"
done
for arg; do echo "arg:$arg" >> "$out"; done
exit 0
`,
}

const spawnedPids = []
const tempDirs = []

function killTree(pid) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target)
    } catch {
      // already exited or not a group leader
    }
  }
}

afterEach(() => {
  while (spawnedPids.length > 0) killTree(spawnedPids.pop())
})

function setup({ engineUp = true, cliproxy = 'running', router = 'running', routerCode = '200' } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'claude-proxy-launcher-')))
  tempDirs.push(base)
  const repo = join(base, 'repo')
  const stubs = join(base, 'stubs')
  const state = join(base, 'state')
  const cliproxyDir = join(base, 'CLIProxyAPI')
  for (const dir of [join(repo, 'bin'), join(repo, 'src'), stubs, state, cliproxyDir, join(base, 'link')]) {
    mkdirSync(dir, { recursive: true })
  }
  copyFileSync(LAUNCHER, join(repo, 'bin', 'claude-proxy'))
  chmodSync(join(repo, 'bin', 'claude-proxy'), 0o755)
  writeFileSync(join(repo, 'src', 'index.js'), '')
  writeFileSync(join(repo, 'compose.yaml'), '')
  writeFileSync(join(cliproxyDir, 'docker-compose.yml'), '')
  writeFileSync(join(cliproxyDir, '.env'), '')
  symlinkSync(join(repo, 'bin', 'claude-proxy'), join(base, 'link', 'claude-proxy'))

  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(stubs, name), body)
    chmodSync(join(stubs, name), 0o755)
  }
  if (engineUp) writeFileSync(join(state, 'engine_up'), '')
  if (cliproxy) {
    writeFileSync(join(state, 'container_cli-proxy-api'), `${cliproxy}\n`)
    if (cliproxy === 'running') writeFileSync(join(state, 'code_cliproxy'), '404')
  }
  if (router) writeFileSync(join(state, 'container_claude-proxy-router'), `${router}\n`)
  if (routerCode) writeFileSync(join(state, 'code_router'), routerCode)

  const env = {
    PATH: `${stubs}:/usr/bin:/bin`,
    HOME: base,
    STUB_DIR: state,
    DOCKER_BIN: join(stubs, 'docker'),
    CURL_BIN: join(stubs, 'curl'),
    OPEN_BIN: join(stubs, 'open'),
    NODE_BIN: join(stubs, 'node'),
    CLAUDE_BIN: join(stubs, 'claude'),
    CLIPROXY_DIR: cliproxyDir,
    CLAUDE_PROXY_POLL_INTERVAL: '0.05',
    CLAUDE_PROXY_DOCKER_TIMEOUT: '5',
    CLAUDE_PROXY_READY_TIMEOUT: '5',
  }
  return { base, repo, state, env, link: join(base, 'link', 'claude-proxy') }
}

function run(ctx, args = [], extraEnv = {}) {
  const result = spawnSync('/bin/bash', [ctx.link, ...args], {
    env: { ...ctx.env, ...extraEnv },
    encoding: 'utf-8',
    timeout: 20000,
  })
  const calls = existsSync(join(ctx.state, 'calls.log'))
    ? readFileSync(join(ctx.state, 'calls.log'), 'utf-8').split('\n').filter(Boolean)
    : []
  const claudeOut = existsSync(join(ctx.state, 'claude.out'))
    ? readFileSync(join(ctx.state, 'claude.out'), 'utf-8').split('\n').filter(Boolean)
    : null
  const pidFile = join(ctx.repo, 'proxy.pid')
  if (existsSync(pidFile)) spawnedPids.push(Number(readFileSync(pidFile, 'utf-8')))
  return { ...result, calls, claudeOut }
}

test('starts Docker Desktop and polls when the engine is down', () => {
  const ctx = setup({ engineUp: false })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes('open -a Docker'))
  assert.ok(r.calls.filter((c) => c === 'docker info').length >= 2)
  assert.ok(r.claudeOut)
})

test('fails with a clear message when the engine never comes up', () => {
  const ctx = setup({ engineUp: false })
  writeFileSync(join(ctx.base, 'stubs', 'open'), '#!/bin/sh\nexit 0\n')
  const r = run(ctx, [], { CLAUDE_PROXY_DOCKER_TIMEOUT: '1' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Docker engine did not start within 1s/)
  assert.equal(r.claudeOut, null)
})

test('reuses running containers without starting anything', () => {
  const ctx = setup()
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.calls.some((c) => c.startsWith('open')))
  assert.ok(!r.calls.some((c) => / (start|compose|unpause) /.test(`${c} `)))
})

test('starts a stopped cli-proxy-api container with docker start', () => {
  const ctx = setup({ cliproxy: 'exited' })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes('docker start cli-proxy-api'))
  assert.ok(!r.calls.some((c) => c.startsWith('docker compose')))
})

test('creates a missing cli-proxy-api via compose from the repo root', () => {
  const ctx = setup({ cliproxy: null })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  const up = r.calls.find((c) => c.startsWith('docker compose'))
  assert.equal(
    up,
    `docker compose -f ${ctx.repo}/compose.yaml up -d --pull missing --no-recreate --no-deps cli-proxy-api`
  )
  assert.ok(r.calls.includes(`compose-cwd ${ctx.repo}`))
})

test('reuses a healthy router without starting it', () => {
  const ctx = setup({ router: null, routerCode: '200' })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.calls.some((c) => c.includes('router')))
  assert.ok(!r.calls.some((c) => c.startsWith('node')))
})

test('starts a stopped router container in container mode', () => {
  const ctx = setup({ router: 'exited', routerCode: null })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes('docker start claude-proxy-router'))
})

test('creates a missing router container with compose --no-deps', () => {
  const ctx = setup({ router: null, routerCode: null })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.some((c) => c.endsWith('up -d --pull missing --no-recreate --no-deps router')))
})

test('explains how to fix a missing CLIProxyAPI compose project', () => {
  const ctx = setup({ router: null, routerCode: null })
  const r = run(ctx, [], { CLIPROXY_DIR: join(ctx.base, 'missing') })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /CLIProxyAPI compose project not found/)
  assert.match(r.stderr, /CLIPROXY_DIR/)
  assert.ok(!r.calls.some((c) => c.startsWith('docker compose')))
})

test('fails when the router never becomes healthy', () => {
  const ctx = setup({ router: 'running', routerCode: '503' })
  const r = run(ctx, [], { CLAUDE_PROXY_READY_TIMEOUT: '1' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /router did not become healthy/)
  assert.equal(r.claudeOut, null)
})

test('clears GPT leftovers, sets the base URL and passes args through', () => {
  const ctx = setup()
  const r = run(ctx, ['-p', 'hello world', '--model', 'opus'], {
    ANTHROPIC_AUTH_TOKEN: 'fake-token',
    ANTHROPIC_MODEL: 'gpt-fake',
    ANTHROPIC_SMALL_FAST_MODEL: 'gpt-fake',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-fake',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-fake',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gpt-fake',
    ANTHROPIC_BASE_URL: 'http://elsewhere:9999',
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000',
  })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.claudeOut, [
    'ANTHROPIC_BASE_URL=http://127.0.0.1:3456',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    'ANTHROPIC_AUTH_TOKEN=unset',
    'ANTHROPIC_MODEL=unset',
    'ANTHROPIC_SMALL_FAST_MODEL=unset',
    'ANTHROPIC_DEFAULT_OPUS_MODEL=unset',
    'ANTHROPIC_DEFAULT_SONNET_MODEL=unset',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL=unset',
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS=unset',
    'arg:-p',
    'arg:hello world',
    'arg:--model',
    'arg:opus',
  ])
})

test('runs claude with no arguments', () => {
  const ctx = setup()
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.claudeOut.some((line) => line.startsWith('arg:')))
})

test('local mode starts node in the background and replaces a stale pid file', () => {
  const ctx = setup({ router: null, routerCode: null })
  writeFileSync(join(ctx.repo, 'proxy.pid'), '999999\n')
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', STUB_NODE_HEALTHY: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes(`node ${ctx.repo}/src/index.js`))
  const pid = Number(readFileSync(join(ctx.repo, 'proxy.pid'), 'utf-8'))
  assert.notEqual(pid, 999999)
  const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8' }).stdout
  assert.match(command, /src\/index\.js/)
  assert.ok(existsSync(join(ctx.repo, 'proxy.log')))
  assert.ok(!r.calls.some((c) => c.includes('router')))
})

test('local mode refuses to start a second router process', async () => {
  const ctx = setup({ router: null, routerCode: null })
  const child = spawn(join(ctx.base, 'stubs', 'node'), [join(ctx.repo, 'src', 'index.js')], {
    env: { PATH: '/usr/bin:/bin', STUB_DIR: ctx.state },
    stdio: 'ignore',
    detached: true,
  })
  spawnedPids.push(child.pid)
  writeFileSync(join(ctx.repo, 'proxy.pid'), `${child.pid}\n`)
  await new Promise((resolve) => setTimeout(resolve, 200))
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, new RegExp(`local router process ${child.pid} is running`))
  assert.equal(r.calls.filter((c) => c.startsWith('node')).length, 1)
})

function spawnStubNode(ctx, scriptPath) {
  const child = spawn(join(ctx.base, 'stubs', 'node'), [scriptPath], {
    env: { PATH: '/usr/bin:/bin', STUB_DIR: ctx.state },
    stdio: 'ignore',
    detached: true,
  })
  spawnedPids.push(child.pid)
  return child.pid
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('local mode starts the router in its own session and process group', () => {
  const ctx = setup({ router: null, routerCode: null })
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', STUB_NODE_HEALTHY: '1' })
  assert.equal(r.status, 0, r.stderr)
  const pid = Number(readFileSync(join(ctx.repo, 'proxy.pid'), 'utf-8'))
  const pgid = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf-8' }).stdout.trim())
  assert.equal(pgid, pid)
})

test('local mode ignores a live pid that is not this repo router', async () => {
  const ctx = setup({ router: null, routerCode: null })
  const foreign = spawnStubNode(ctx, join(ctx.base, 'other', 'src', 'index.js'))
  writeFileSync(join(ctx.repo, 'proxy.pid'), `${foreign}\n`)
  await sleep(200)
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', STUB_NODE_HEALTHY: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes(`node ${ctx.repo}/src/index.js`))
})

test('local mode removes a stale lock left by a dead launcher', () => {
  const ctx = setup({ router: null, routerCode: null })
  mkdirSync(join(ctx.repo, 'proxy.lock'))
  writeFileSync(join(ctx.repo, 'proxy.lock', 'pid'), '999999\n')
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', STUB_NODE_HEALTHY: '1' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /removing stale lock/)
  assert.ok(!existsSync(join(ctx.repo, 'proxy.lock')))
})

test('local mode waits for a lock held by a live launcher and then fails', () => {
  const ctx = setup({ router: null, routerCode: null })
  mkdirSync(join(ctx.repo, 'proxy.lock'))
  writeFileSync(join(ctx.repo, 'proxy.lock', 'pid'), `${process.pid}\n`)
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', CLAUDE_PROXY_READY_TIMEOUT: '1' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /could not acquire/)
  assert.ok(!r.calls.some((c) => c.startsWith('node')))
  assert.ok(existsSync(join(ctx.repo, 'proxy.lock')))
})

test('local mode fails fast when the router process exits during startup', () => {
  const ctx = setup({ router: null, routerCode: null })
  writeFileSync(join(ctx.base, 'stubs', 'node'), '#!/bin/sh\nexit 1\n')
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'local', CLAUDE_PROXY_READY_TIMEOUT: '30' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /exited during startup/)
  assert.ok(!existsSync(join(ctx.repo, 'proxy.lock')))
})

test('unpauses a paused cli-proxy-api container', () => {
  const ctx = setup({ cliproxy: 'paused' })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.calls.includes('docker unpause cli-proxy-api'))
})

test('fails with a clear message when CLIProxyAPI never answers', () => {
  const ctx = setup()
  rmSync(join(ctx.state, 'code_cliproxy'))
  const r = run(ctx, [], { CLAUDE_PROXY_READY_TIMEOUT: '1' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /CLIProxyAPI did not answer at http:\/\/127\.0\.0\.1:8317\/ within 1s/)
  assert.equal(r.claudeOut, null)
})

test('falls through to the health wait when compose up fails', () => {
  const ctx = setup({ router: null, routerCode: null })
  writeFileSync(join(ctx.state, 'compose_fail'), '')
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /docker compose up router failed/)
  assert.ok(r.claudeOut)
})

test('warns without printing values when CLIPROXY_KEY is unset', () => {
  const ctx = setup({ router: null, routerCode: null })
  const r = run(ctx)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /CLIPROXY_KEY is not set/)
  const withKey = setup({ router: null, routerCode: null })
  const r2 = run(withKey, [], { CLIPROXY_KEY: 'fake-key-value' })
  assert.doesNotMatch(r2.stderr, /CLIPROXY_KEY is not set|fake-key-value/)
})

test('rejects an unknown mode before touching Docker', () => {
  const ctx = setup()
  const r = run(ctx, [], { CLAUDE_PROXY_MODE: 'bogus' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown CLAUDE_PROXY_MODE 'bogus'/)
  assert.deepEqual(r.calls, [])
})

test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})
