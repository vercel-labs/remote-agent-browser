import { randomUUID } from 'node:crypto'
import type {
  BrowserCommandResult,
  BrowserRunResult,
  CommandRunner,
  ExecOptions,
  RemoteBrowser,
  RunOptions,
} from './types.js'

/** Commands whose output is a file we pull back as bytes. */
const FILE_OUTPUT: Record<
  string,
  { subcommand: string | null; ext: string; contentType: string }
> = {
  screenshot: { subcommand: null, ext: 'png', contentType: 'image/png' },
  pdf: { subcommand: null, ext: 'pdf', contentType: 'application/pdf' },
  trace: { subcommand: 'stop', ext: 'json', contentType: 'application/json' },
  profiler: { subcommand: 'stop', ext: 'json', contentType: 'application/json' },
  record: { subcommand: 'stop', ext: 'webm', contentType: 'video/webm' },
}

const SESSION_NAME = /^[\w.-]{1,64}$/
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

/** { json: true, fullPage: true, depth: 2 } → ["--json", "--full-page", "--depth", "2"] */
export function flagsToArgs(flags: Record<string, unknown>): string[] {
  const args: string[] = []
  for (const [key, value] of Object.entries(flags)) {
    if (value === false || value === null || value === undefined) continue
    const flag = `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item === false || item === null || item === undefined) continue
      args.push(flag)
      if (item !== true) args.push(String(item))
    }
  }
  return args
}

function withSession(session: string, args: string[]): string[] {
  return ['--session', session, ...args]
}

/**
 * Create a session-oriented browser client over any CommandRunner.
 *
 * Every command runs as `agent-browser --session <name> <args...>` so the
 * remote daemon keeps page state (refs, cookies, tabs) across calls. Pass an
 * explicit session name to share state across clients, or let it default to
 * an ephemeral per-client session that is closed on `close()`.
 */
export function createBrowserClient(
  runner: CommandRunner,
  opts: { session?: string; ownsRunner?: boolean } = {},
): RemoteBrowser {
  const session = opts.session ?? `session-${randomUUID()}`
  if (!SESSION_NAME.test(session)) {
    throw new Error(`session must match [A-Za-z0-9_.-]{1,64}, got "${session}"`)
  }
  const ownsRunner = opts.ownsRunner ?? true
  let closed = false

  function assertOpen() {
    if (closed) throw new Error('RemoteBrowser is closed')
  }

  async function execCommand(
    args: string[],
    timeoutMs?: number,
    useSession = session,
  ): Promise<BrowserCommandResult> {
    const [name, ...rest] = args
    // File-producing commands: inject a remote path and pull the bytes back,
    // unless the caller already supplied an output path themselves.
    const fileSpec = name ? FILE_OUTPUT[name] : undefined
    const positionals = rest.filter((a) => !a.startsWith('-'))
    const wantsFile =
      fileSpec &&
      (fileSpec.subcommand === null
        ? positionals.length === 0
        : positionals.length === 1 && positionals[0] === fileSpec.subcommand)

    let finalArgs = withSession(useSession, args)
    let remotePath: string | undefined
    if (wantsFile) {
      remotePath = `/tmp/agent-browser-${randomUUID()}.${fileSpec.ext}`
      // screenshot <path> is the first positional for these commands
      finalArgs = withSession(useSession, [name!, ...rest, remotePath])
    }

    const run = await runner.run('agent-browser', finalArgs, { timeoutMs })
    const result: BrowserCommandResult = {
      args,
      ok: run.exitCode === 0,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
    }
    if (result.ok && remotePath && fileSpec) {
      try {
        result.file = {
          path: remotePath,
          bytes: await runner.readFile(remotePath),
          contentType: fileSpec.contentType,
        }
      } catch (error) {
        result.ok = false
        result.stderr += `\ncommand succeeded but ${remotePath} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    }
    return result
  }

  return {
    session,

    async run(commands, runOpts = {}) {
      assertOpen()
      const useSession = runOpts.session ?? session
      if (!SESSION_NAME.test(useSession)) {
        throw new Error(`session must match [A-Za-z0-9_.-]{1,64}, got "${useSession}"`)
      }
      const stopOnError = runOpts.stopOnError ?? true
      const results: BrowserCommandResult[] = []
      // Run each command inside the same CLI session so state carries over.
      for (const command of commands) {
        if (command.length === 0) {
          results.push({
            args: [],
            ok: false,
            exitCode: null,
            stdout: '',
            stderr: 'empty command',
          })
          if (stopOnError) break
          continue
        }
        const result = await execCommand(command, runOpts.timeoutMs, useSession)
        results.push(result)
        if (!result.ok && stopOnError) break
      }
      return {
        session: useSession,
        results,
        ok: results.every((r) => r.ok),
      }
    },

    async exec(command, execOpts = {}) {
      assertOpen()
      const args = [
        command,
        ...(execOpts.args ?? []),
        ...(execOpts.flags ? flagsToArgs(execOpts.flags) : []),
      ]
      const useSession = execOpts.session ?? session
      if (!SESSION_NAME.test(useSession)) {
        throw new Error(`session must match [A-Za-z0-9_.-]{1,64}, got "${useSession}"`)
      }
      return execCommand(args, execOpts.timeoutMs, useSession)
    },

    async snapshot(url, runOpts = {}) {
      return this.run(
        [
          ['open', url],
          ['snapshot', '-i', '--json'],
        ],
        runOpts,
      )
    },

    async screenshot(url, runOpts = {}) {
      const shotArgs = ['screenshot']
      if (runOpts.fullPage) shotArgs.push('--full')
      const run = await this.run([['open', url], shotArgs], runOpts)
      const file = run.results.find((r) => r.file)?.file
      if (!file) {
        throw new Error(
          `screenshot failed: ${
            run.results.map((r) => r.stderr || r.stdout).join('\n') || 'no output'
          }`,
        )
      }
      return { png: file.bytes, result: run }
    },

    async close() {
      if (closed) return
      closed = true
      // Close the CLI session's browser first so the sandbox can stop cleanly.
      await runner
        .run('agent-browser', withSession(session, ['close']), {
          timeoutMs: 15_000,
        })
        .catch(() => {})
      if (ownsRunner) await runner.close()
    },
  }
}

export { DEFAULT_COMMAND_TIMEOUT_MS }
