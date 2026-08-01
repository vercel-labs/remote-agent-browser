# remote-agent-browser

Run [agent-browser](https://github.com/vercel-labs/agent-browser) in an isolated
[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox). Chromium and the CLI
come preinstalled, so there is no browser or Docker setup at runtime.

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
profiles, proxies, and init scripts:

```ts
const browser = await AgentBrowser.create({
  args: ['--color-scheme', 'dark', '--enable', 'react-devtools'],
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

### Convenience methods

- `browser.snapshot(url?)` optionally opens a page, then returns its interactive
  snapshot. Omit the URL to inspect the current page.
- `browser.screenshot(url?, { fullPage: true })` optionally opens a page, then
  returns a PNG buffer. Pass the options object first to capture the current page.
- `browser.close()` closes the session and stops the Sandbox.

All methods use the same disposable browser session until `close()` is called.

Container image and development details are in [docs.md](./docs.md).
