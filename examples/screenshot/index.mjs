import { writeFile } from 'node:fs/promises'
import { AgentBrowser } from 'remote-agent-browser'

const url = process.argv[2] ?? 'https://example.com'
const outputPath = process.argv[3] ?? 'screenshot.png'
const browser = await AgentBrowser.create()

try {
  const { png } = await browser.screenshot(url, { fullPage: true })
  await writeFile(outputPath, png)
  console.log(`Saved ${url} to ${outputPath}`)
} finally {
  await browser.close()
}
