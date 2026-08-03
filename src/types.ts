/**
 * Shared types for remote-agent-browser.
 *
 * The library has two layers:
 *  - `AgentBrowser` (browser.ts): a thin, session-oriented client over the
 *    `agent-browser` CLI running somewhere that can execute commands.
 *  - `AgentBrowser.create()` (create.ts): provisions a Vercel Sandbox from a
 *    browser-ready image and returns an `AgentBrowser` backed by it.
 */

/** One agent-browser CLI invocation result. */
export type BrowserFile = { path: string; bytes: Buffer; contentType: string }

export type BrowserCommandResult<T = never> = {
  /** The CLI args that ran, e.g. ["snapshot", "-i", "--json"] */
  args: string[]
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  /** File bytes collected from the sandbox for file-producing commands. */
  file?: BrowserFile
} & ([T] extends [never] ? {} : { data: T })

/** A local file to make available to an upload command. */
export type BrowserUploadFile = { name: string; bytes: Buffer }

/** A batch of commands run sequentially in one session. */
export type BrowserRunResult = {
  session: string
  results: BrowserCommandResult[]
  ok: boolean
}

export type RunOptions = {
  /** Named session to reuse browser state across calls. Default: ephemeral. */
  session?: string
  /** Stop the batch at the first failing command. Default: true. */
  stopOnError?: boolean
  /** Per-command timeout in ms. */
  timeoutMs?: number
}

export type ScreenshotOptions = RunOptions & { fullPage?: boolean }

export type ExecOptions = {
  session?: string
  /** Positional CLI args, e.g. ["@e3"] for click. */
  args?: string[]
  /** Flags serialized to --kebab-case (true → bare flag, arrays → repeated). */
  flags?: Record<string, unknown>
  timeoutMs?: number
  /** Leave command output as text. This is the default. */
  output?: 'text'
}

export type JsonExecOptions = Omit<ExecOptions, 'output'> & { output: 'json' }

export type ProxyOptions =
  | string
  | {
      /** Proxy server URL, optionally including authentication. */
      url: string
      /** Host patterns that should connect directly instead of using the proxy. */
      bypass?: string | readonly string[]
    }

export type BrowserClientOptions = {
  session?: string
  /** agent-browser CLI arguments inserted before every command. */
  args?: string[]
  /** Proxy configuration fixed for this client's lifetime. */
  proxy?: ProxyOptions
  /** Whether close() also tears down the command runner. Default: true. */
  ownsRunner?: boolean
}

export type KeepaliveOptions = {
  /** Remaining sandbox lifetime to maintain. Defaults to its creation timeout. */
  timeoutMs?: number
  /** Heartbeat cadence. Defaults to half the timeout, capped at 5 minutes. */
  intervalMs?: number
  /** Optional observer for best-effort heartbeat failures. */
  onError?: (error: unknown) => void
}

/**
 * Minimal command executor the browser client needs. Implemented by the
 * Vercel Sandbox adapter; anything with the same shape can back a
 * AgentBrowser (tests, a local shell, another sandbox provider).
 */
export interface CommandRunner {
  /** Run a command, waiting for completion. */
  run(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>
  /** Read a file's bytes from the remote environment. */
  readFile(path: string): Promise<Buffer>
  /** Write file bytes into the remote environment. */
  writeFile(path: string, bytes: Buffer): Promise<void>
  /** Tear the remote environment down. */
  close(): Promise<void>
  /** Keep the remote environment alive until the returned stop function runs. */
  keepalive?(opts?: KeepaliveOptions): () => void
}

/** Session-oriented remote browser client. */
export interface AgentBrowser {
  /** The runner's session name this client uses by default. */
  readonly session: string
  /** Run a batch of agent-browser arg-arrays sequentially. */
  run(commands: string[][], opts?: RunOptions): Promise<BrowserRunResult>
  /** Run one command and unwrap its typed --json data payload. */
  exec<T>(
    command: string,
    opts: JsonExecOptions,
  ): Promise<BrowserCommandResult<T>>
  /** Run one agent-browser command with text output. */
  exec(command: string, opts?: ExecOptions): Promise<BrowserCommandResult>
  /** Upload one or more local buffers through a file input. */
  upload(
    selector: string,
    files: BrowserUploadFile[],
    opts?: Pick<ExecOptions, 'session' | 'timeoutMs'>,
  ): Promise<BrowserCommandResult>
  /** Download a file triggered by an element and return its bytes. */
  download(
    selector: string,
    opts?: Pick<ExecOptions, 'session' | 'timeoutMs'> & { filename?: string },
  ): Promise<{ file: BrowserFile; result: BrowserCommandResult }>
  /** Optionally open a URL, then return the interactive accessibility snapshot. */
  snapshot(
    urlOrOptions?: string | RunOptions,
    opts?: RunOptions,
  ): Promise<BrowserRunResult>
  /** Optionally open a URL, then return a PNG screenshot. */
  screenshot(
    urlOrOptions?: string | ScreenshotOptions,
    opts?: ScreenshotOptions,
  ): Promise<{ png: Buffer; result: BrowserRunResult }>
  /**
   * Keep the backing Sandbox alive across idle gaps. Call the returned stop
   * function in a finally block so the Sandbox can expire when work finishes.
   */
  keepalive(opts?: KeepaliveOptions): () => void
  /** Close the browser session (and the sandbox when it owns it). */
  close(): Promise<void>
}
