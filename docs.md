# Maintainer documentation

## Browser image

The browser Sandbox boots from `Dockerfile.sandbox`, which contains
agent-browser, Chromium, and their system dependencies. The image is stored in
the Vercel Container Registry project used by this package.

GitHub Actions publishes when `Dockerfile.sandbox`, `.dockerignore`,
`Dockerfile.sandbox.dockerignore`, or the image publishing workflow changes:

- Pushes to `main` (including merged PRs) publish `latest`.
- Same-repository PRs targeting `main` publish
  `pr-<number>-<head-sha>-<run-id>-<attempt>`, unique to each build attempt.
  Fork PRs skip publishing because they do not have the required OIDC access.

The publishing run summary includes the full image reference and digest. Test a
PR image in the same Vercel project with
`AgentBrowser.create({ image: 'remote-agent-browser:<pr-tag>' })`, or set
`REMOTE_AGENT_BROWSER_IMAGE=remote-agent-browser:<pr-tag>` when running the
integration tests below.

After publishing, the same workflow runs the proxy, screenshot, and browser
session integration tests in real Sandboxes, using the build's image digest.
This tests the exact image behind the PR tag (or `latest` on main). A test
failure fails the publishing job; the image has already been pushed at that
point. The default test workflow continues to run mocked tests independently.

Authentication uses `vercel/vcr-action/login@v1` and the GitHub repository
variable `VERCEL_TEAM_ID`. The Vercel team's OIDC policy must grant VCR read/write
access to this project and allow both GitHub subjects:

- `repo:vercel-labs/remote-agent-browser:pull_request`
- `repo:vercel-labs/remote-agent-browser:ref:refs/heads/main`

Sandbox tests also require a **Vercel CLI OIDC policy** for this repository and
workflow, allowing the same PR and main identities. The workflow uses
`vercel/authenticate-cli-action` to obtain a short-lived CLI token, then pulls
a fresh development `VERCEL_OIDC_TOKEN` for the project. Only the OIDC token is
loaded into the test environment; the temporary environment file is deleted
when the test step exits. Set the GitHub repository variable `VERCEL_PROJECT_ID`
to the `remote-agent-browser` project's ID. No long-lived Vercel token secret
is required.

To refresh upstream packages without a Dockerfile change, publish locally:

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
supported Linux architectures without a Docker build cache, ensuring that
`agent-browser@latest` is refreshed. VCR optimizes the image for Vercel Sandbox.

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
