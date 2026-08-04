import { createHash } from 'node:crypto'
import { Sandbox } from '@vercel/sandbox'
import type {
  BrowserRuntimeResetEvent,
  CommandRunner,
  KeepaliveOptions,
} from './types.js'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_BROWSER_IMAGE = 'remote-agent-browser:latest'

const BASE_ENV = {
  AGENT_BROWSER_ARGS: '--no-sandbox,--disable-dev-shm-usage,--disable-gpu',
  AGENT_BROWSER_DEFAULT_TIMEOUT: '25000',
}

/** CommandRunner backed by one Vercel Sandbox. */
export class SandboxRunner implements CommandRunner {
  protected sandbox: Sandbox | undefined
  protected env: Record<string, string>
  protected timeoutMs: number
  private keepaliveStops = new Set<() => void>()

  constructor(
    sandbox: Sandbox | undefined,
    env: Record<string, string>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.sandbox = sandbox
    this.env = env
    this.timeoutMs = timeoutMs
  }

  protected async acquire(): Promise<Sandbox> {
    if (!this.sandbox) throw new Error('browser sandbox is unavailable')
    return this.sandbox
  }

  protected async observe(): Promise<Sandbox | null> {
    if (!this.sandbox) return null
    const sandbox = await Sandbox.get({
      name: this.sandbox.name,
      resume: false,
    })
    this.sandbox = sandbox
    return sandbox
  }

  protected async destroyRuntime(): Promise<void> {
    await this.sandbox?.stop().catch(() => {})
  }

