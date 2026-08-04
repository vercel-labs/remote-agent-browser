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

The script pulls a fresh project-scoped `VERCEL_OIDC_TOKEN` into a temporary
file, logs Docker in to VCR, and builds and pushes both supported Linux
architectures. VCR then optimizes the image for Vercel Sandbox.

Tag pushes run this automatically before publishing npm. The repository needs
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` GitHub Actions secrets
for the `remote-agent-browser` Vercel project. A release such as `v1.2.0`
publishes both `remote-agent-browser:v1.2.0` and
`remote-agent-browser:latest` from the same multi-platform build.

VCR repositories are project-scoped. To publish the image into another Vercel
project, link that project (or provide its org and project ids) and override
the destination:

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
