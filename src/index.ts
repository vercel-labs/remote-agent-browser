// Public library surface: create an agent browser in a Vercel Sandbox and
// drive it with the agent-browser CLI.
import {
  createAgentBrowser,
  createAgentBrowserSession,
} from './create.js'

export {
  createAgentBrowser,
  createAgentBrowserSession,
  type CreateAgentBrowserOptions,
  type CreateAgentBrowserSessionOptions,
} from './create.js'
export { createBrowserClient } from './browser.js'

/** Create AgentBrowser clients backed by a fresh Vercel Sandbox. */
export const AgentBrowser = {
  create: createAgentBrowser,
  session: createAgentBrowserSession,
}

export type AgentBrowser = import('./types.js').AgentBrowser

export type {
  BrowserCommandResult,
  BrowserClientOptions,
  BrowserFile,
  BrowserRuntimeResetEvent,
  BrowserRunResult,
  BrowserShellResult,
  CommandRunner,
  ExecOptions,
  JsonExecOptions,
  KeepaliveOptions,
  ProxyOptions,
  RunOptions,
  AgentBrowserSession,
  ShellOptions,
} from './types.js'
