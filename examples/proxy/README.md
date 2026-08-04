# Route traffic through a proxy

This example configures one proxy for the browser's lifetime and verifies the
route using `https://httpbin.org/ip`. The returned address should be the proxy's
egress address rather than the Sandbox address.

A useful production setup is a region-specific proxy for localized content or
geo-targeted testing. Replace the fixed URL in [`index.mjs`](./index.mjs) with
the endpoint supplied by your proxy provider; providers commonly select the
region through the hostname, username, or session credentials.

The `bypass` list keeps local and internal traffic direct. Remove it if every
destination should use the proxy, or adjust the patterns for your network.

After completing the authentication setup in the [project README](../../README.md#authentication),
run:

```bash
node --env-file=.env.local examples/proxy/index.mjs
```

The proxy is fixed when `AgentBrowser.create()` runs and applies to every page
in that client. Create separate browser clients when different tasks need
different regions or proxy identities.

Do not commit real proxy credentials. See [`index.mjs`](./index.mjs) for the
complete setup.
