# Bypass BotID for trusted automation

This example opens a Vercel deployment with a Protection Bypass for Automation
token. The `x-vercel-protection-bypass` header lets trusted browser automation
bypass BotID and other supported Vercel protection checks without putting the
secret in the URL.

First, create a bypass secret in the project's **Settings → Deployment
Protection → Protection Bypass for Automation**. Store it in `.env.local`:

```bash
VERCEL_AUTOMATION_BYPASS_SECRET=your-generated-secret
```

After completing the authentication setup in the [project README](../../README.md#authentication),
run the example with your deployment URL:

```bash
node --env-file=.env.local examples/botid-bypass/index.mjs \
  https://your-deployment.vercel.app
```

The header passed to `open` is scoped by agent-browser to the deployment's
origin, so it is reused for same-origin page requests and is not sent when the
browser navigates to another site.

Use bypass tokens only for trusted automation, keep them out of source control,
and revoke them from the project settings when they are no longer needed. See
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
for configuration and limitations.

See [`index.mjs`](./index.mjs) for the complete example.
