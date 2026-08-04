import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createIntegrationBrowser,
  integrationEnabled,
  PAGE,
} from './integration-helpers.ts'

test(
  'downloads a real Chromium screenshot',
  { skip: !integrationEnabled },
  async () => {
    const browser = await createIntegrationBrowser('screenshot-integration')

    try {
      const { png, result } = await browser.screenshot(PAGE, { fullPage: true })

      assert.equal(result.ok, true)
      assert.ok(png.length > 1_000)
      assert.deepEqual(
        png.subarray(0, 8),
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      )
    } finally {
      await browser.close()
    }
  },
)
