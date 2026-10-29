import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createIntegrationBrowser,
  integrationEnabled,
  PAGE,
} from './integration-helpers.ts'

// One character per script or symbol that pages commonly rely on system
// fonts for. Each one is drawn with the generic sans-serif family and compared
// with a Supplementary Private Use Area code point that no installed font
// covers, which Chromium draws as the missing-glyph (.notdef) box.
const GLYPH_SAMPLES: Record<string, string> = {
  arabic: '\u0639',
  hebrew: '\u05D0',
  thai: '\u0E01',
  devanagari: '\u0915',
  cyrillic: '\u04E8',
  mongolian: '\u182E',
  armenian: '\u0531',
  georgian: '\u10D0',
  ethiopic: '\u12A0',
  symbol: '\u2318',
  cjk: '\u6F22',
}

const GLYPH_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>pending</title></head>
  <body>
    <script>
      const samples = ${JSON.stringify(GLYPH_SAMPLES)}
      function draw(text) {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const context = canvas.getContext('2d')
        context.font = '40px sans-serif'
        context.textBaseline = 'middle'
        context.fillText(text, 8, 32)
        return context.getImageData(0, 0, 64, 64).data
      }
      function same(a, b) {
        return a.every((value, index) => value === b[index])
      }
      const notdef = draw('\\u{10FFFD}')
      const missing = Object.entries(samples)
        .filter(([, text]) => {
          const pixels = draw(text)
          return same(pixels, notdef) || pixels.every((value) => value === 0)
        })
        .map(([name]) => name)
      document.title = missing.length === 0 ? 'ok' : 'missing:' + missing.join(',')
    </script>
  </body>
</html>`)}`

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

test(
  'renders common scripts and symbols without missing-glyph boxes',
  { skip: !integrationEnabled },
  async () => {
    const browser = await createIntegrationBrowser('glyph-integration')

    try {
      const run = await browser.run([
        ['open', GLYPH_PAGE],
        ['get', 'title'],
      ])

      assert.equal(run.ok, true, run.results.map((r) => r.stderr).join('\n'))
      assert.equal(run.results[1]?.stdout.trim(), 'ok')
    } finally {
      await browser.close()
    }
  },
)
