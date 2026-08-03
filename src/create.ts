import { createBrowserClient } from './browser.js'
import { provisionBrowserSandbox } from './vercel.js'
import type { AgentBrowser, ProxyOptions } from './types.js'

export type CreateAgentBrowserOptions = {
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
  /** agent-browser CLI arguments inserted before every command. */
  args?: string[]
  /** Proxy configuration fixed for this browser's lifetime. */
  proxy?: ProxyOptions
}

/**
 * Create an agent-browser client running inside a fresh Vercel Sandbox.
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
 * import { AgentBrowser } from 'remote-agent-browser'
 *
 * const browser = await AgentBrowser.create()
 * const { results } = await browser.run([
 *   ['open', 'https://example.com'],
 *   ['snapshot', '-i', '--json'],
 * ])
 * await browser.close()
 * ```
 */
export async function createAgentBrowser(
  opts: CreateAgentBrowserOptions = {},
): Promise<AgentBrowser> {
  const runner = await provisionBrowserSandbox({
    image: opts.image,
    timeoutMs: opts.timeoutMs,
    vcpus: opts.vcpus,
    env: opts.env,
  })
  return createBrowserClient(runner, {
    session: opts.session,
    args: opts.args,
    proxy: opts.proxy,
    ownsRunner: true,
  })
}
