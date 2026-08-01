// Public library surface: create an agent browser in a Vercel Sandbox and
// drive it with the agent-browser CLI.
import { createAgentBrowser } from './create.js'

export { createAgentBrowser, type CreateAgentBrowserOptions } from './create.js'
export { createBrowserClient } from './browser.js'

/** Create AgentBrowser clients backed by a fresh Vercel Sandbox. */
export const AgentBrowser = {
  create: createAgentBrowser,
}

export type AgentBrowser = import('./types.js').AgentBrowser

export type {
  BrowserCommandResult,
  BrowserClientOptions,
  BrowserRunResult,
  CommandRunner,
  ExecOptions,
  JsonExecOptions,
  RunOptions,
} from './types.js'
