// Real integration coverage creates billable Vercel Sandboxes from the
// published browser image and launches Chromium.
//
//   RUN_INTEGRATION=1 node --run test:integration
//
// Auth is provided by @vercel/sandbox (for local runs, link the project and
// refresh .env.local with `vercel env pull`).
import { AgentBrowser } from '../dist/index.js'

export const integrationEnabled = process.env.RUN_INTEGRATION === '1'

export const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html>
  <head><title>Agent Browser Test</title></head>
  <body>
    <h1>Remote Chromium</h1>
    <button id="action" onclick="document.title='clicked'">Run action</button>
  </body>
</html>`)}`

export function createIntegrationBrowser(sessionPrefix) {
  return AgentBrowser.create({
    image: process.env.REMOTE_AGENT_BROWSER_IMAGE,
    session: `${sessionPrefix}-${Date.now()}`,
    timeoutMs: 5 * 60 * 1000,
  })
}
