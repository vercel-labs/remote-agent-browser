// Real integration coverage. This creates a billable Vercel Sandbox from the
// published browser image, launches Chromium, and exercises the public API.
//
//   RUN_INTEGRATION=1 node --run test:integration
//
// Auth is provided by @vercel/sandbox (for local runs, link the project and
// refresh .env.local with `vercel env pull`).
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { AgentBrowser } from 'remote-agent-browser'

const enabled = process.env.RUN_INTEGRATION === '1'
const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html>
  <head><title>Agent Browser Test</title></head>
  <body>
    <h1>Remote Chromium</h1>
    <button id="action" onclick="document.title='clicked'">Run action</button>
  </body>
</html>`)}`

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
})
