import { AgentBrowser } from 'remote-agent-browser'

const browser = await AgentBrowser.create({
  proxy: {
    url: 'http://user:password@us.proxy.example.com:8080',
    bypass: ['localhost', '127.0.0.1', '*.internal.example.com'],
  },
})

try {
  const run = await browser.run([
    ['open', 'https://httpbin.org/ip'],
    ['get', 'text', 'body'],
  ])

  if (!run.ok) {
    const failure = run.results.find((result) => !result.ok)
    throw new Error(failure?.stderr || failure?.stdout || 'browser command failed')
  }

  console.log('Proxy egress:', run.results.at(-1).stdout.trim())
} finally {
  await browser.close()
}
