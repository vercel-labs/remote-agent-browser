// Real integration coverage. This creates a billable Vercel Sandbox from the
// published browser image, launches Chromium, and exercises the public API.
//
//   RUN_INTEGRATION=1 node --run test:integration
//
// Auth is provided by @vercel/sandbox (for local runs, link the project and
// refresh .env.local with `vercel env pull`).
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { AgentBrowser, createBrowserClient } from '../dist/index.js'
import { provisionBrowserSandbox } from '../src/vercel.ts'

const enabled = process.env.RUN_INTEGRATION === '1'
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
const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html>
  <head><title>Agent Browser Test</title></head>
  <body>
    <h1>Remote Chromium</h1>
    <button id="action" onclick="document.title='clicked'">Run action</button>
  </body>
</html>`)}`

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

describe('Vercel Sandbox integration', { skip: !enabled }, () => {
  let browser

  before(async () => {
    browser = await AgentBrowser.create({
      image: process.env.REMOTE_AGENT_BROWSER_IMAGE,
      session: `integration-${Date.now()}`,
      timeoutMs: 5 * 60 * 1000,
    })
  })

  after(async () => {
    await browser?.close()
  })

  it('persists a real page across agent-browser commands', async () => {
    const run = await browser.run([
      ['open', PAGE],
      ['snapshot', '-i', '--json'],
      ['click', '#action'],
      ['get', 'title'],
    ])

    assert.equal(run.ok, true, run.results.map((r) => r.stderr).join('\n'))
    assert.equal(run.results.length, 4)

    const snapshot = JSON.parse(run.results[1].stdout)
    assert.equal(snapshot.success, true)
    assert.match(snapshot.data.snapshot, /Remote Chromium/)
    assert.match(snapshot.data.snapshot, /Run action/)
    assert.equal(run.results[3].stdout.trim(), 'clicked')
  })

  it('downloads a real Chromium screenshot', async () => {
    const { png, result } = await browser.screenshot(PAGE, { fullPage: true })

    assert.equal(result.ok, true)
    assert.ok(png.length > 1_000)
    assert.deepEqual(png.subarray(0, 8), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
  })

  it('routes real Chromium traffic through the configured proxy', async () => {
    const runner = await provisionBrowserSandbox({
      image: process.env.REMOTE_AGENT_BROWSER_IMAGE,
      timeoutMs: 5 * 60 * 1000,
    })
    let proxyBrowser

    try {
      await startProxy(runner)
      proxyBrowser = createBrowserClient(runner, {
        session: `proxy-integration-${Date.now()}`,
        proxy: PROXY_URL,
      })

      const run = await proxyBrowser.run([
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
      if (proxyBrowser) await proxyBrowser.close()
      else await runner.close()
    }
  })
})
