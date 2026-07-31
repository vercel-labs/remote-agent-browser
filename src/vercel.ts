import type { CommandRunner } from './types.js'

/** Minimal shape of a @vercel/sandbox Command we rely on. */
export interface SandboxCommandLike {
  wait(): Promise<{ exitCode: number } | number>
  output(stream?: 'stdout' | 'stderr'): Promise<string>
  kill(): Promise<void>
}

/** Minimal shape of a @vercel/sandbox Sandbox we rely on. */
export interface SandboxLike {
  sandboxId: string
  status: string
  runCommand(opts: {
    cmd: string
    args?: string[]
    env?: Record<string, string>
    detached?: boolean
  }): Promise<SandboxCommandLike>
  stop(): Promise<unknown>
}

/** The small, injectable part of the Sandbox SDK used by this package. */
export type SandboxFactory = {
  create(opts: {
    image: string
    resources?: { vcpus: number }
    timeout?: number
    ports?: number[]
    env?: Record<string, string>
    /** Browser Sandboxes are disposable by default, avoiding snapshot storage. */
    persistent?: boolean
  }): Promise<SandboxLike>
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_BROWSER_IMAGE = 'remote-agent-browser:latest'

const BASE_ENV = {
  AGENT_BROWSER_ARGS: '--no-sandbox,--disable-dev-shm-usage,--disable-gpu',
  AGENT_BROWSER_DEFAULT_TIMEOUT: '25000',
}

/** CommandRunner backed by one Vercel Sandbox. */
export class SandboxRunner implements CommandRunner {
  private sandbox: SandboxLike
  private env: Record<string, string>

  constructor(sandbox: SandboxLike, env: Record<string, string>) {
    this.sandbox = sandbox
    this.env = env
  }

  async run(
    cmd: string,
    args: string[],
    opts: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const timeoutMs = opts.timeoutMs ?? 60_000
    const command = await this.sandbox.runCommand({
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

  async close(): Promise<void> {
    await this.sandbox.stop().catch(() => {})
  }

  get sandboxId(): string {
    return this.sandbox.sandboxId
  }
}

/**
 * Start an ephemeral Vercel Sandbox from the pre-built browser image.
 *
 * The image must already exist in the Sandbox project's Vercel Container
 * Registry and contain both `agent-browser` and Chromium. A repository name,
 * tag, digest, or fully-qualified VCR reference is accepted by the SDK.
 */
export async function provisionBrowserSandbox(opts: {
  sandbox?: SandboxFactory
  image?: string
  timeoutMs?: number
  vcpus?: number
  env?: Record<string, string>
}): Promise<SandboxRunner> {
  const factory =
    opts.sandbox ??
    ((await import('@vercel/sandbox')) as unknown as { Sandbox: SandboxFactory })
      .Sandbox
  const image =
    opts.image ?? process.env.REMOTE_AGENT_BROWSER_IMAGE ?? DEFAULT_BROWSER_IMAGE
  const env = { ...BASE_ENV, ...opts.env }
  const sandbox = await factory.create({
    image,
    resources: { vcpus: opts.vcpus ?? 2 },
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ports: [],
    env,
    persistent: false,
  })

  return new SandboxRunner(sandbox, env)
}
