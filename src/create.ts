import { createBrowserClient } from './browser.js'
import {
  createNamedBrowserSandboxRunner,
  provisionBrowserSandbox,
} from './vercel.js'
import type {
  AgentBrowser,
  AgentBrowserSession,
  BrowserRuntimeResetEvent,
  ProxyOptions,
} from './types.js'

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

export type CreateAgentBrowserSessionOptions = CreateAgentBrowserOptions & {
  /** Stable logical identity used to find this browser across processes. */
  id: string
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

/**
 * Create a lazy browser handle with a stable logical id.
 *
 * The first operation finds or creates a named Vercel Sandbox. Later handles
 * created with the same id attach to that Sandbox, including from another
 * process. If an expired Sandbox resumes, listeners are told that its
 * in-memory page, refs, cookies, and console history were reset.
 */
export function createAgentBrowserSession(
  opts: CreateAgentBrowserSessionOptions,
): AgentBrowserSession {
  if (!opts.id.trim()) throw new Error('browser id must not be empty')

  const runner = createNamedBrowserSandboxRunner({
    id: opts.id,
    image: opts.image,
    timeoutMs: opts.timeoutMs,
    vcpus: opts.vcpus,
    env: opts.env,
  })
  const browser = createBrowserClient(runner, {
    session: opts.session ?? runner.session,
    args: opts.args,
    proxy: opts.proxy,
    closeSession: false,
    ownsRunner: true,
  })

  return {
    ...browser,
    id: opts.id,
    on(
      event: 'reset',
      listener: (event: BrowserRuntimeResetEvent) => void,
    ) {
      return runner.on(event, listener)
    },
    destroy() {
      return browser.close()
    },
  }
}