  async run(
    cmd: string,
    args: string[],
    opts: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const timeoutMs = opts.timeoutMs ?? 60_000
    const sandbox = await this.acquire()
    const command = await sandbox.runCommand({
      cmd,
      args,
      env: { ...this.env, ...opts.env },
      detached: true,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`command timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      if (typeof timer.unref === 'function') timer.unref()
    })
    try {
      const finished = (await Promise.race([
        command.wait(),
        timeout,
      ])) as { exitCode: number } | number
      const exitCode = typeof finished === 'number' ? finished : finished.exitCode
      const [stdout, stderr] = await Promise.all([
        command.output('stdout'),
        command.output('stderr'),
      ])
      return { stdout, stderr, exitCode }
    } catch (error) {
      await command.kill().catch(() => {})
      throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async readFile(path: string): Promise<Buffer> {
    const { stdout, exitCode, stderr } = await this.run('base64', ['-w0', path], {
      timeoutMs: 30_000,
    })
    if (exitCode !== 0) {
      throw new Error(`failed to read ${path}: ${stderr.trim()}`)
    }
    return Buffer.from(stdout.trim(), 'base64')
  }

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    const sandbox = await this.acquire()
    await sandbox.writeFiles([{ path, content: bytes }])
  }

  /** Restore a sliding idle window without cumulatively adding that window. */
  private async renewLifetime(timeoutMs: number): Promise<void> {
    // Poll without resuming: a late heartbeat must not resurrect an already
    // expired Sandbox whose in-memory browser state is gone.
    const sandbox = await this.observe()
    if (!sandbox || sandbox.status !== 'running') return
    const targetExpiresAt = Date.now() + timeoutMs
    const currentExpiresAt = sandbox.expiresAt?.getTime()
    const extensionMs =
      currentExpiresAt === undefined
        ? timeoutMs
        : Math.ceil(targetExpiresAt - currentExpiresAt)
    if (extensionMs > 0) await sandbox.extendTimeout(extensionMs)
  }

  keepalive(opts: KeepaliveOptions = {}): () => void {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs
    const intervalMs =
      opts.intervalMs ?? Math.min(5 * 60 * 1000, Math.floor(timeoutMs / 2))
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('keepalive timeoutMs must be greater than 0')
    }
    if (
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0 ||
      intervalMs >= timeoutMs
    ) {
      throw new RangeError(
        'keepalive intervalMs must be greater than 0 and less than timeoutMs',
      )
    }

    let stopped = false
    let renewing = false
    const tick = async () => {
      if (stopped || renewing) return
      renewing = true
      try {
        await this.renewLifetime(timeoutMs)
      } catch (error) {
        opts.onError?.(error)
      } finally {
        renewing = false
      }
    }
    const timer = setInterval(() => void tick(), intervalMs)
    timer.unref?.()
    void tick()

    const stop = () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      this.keepaliveStops.delete(stop)
    }
    this.keepaliveStops.add(stop)
    return stop
  }

  async close(): Promise<void> {
    for (const stop of [...this.keepaliveStops]) stop()
    await this.destroyRuntime()
  }
}

type NamedBrowserSandboxOptions = {
  id: string
  image?: string
  timeoutMs?: number
  vcpus?: number
  env?: Record<string, string>
}

function stableNames(id: string): { sandbox: string; session: string } {
  const hash = createHash('sha256').update(id).digest('hex')
  return {
    sandbox: `remote-browser-${hash.slice(0, 32)}`,
    session: `session-${hash.slice(0, 32)}`,
  }
}

function isMissingSandbox(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { json?: { error?: { code?: string } } }).json
    ?.error?.code
  return code === 'not_found' || error.message.includes('Status code 404')
}

class NamedSandboxRunner extends SandboxRunner {
  readonly session: string
  private readonly id: string
  private readonly name: string
  private readonly image: string
  private readonly vcpus: number
  private readonly resetListeners = new Set<
    (event: BrowserRuntimeResetEvent) => void
  >()

  constructor(opts: NamedBrowserSandboxOptions) {
    const names = stableNames(opts.id)
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    super(undefined, { ...BASE_ENV, ...opts.env }, timeoutMs)
    this.id = opts.id
    this.name = names.sandbox
    this.session = names.session
    this.image =
      opts.image ??
      process.env.REMOTE_AGENT_BROWSER_IMAGE ??
      DEFAULT_BROWSER_IMAGE
    this.vcpus = opts.vcpus ?? 2
  }

  private readonly onResume = async () => {
    const event: BrowserRuntimeResetEvent = {
      id: this.id,
      reason: 'resumed',
    }
    for (const listener of this.resetListeners) {
      try {
        listener(event)
      } catch {}
    }
  }

  on(
    event: 'reset',
    listener: (event: BrowserRuntimeResetEvent) => void,
  ): () => void {
    if (event !== 'reset') throw new Error(`unsupported browser event: ${event}`)
    this.resetListeners.add(listener)
    return () => this.resetListeners.delete(listener)
  }

  protected override async acquire(): Promise<Sandbox> {
    if (this.sandbox) return this.sandbox
    this.sandbox = await Sandbox.getOrCreate({
      name: this.name,
      image: this.image,
      resources: { vcpus: this.vcpus },
      timeout: this.timeoutMs,
      ports: [],
      env: this.env,
      persistent: false,
      onResume: this.onResume,
    })
    return this.sandbox
  }

  protected override async observe(): Promise<Sandbox | null> {
    try {
      const sandbox = await Sandbox.get({
        name: this.name,
        resume: false,
        onResume: this.onResume,
      })
      this.sandbox = sandbox
      return sandbox
    } catch (error) {
      if (isMissingSandbox(error)) return null
      throw error
    }
  }

  protected override async destroyRuntime(): Promise<void> {
    try {
      const sandbox =
        this.sandbox ??
        (await Sandbox.get({ name: this.name, resume: false }))
      await sandbox.delete()
      this.sandbox = undefined
    } catch (error) {
      if (!isMissingSandbox(error)) throw error
    }
  }
}

/** Create a lazy runner backed by a stable, project-scoped browser id. */
export function createNamedBrowserSandboxRunner(
  opts: NamedBrowserSandboxOptions,
): NamedSandboxRunner {
  return new NamedSandboxRunner(opts)
}

/**
 * Start an ephemeral Vercel Sandbox from the pre-built browser image.
 *
 * The image must already exist in the Sandbox project's Vercel Container
 * Registry and contain both `agent-browser` and Chromium. A repository name,
 * tag, digest, or fully-qualified VCR reference is accepted by the SDK.
 */
export async function provisionBrowserSandbox(opts: {
  image?: string
  timeoutMs?: number
  vcpus?: number
  env?: Record<string, string>
}): Promise<SandboxRunner> {
  const image =
    opts.image ?? process.env.REMOTE_AGENT_BROWSER_IMAGE ?? DEFAULT_BROWSER_IMAGE
  const env = { ...BASE_ENV, ...opts.env }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sandbox = await Sandbox.create({
    image,
    resources: { vcpus: opts.vcpus ?? 2 },
    timeout: timeoutMs,
    ports: [],
    env,
    persistent: false,
  })

  return new SandboxRunner(sandbox, env, timeoutMs)
}
