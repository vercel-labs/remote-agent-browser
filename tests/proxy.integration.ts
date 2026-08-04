import assert from 'node:assert/strict'
import test from 'node:test'

import { createBrowserClient } from '../dist/index.js'
import { provisionBrowserSandbox } from '../src/vercel.ts'
import { integrationEnabled } from './integration-helpers.ts'

const PROXY_URL = 'http://127.0.0.1:32123'
const PROXY_TARGET = 'http://proxy-target.invalid/through-proxy'
const PROXY_SERVER = `
const http = require('node:http')

http.createServer((request, response) => {
  if (request.url === '/health') {
    response.end('ok')
    return
  }

  console.log(request.method, request.url)
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>Proxy integration passed</title><h1>Traffic passed through proxy</h1>')
}).listen(32123, '127.0.0.1')
`

async function startProxy(runner) {
  await runner.writeFile('/tmp/proxy-server.cjs', Buffer.from(PROXY_SERVER))
  const started = await runner.run('sh', [
    '-c',
    'nohup node /tmp/proxy-server.cjs >/tmp/proxy-server.log 2>&1 </dev/null &',
  ])
  assert.equal(started.exitCode, 0, started.stderr)

  for (let attempt = 0; attempt < 20; attempt++) {
    const health = await runner.run(
      'node',
      [
        '-e',
        `fetch('${PROXY_URL}/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))`,
      ],
      { timeoutMs: 5_000 },
    )
    if (health.exitCode === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error('proxy server did not become ready')
}

test(
  'routes real Chromium traffic through the configured proxy',
  { skip: !integrationEnabled },
  async () => {
    const runner = await provisionBrowserSandbox({
      image: process.env.REMOTE_AGENT_BROWSER_IMAGE,
      timeoutMs: 5 * 60 * 1000,
    })
    let browser

    try {
      await startProxy(runner)
      browser = createBrowserClient(runner, {
        session: `proxy-integration-${Date.now()}`,
        proxy: PROXY_URL,
      })

      const run = await browser.run([
        ['open', PROXY_TARGET],
        ['get', 'title'],
        ['snapshot'],
      ])
      assert.equal(run.ok, true, run.results.map((r) => r.stderr).join('\n'))
      assert.equal(run.results[1].stdout.trim(), 'Proxy integration passed')
      assert.match(run.results[2].stdout, /Traffic passed through proxy/)

      const log = await runner.run('cat', ['/tmp/proxy-server.log'])
      assert.equal(log.exitCode, 0, log.stderr)
      assert.match(log.stdout, /GET http:\/\/proxy-target\.invalid\/through-proxy/)
    } finally {
      if (browser) await browser.close()
      else await runner.close()
    }
  },
)
