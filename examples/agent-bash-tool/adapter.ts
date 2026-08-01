import {
  AgentBrowser,
  type BrowserCommandResult,
} from 'remote-agent-browser'

const browsers = new Map<string, Promise<AgentBrowser>>()

function getBrowser(agentSessionId: string): Promise<AgentBrowser> {
  const existing = browsers.get(agentSessionId)
  if (existing) return existing

  const pending = AgentBrowser.create()
  browsers.set(agentSessionId, pending)
  void pending.catch(() => {
    if (browsers.get(agentSessionId) === pending) {
      browsers.delete(agentSessionId)
    }
  })
  return pending
}

export type BashResult =
  | { handled: false }
  | {
      handled: true
      stdout: string
      stderr: string
      exitCode: number
      file?: BrowserCommandResult['file']
    }

/**
 * Intercept a parsed Bash invocation before passing it to the regular Bash
 * executor. The first argument must be the executable name.
 */
export async function runBrowserCommand(
  agentSessionId: string,
  argv: string[],
): Promise<BashResult> {
  if (argv[0] !== 'agent-browser') return { handled: false }

  const [command, ...args] = argv.slice(1)
  if (!command) {
    return {
      handled: true,
      stdout: '',
      stderr: 'usage: agent-browser <command> [args...]',
      exitCode: 2,
    }
  }

  const browser = await getBrowser(agentSessionId)
  const result = await browser.exec(command, { args })

  return {
    handled: true,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1,
    file: result.file,
  }
}

/** Close the remote browser when its owning agent session ends. */
export async function closeBrowser(agentSessionId: string): Promise<void> {
  const pending = browsers.get(agentSessionId)
  browsers.delete(agentSessionId)
  if (pending) await (await pending).close()
}
