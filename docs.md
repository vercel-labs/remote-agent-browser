# Maintainer documentation

## Browser image

The browser Sandbox boots from `Dockerfile.sandbox`, which contains
agent-browser, Chromium, and their system dependencies. The image is stored in
the Vercel Container Registry project used by this package.

Install the Vercel CLI and Docker with Buildx, authenticate both CLIs, and link
this directory to the `remote-agent-browser` Vercel project once:

```bash
vercel link
```

Publish `latest`:

```bash
./scripts/publish-image.sh
```

Pass one or more tags to publish immutable and moving references in one build:

```bash
./scripts/publish-image.sh v1.2.0 latest
```

The script uses `VERCEL_OIDC_TOKEN` from the local environment when available.
Otherwise, it pulls a fresh project-scoped token through the authenticated,
linked Vercel CLI. It then logs Docker in to VCR and builds and pushes both
supported Linux architectures. VCR optimizes the image for Vercel Sandbox.

VCR repositories are project-scoped. To publish the image into another Vercel
project, link that project and override the destination:

```bash
REMOTE_AGENT_BROWSER_IMAGE_REPOSITORY="vcr.vercel.com/acme/my-project/remote-agent-browser" \
  ./scripts/publish-image.sh v1.2.0
```

Production consumers should pass the immutable tag or digest to
`AgentBrowser.create({ image })`; `latest` remains useful for development.

## Development

Install dependencies and run the local checks:

```bash
pnpm install
node --run typecheck
node --run test
```

The default suite uses a mocked `Sandbox.create()` and does not create billable
resources. To boot the published image and exercise real Chromium end to end:

```bash
vercel env pull .env.local
set -a; source .env.local; set +a
RUN_INTEGRATION=1 node --run test:integration
```
