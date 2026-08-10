# remote-agent-browser

Run [agent-browser](https://github.com/vercel-labs/agent-browser) in the cloud
with an isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox).

## Benchmark

Loading and taking an interactive snapshot of 100 HTTPS pages in a fresh,
two-vCPU Vercel Sandbox:

| Metric | Result |
| --- | ---: |
| Execution time (100 pages) | 8.01s |
| Memory (peak, 100 pages) | 461.6MB PSS |

Execution time includes Sandbox creation. The published time is the median and
memory is the maximum from three successful runs using Chromium 151,
agent-browser 0.33.2, and `https://example.com/` with a unique query per page.
Each page must produce the expected content and interactive snapshot references.

See [the benchmark methodology](./benchmarks/BENCHMARK.md) for details.

## Install

```bash
pnpm add remote-agent-browser
```

## Use

`AgentBrowser.create()` starts a fresh Vercel Sandbox from the prebuilt browser
image. Commands in one client share the same page, cookies, tabs, and element
references. `close()` closes Chromium and stops the Sandbox.

## Examples

- [Capture a screenshot](./examples/screenshot/README.md) — capture a full-page
  PNG and save it locally.
- [Agent Bash tool integration](./examples/agent-bash-tool/README.md) — let an
  agent use normal `agent-browser <command>` invocations through its Bash tool.
- [Bypass BotID for trusted automation](./examples/botid-bypass/README.md) —
  pass a Vercel automation bypass token as an origin-scoped header.
- [Route traffic through a proxy](./examples/proxy/README.md) — configure an
  authenticated proxy and verify the browser's egress address.

## Authentication

Authentication is automatic when running on Vercel through
`VERCEL_OIDC_TOKEN`.

For local development, link a Vercel project and pull its environment:

```bash
vercel link
vercel env pull .env.local
node --env-file=.env.local examples/screenshot/index.mjs
```

## API

### `AgentBrowser.create()`

Starts a fresh browser in a disposable Vercel Sandbox. Always call
`browser.close()` when finished.

Pass agent-browser global options with `args`. They are placed before
every command, which is required for launch settings such as color scheme,
profiles, and init scripts:

```ts
const browser = await AgentBrowser.create({
  args: ['--color-scheme', 'dark', '--enable', 'react-devtools'],
})
```

### Proxy

Set a proxy for the browser client's lifetime with `proxy`. Use the object form
to configure hosts that should connect directly:

```ts
const browser = await AgentBrowser.create({
  proxy: {
    url: 'http://user:password@proxy.example.com:8080',
    bypass: ['localhost', '*.internal.example.com'],
  },
})
```

For a proxy without bypass rules, pass its URL directly:

```ts
const browser = await AgentBrowser.create({
  proxy: 'http://proxy.example.com:8080',
})
```

### `browser.run(commands)`

Run several agent-browser commands in the same session:

```ts
const result = await browser.run([
  ['open', 'https://my-preview.vercel.app'],
  ['wait', '--load', 'networkidle'],
  ['snapshot', '-i', '--json'],
  ['click', '@e3'],
])
```

### `browser.exec(command, options?)`

Run one command with arguments and flags:

```ts
await browser.exec('find', {
  args: ['role', 'button', 'click'],
  flags: { name: 'Submit' },
})
```

### `browser.shell(command, options?)`

Use this when forwarding a Bash-tool command or composing `agent-browser` with
normal shell utilities. The command runs verbatim, so quoting, pipes,
redirection, and control operators keep their shell semantics. Prefer `exec()`
or `run()` for browser commands that do not need a shell. Every `agent-browser`
invocation inherits the client's CLI session through `AGENT_BROWSER_SESSION`.

```ts
const result = await browser.shell(
  'agent-browser read "https://example.com" | grep -io "example" | wc -l',
)
console.log(result.stdout)
```

Client-wide `args` are not inserted into a shell string because doing so would
require rewriting arbitrary shell syntax. Put global CLI arguments directly in
the command when using `shell()`.

### Typed JSON

Set `output: 'json'` for commands that support `--json`. `exec<T>()` adds the
flag, unwraps the CLI response envelope, and keeps the normal command fields
alongside the typed `data` value:

```ts
type UrlResult = { url: string }

const result = await browser.exec<UrlResult>('get', {
  args: ['url'],
  output: 'json',
})
console.log(result.data.url, result.ok)
```

### File transfer

Upload local buffers through a page's file input, or collect a browser download
without exposing the Sandbox filesystem:

```ts
await browser.upload('#avatar', [
  { name: 'avatar.png', bytes: await readFile('avatar.png') },
])

const { file } = await browser.download('#export', { filename: 'report.csv' })
await writeFile('report.csv', file.bytes)
```

When no output path is supplied, other file-producing commands collect their
artifact in `result.file`. This includes screenshots, PDFs, traces, profiles,
HAR files, saved browser state, and recordings:

```ts
await browser.exec('network', { args: ['har', 'start'] })
// ...interact with the page...
const result = await browser.exec('network', { args: ['har', 'stop'] })
await writeFile('capture.har', result.file.bytes)
```

When a command already contains an explicit remote output path, read it back
without changing the command:

```ts
await browser.shell(
  'agent-browser screenshot /tmp/verification.png',
)
const file = await browser.readFile('/tmp/verification.png', 'image/png')
await writeFile('verification.png', file.bytes)
```

### Convenience methods

- `browser.snapshot(url?)` optionally opens a page, then returns its interactive
  snapshot. Omit the URL to inspect the current page.
- `browser.screenshot(url?, { fullPage: true })` optionally opens a page, then
  returns a PNG buffer. Pass the options object first to capture the current page.
- `browser.close()` closes the session and stops the Sandbox.

All methods use the same disposable browser session until `close()` is called.

### Stable browser ids

Use `AgentBrowser.session()` when browser identity must survive process
boundaries. It returns a lazy handle: constructing it or starting keepalive
does not create a Sandbox. The first browser command finds or creates a runtime
derived from the caller-defined id, and another process using the same id finds
that runtime again.

```ts
const browser = AgentBrowser.session({ id: `environment:${chatId}` })
const stopKeepalive = browser.keepalive()
try {
  await browser.exec('open', { args: ['https://example.com'] })
} finally {
  stopKeepalive()
}
```

Ids are project-scoped. Include the deployment environment or another namespace
when the same application uses one Vercel project for multiple environments.
The underlying Sandbox name is private and derived from a hash of the id.

If an expired Sandbox resumes, its Chromium process starts fresh. Subscribe to
`reset` before running commands when the caller needs to surface that page,
cookies, refs, tabs, and console history were lost:

```ts
browser.on('reset', ({ reason }) => {
  console.log(`Browser runtime reset: ${reason}`)
})
```

`browser.destroy()` permanently removes the named runtime. Stopping keepalive
only allows its normal idle timeout to resume.

### Keepalive

Keep the Sandbox alive across idle gaps during long-running work. Always stop
the heartbeat in a `finally` block; after it stops, the Sandbox expires at its
normal timeout unless it is closed earlier:

```ts
const stopKeepalive = browser.keepalive()
try {
  await runLongAgentTurn(browser)
} finally {
  stopKeepalive()
}
```

By default, each heartbeat restores the wall-clock timeout configured by
`AgentBrowser.create()` and runs halfway through that window, capped at five
minutes. Override either value with `timeoutMs` and `intervalMs`. Renewal is
best-effort; pass `onError` to observe failures.

Container image and development details are in [docs.md](./docs.md).
