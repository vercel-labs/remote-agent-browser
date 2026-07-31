// Public library surface: create a remote browser in a Vercel Sandbox and
// drive it with the agent-browser CLI.
export { createRemoteBrowser, type CreateRemoteBrowserOptions } from './create.js'
export { createBrowserClient } from './browser.js'
export {
  provisionBrowserSandbox,
  DEFAULT_BROWSER_IMAGE,
  SandboxRunner,
  type SandboxFactory,
  type SandboxLike,
  type SandboxCommandLike,
} from './vercel.js'
export type {
  BrowserCommandResult,
  BrowserRunResult,
  CommandRunner,
  ExecOptions,
  RemoteBrowser,
  RunOptions,
} from './types.js'
