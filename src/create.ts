import { createBrowserClient } from './browser.js'
import { provisionBrowserSandbox, type SandboxFactory } from './vercel.js'
import type { RemoteBrowser } from './types.js'

export type CreateRemoteBrowserOptions = {
  /** Named CLI session; state (page, cookies, refs) persists across calls. */
  session?: string
  /**
   * Vercel Container Registry image containing agent-browser + Chromium.
   * Default: REMOTE_AGENT_BROWSER_IMAGE or remote-agent-browser:latest.
   */
  image?: string
  /** Sandbox wall-clock timeout in ms. Default: 10 minutes. */
  timeoutMs?: number
  /** Sandbox vCPUs. Default: 2. */
  vcpus?: number
  /** Extra env vars for every command inside the sandbox. */
  env?: Record<string, string>
  /** Inject a custom Sandbox factory (testing, alternative providers). */
  sandbox?: SandboxFactory
}

/**
 * Create a remote browser running inside a fresh Vercel Sandbox.
 *
 * The sandbox boots from a browser-ready VCR image and the returned client
 * runs every command as
 * `agent-browser --session <name> …` so page state persists across calls.
 * `close()` closes the browser and stops the sandbox.
 *
 * Auth comes from the environment (VERCEL_OIDC_TOKEN on Vercel, or a local
 * `vercel login`), via @vercel/sandbox.
 *
 * ```ts
 * import { createRemoteBrowser } from 'remote-agent-browser'
 *
 * const browser = await createRemoteBrowser()
 * const { results } = await browser.run([
 *   ['open', 'https://example.com'],
 *   ['snapshot', '-i', '--json'],
 * ])
 * await browser.close()
 * ```
 */
export async function createRemoteBrowser(
  opts: CreateRemoteBrowserOptions = {},
): Promise<RemoteBrowser> {
  const runner = await provisionBrowserSandbox({
    sandbox: opts.sandbox,
    image: opts.image,
    timeoutMs: opts.timeoutMs,
    vcpus: opts.vcpus,
    env: opts.env,
  })
  return createBrowserClient(runner, { session: opts.session, ownsRunner: true })
}
