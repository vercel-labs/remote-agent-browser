# remote-agent-browser

Run [agent-browser](https://github.com/vercel-labs/agent-browser) in an isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox). Chromium and the CLI are built once into a Docker image, pushed to Vercel Container Registry (VCR), and used as the root filesystem for every browser Sandbox.

```ts
import { createRemoteBrowser } from 'remote-agent-browser'

const browser = await createRemoteBrowser()
try {
  const { results } = await browser.run([
    ['open', 'https://example.com'],
    ['snapshot', '-i', '--json'],
  ])
  console.log(results[1].stdout)
} finally {
  await browser.close()
}
```

## 1. Build and upload the image

VCR images are scoped to a Vercel project. Link this repository to the project and get a current registry credential:

```bash
vercel link
vercel env pull .env.local
set -a; source .env.local; set +a
printf '%s' "$VERCEL_OIDC_TOKEN" | docker login vcr.vercel.com \
  --username oidc --password-stdin
```

Then build and push `Dockerfile.sandbox`. Replace the team and project slugs and use an immutable version or commit tag in production:

```bash
docker buildx build \
  -f Dockerfile.sandbox \
  --platform linux/amd64,linux/arm64 \
  --output "type=image,name=vcr.vercel.com/<team>/<project>/remote-agent-browser:v1,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" \
  .
```

The default API image is `remote-agent-browser:latest` in the Sandbox project's registry. Either push that tag, set `REMOTE_AGENT_BROWSER_IMAGE`, or pass `image` explicitly:

```ts
const browser = await createRemoteBrowser({
  image: 'remote-agent-browser:v1',
})
```

A full VCR URL and an immutable digest also work:

```ts
await createRemoteBrowser({
  image: 'vcr.vercel.com/<team>/<project>/remote-agent-browser@sha256:<digest>',
})
```

VCR builds an optimized Sandbox image after a push. No npm, system-package, or browser installation happens while serving a request.

## 2. Install and authenticate

```bash
npm install remote-agent-browser @vercel/sandbox
```

`@vercel/sandbox` reads credentials from the environment. On Vercel this is normally `VERCEL_OIDC_TOKEN`; locally, use a linked project and `vercel env pull .env.local`.

## API

### `createRemoteBrowser(options?)`

Creates one non-persistent Sandbox from the uploaded image. Non-persistent is intentional: each browser is disposable and `close()` should not create billable filesystem snapshots.

| option | default | notes |
| --- | --- | --- |
| `image` | `REMOTE_AGENT_BROWSER_IMAGE` or `remote-agent-browser:latest` | VCR repository, tag, digest, or full URL |
| `session` | random | agent-browser session name |
| `timeoutMs` | 10 minutes | Sandbox wall-clock timeout |
| `vcpus` | `2` | 4 GB RAM; enough for one Chromium browser |
| `env` | — | Extra environment variables passed to Sandbox commands |
| `sandbox` | `@vercel/sandbox` | Injectable factory for tests or compatible providers |

### `browser.run(commands, options?)`

Runs arrays of agent-browser CLI arguments in order and in the same browser session. It stops at the first error unless `stopOnError: false`.

```ts
const run = await browser.run([
  ['open', 'https://my-preview.vercel.app'],
  ['wait', '--load', 'networkidle'],
  ['snapshot', '-i', '--json'],
  ['click', '@e3'],
])

// { session, ok, results: [{ args, ok, exitCode, stdout, stderr, file? }] }
```

### `browser.exec(command, options?)`

Runs one command. `flags` are converted from camelCase to CLI flags; `true` becomes a bare flag and arrays become repeated flags.

```ts
await browser.exec('find', {
  args: ['role', 'button', 'click'],
  flags: { name: 'Submit' },
})
```

### Convenience methods

- `browser.snapshot(url)` opens a URL and returns its interactive JSON snapshot.
- `browser.screenshot(url, { fullPage: true })` returns `{ png: Buffer, result }`.
- File commands such as `screenshot`, `pdf`, `trace stop`, `profiler stop`, and `record stop` put downloaded bytes on `result.file` when no output path is supplied.
- `browser.close()` closes the agent-browser session and stops the Sandbox. It is idempotent.

## Bring your own runner

`createBrowserClient(runner)` provides the same session-oriented API over anything implementing `CommandRunner`. `provisionBrowserSandbox()` accepts an injected `SandboxFactory` for unit tests.

## Optional hosted HTTP service

The older HTTP-service form remains available in [Dockerfile.vercel](./Dockerfile.vercel) and [server.mjs](./server.mjs). It is separate from the recommended library flow above: that container receives HTTP requests itself, while `Dockerfile.sandbox` is an image used to create a fresh isolated Sandbox per browser.

## Tests

```bash
npm run typecheck
npm run test:unit
npm test
```

The full test command also builds and runs the optional HTTP service with local Docker.
