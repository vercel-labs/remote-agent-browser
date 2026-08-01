import { randomUUID } from 'node:crypto'
import type {
  BrowserCommandResult,
  BrowserRunResult,
  BrowserClientOptions,
  CommandRunner,
  ExecOptions,
  AgentBrowser,
  RunOptions,
} from './types.js'

type FileSpec = { ext: string; contentType: string }

const FLAGS_WITH_VALUE = new Set([
  '--screenshot-dir',
  '--screenshot-quality',
  '--screenshot-format',
  '--format',
  '--width',
  '--height',
  '--margin',
  '--scale',
])

const SESSION_NAME = /^[\w.-]{1,64}$/
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000

function safeFilename(name: string): string {
  const filename = name.split(/[\\/]/).at(-1)?.replace(/[^\w.-]/g, '-')
  return filename || 'file'
}

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

function withSession(
  session: string,
  globalArgs: string[],
  args: string[],
): string[] {
  return ['--session', session, ...globalArgs, ...args]
}

function positionalArgs(args: string[]): string[] {
  const positionals: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith('-')) {
      positionals.push(arg)
    } else if (!arg.includes('=') && FLAGS_WITH_VALUE.has(arg)) {
      index++
    }
  }
  return positionals
}

function flagValue(args: string[], flag: string): string | undefined {
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`))
  if (prefixed) return prefixed.slice(flag.length + 1)
  const index = args.lastIndexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function outputSpec(args: string[]): FileSpec | undefined {
  const [command, ...rest] = args
  const positionals = positionalArgs(rest)
  if (command === 'screenshot' && positionals.length === 0) {
    const format = flagValue(rest, '--screenshot-format')?.toLowerCase()
    return format === 'jpeg'
      ? { ext: 'jpeg', contentType: 'image/jpeg' }
      : { ext: 'png', contentType: 'image/png' }
  }
  if (command === 'pdf' && positionals.length === 0) {
    return { ext: 'pdf', contentType: 'application/pdf' }
  }
  if (
    (command === 'trace' || command === 'profiler') &&
    positionals.length === 1 &&
    positionals[0] === 'stop'
  ) {
    return { ext: 'json', contentType: 'application/json' }
  }
  if (
    command === 'network' &&
    positionals.length === 2 &&
    positionals[0] === 'har' &&
    positionals[1] === 'stop'
  ) {
    return { ext: 'har', contentType: 'application/json' }
  }
  if (
    command === 'state' &&
    positionals.length === 1 &&
    positionals[0] === 'save'
  ) {
    return { ext: 'json', contentType: 'application/json' }
  }
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
  opts: BrowserClientOptions = {},
): AgentBrowser {
  const session = opts.session ?? `session-${randomUUID()}`
  if (!SESSION_NAME.test(session)) {
    throw new Error(`session must match [A-Za-z0-9_.-]{1,64}, got "${session}"`)
  }
  const globalArgs = [...(opts.globalArgs ?? [])]
  const ownsRunner = opts.ownsRunner ?? true
  const recordings = new Map<string, { path: string; spec: FileSpec }>()
  let closed = false

  function assertOpen() {
    if (closed) throw new Error('AgentBrowser is closed')
  }

  async function execCommand(
    args: string[],
    timeoutMs?: number,
    useSession = session,
  ): Promise<BrowserCommandResult> {
    const [name, ...rest] = args
    // File-producing commands get a temporary remote output path when the
    // caller did not provide one. The bytes are pulled back after completion.
    let fileSpec = outputSpec(args)
    const recordAction = name === 'record' ? positionalArgs(rest) : []
    const startsRecording =
      recordAction.length === 1 &&
      (recordAction[0] === 'start' || recordAction[0] === 'restart')
    const stopsRecording =
      recordAction.length === 1 && recordAction[0] === 'stop'

    let finalArgs = withSession(useSession, globalArgs, args)
    let remotePath: string | undefined
    if (fileSpec) {
      remotePath = `/tmp/agent-browser-${randomUUID()}.${fileSpec.ext}`
      finalArgs = withSession(useSession, globalArgs, [
        name!,
        ...rest,
        remotePath,
      ])
    } else if (startsRecording) {
      fileSpec = { ext: 'webm', contentType: 'video/webm' }
      remotePath = `/tmp/agent-browser-${randomUUID()}.webm`
      finalArgs = withSession(useSession, globalArgs, [
        name!,
        recordAction[0]!,
        remotePath,
      ])
    } else if (stopsRecording) {
      const recording = recordings.get(useSession)
      remotePath = recording?.path
      fileSpec = recording?.spec
    }

    const run = await runner.run('agent-browser', finalArgs, { timeoutMs })
    const result: BrowserCommandResult = {
      args,
      ok: run.exitCode === 0,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
    }
    if (result.ok && startsRecording && remotePath && fileSpec) {
      recordings.set(useSession, { path: remotePath, spec: fileSpec })
    } else if (result.ok && remotePath && fileSpec) {
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
    if (stopsRecording) recordings.delete(useSession)
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

    async upload(selector, files, execOpts = {}) {
      assertOpen()
      if (files.length === 0) throw new Error('upload requires at least one file')
      const remotePaths: string[] = []
      for (const file of files) {
        const remotePath = `/tmp/agent-browser-${randomUUID()}-${safeFilename(file.name)}`
        await runner.writeFile(remotePath, file.bytes)
        remotePaths.push(remotePath)
      }
      return this.exec('upload', {
        ...execOpts,
        args: [selector, ...remotePaths],
      })
    },

    async download(selector, execOpts = {}) {
      assertOpen()
      const remotePath = `/tmp/agent-browser-${randomUUID()}-${safeFilename(
        execOpts.filename ?? 'download',
      )}`
      const result = await this.exec('download', {
        session: execOpts.session,
        timeoutMs: execOpts.timeoutMs,
        args: [selector, remotePath],
      })
      if (!result.ok) throw new Error(`download failed: ${result.stderr || result.stdout}`)
      try {
        result.file = {
          path: remotePath,
          bytes: await runner.readFile(remotePath),
          contentType: 'application/octet-stream',
        }
      } catch (error) {
        throw new Error(
          `download succeeded but ${remotePath} could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      return { file: result.file, result }
    },

    async snapshot(urlOrOptions, opts = {}) {
      const url = typeof urlOrOptions === 'string' ? urlOrOptions : undefined
      const runOpts = typeof urlOrOptions === 'string' ? opts : (urlOrOptions ?? {})
      const commands = url ? [['open', url]] : []
      commands.push(['snapshot', '-i', '--json'])
      return this.run(commands, runOpts)
    },

    async screenshot(urlOrOptions, opts = {}) {
      const url = typeof urlOrOptions === 'string' ? urlOrOptions : undefined
      const runOpts = typeof urlOrOptions === 'string' ? opts : (urlOrOptions ?? {})
      const shotArgs = ['screenshot']
      if (runOpts.fullPage) shotArgs.push('--full')
      const commands = url ? [['open', url]] : []
      commands.push(shotArgs)
      const run = await this.run(commands, runOpts)
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
        .run('agent-browser', withSession(session, globalArgs, ['close']), {
          timeoutMs: 15_000,
        })
        .catch(() => {})
      if (ownsRunner) await runner.close()
    },
  }
}

export { DEFAULT_COMMAND_TIMEOUT_MS }
