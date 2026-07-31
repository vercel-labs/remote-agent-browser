import { Sandbox } from '@vercel/sandbox'
import type { CommandRunner } from './types.js'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
export const DEFAULT_BROWSER_IMAGE = 'remote-agent-browser:latest'

const BASE_ENV = {
  AGENT_BROWSER_ARGS: '--no-sandbox,--disable-dev-shm-usage,--disable-gpu',
  AGENT_BROWSER_DEFAULT_TIMEOUT: '25000',
}

/** CommandRunner backed by one Vercel Sandbox. */
export class SandboxRunner implements CommandRunner {
  private sandbox: Sandbox
  private env: Record<string, string>

  constructor(sandbox: Sandbox, env: Record<string, string>) {
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

  async writeFile(path: string, bytes: Buffer): Promise<void> {
    await this.sandbox.writeFiles([{ path, content: bytes }])
  }

  async close(): Promise<void> {
    await this.sandbox.stop().catch(() => {})
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
  image?: string
  timeoutMs?: number
  vcpus?: number
  env?: Record<string, string>
}): Promise<SandboxRunner> {
  const image =
    opts.image ?? process.env.REMOTE_AGENT_BROWSER_IMAGE ?? DEFAULT_BROWSER_IMAGE
  const env = { ...BASE_ENV, ...opts.env }
  const sandbox = await Sandbox.create({
    image,
    resources: { vcpus: opts.vcpus ?? 2 },
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ports: [],
    env,
    persistent: false,
  })

  return new SandboxRunner(sandbox, env)
}
