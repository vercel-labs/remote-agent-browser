import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createIntegrationBrowser,
  integrationEnabled,
  PAGE,
} from './integration-helpers.ts'

test(
  'persists a real page across agent-browser commands',
  { skip: !integrationEnabled },
  async () => {
    const browser = await createIntegrationBrowser('session-integration')

    try {
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
    } finally {
      await browser.close()
    }
  },
)
