import { AgentBrowser } from 'remote-agent-browser'

const targetUrl = process.argv[2] ?? 'https://your-deployment.vercel.app'
const bypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

if (!bypassToken) {
  throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET is required')
}

const browser = await AgentBrowser.create()

try {
  const headers = JSON.stringify({
    'x-vercel-protection-bypass': bypassToken,
  })
  const run = await browser.run([
    ['open', targetUrl, '--headers', headers],
    ['snapshot', '-i'],
  ])

  if (!run.ok) {
    const failure = run.results.find((result) => !result.ok)
    throw new Error(failure?.stderr || failure?.stdout || 'browser command failed')
  }

  console.log(run.results.at(-1).stdout)
} finally {
  await browser.close()
}
