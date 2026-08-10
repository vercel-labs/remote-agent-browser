import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { AgentBrowser } from '../dist/index.js'
import { formatBytes, formatDuration, summarizeRuns } from './metrics.mjs'

const DEFAULT_URL = 'https://example.com/'
const DEFAULT_EXPECTED_TEXT = 'Example Domain'

function positiveInteger(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`)
  }
  return value
}

function benchmarkUrl(baseUrl, run, page) {
  const url = new URL(baseUrl)
  url.searchParams.set('remote_agent_browser_run', String(run))
  url.searchParams.set('page', String(page))
  return url.href
}

function checked(result, description) {
  if (result.ok) return result
  const details =
    result.stderr.trim() || result.stdout.trim() || 'unknown error'
  throw new Error(`${description} failed: ${details}`)
}

function assertBatch(result, pages, expectedText) {
  let batch
  try {
    batch = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `batch did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(batch) || batch.length !== pages * 2) {
    throw new Error(`batch returned ${batch?.length ?? 0} of ${pages * 2} results`)
  }
  for (let index = 0; index < batch.length; index += 2) {
    const navigation = batch[index]
    const snapshot = batch[index + 1]
    if (navigation?.success !== true || snapshot?.success !== true) {
      throw new Error(
        `page ${index / 2 + 1} failed: ${navigation?.error || snapshot?.error || 'unknown error'}`,
      )
    }
    if (
      typeof snapshot.result?.snapshot !== 'string' ||
      !snapshot.result.snapshot.includes(expectedText) ||
      typeof snapshot.result?.refs !== 'object' ||
      snapshot.result.refs === null ||
      Object.keys(snapshot.result.refs).length === 0
    ) {
      throw new Error(
        `page ${index / 2 + 1} snapshot was not actionable or did not contain ${JSON.stringify(expectedText)}`,
      )
    }
  }
}

const MONITOR_SCRIPT = `#!/bin/sh
peak_file=$1
stop_file=$2
peak=0

while [ ! -e "$stop_file" ]; do
  total=0
  for pid in $(ps -eo pid=,comm= | awk '$2 == "chromium" || $2 == "agent-browser" { print $1 }'); do
    pss=$(awk '/^Pss:/ { print $2 }' "/proc/$pid/smaps_rollup" 2>/dev/null)
    case "$pss" in
      ''|*[!0-9]*) pss=0 ;;
    esac
    total=$((total + pss))
  done
  if [ "$total" -gt "$peak" ]; then
    peak=$total
    echo "$peak" > "$peak_file"
  fi
  sleep 0.1
done
`

async function startMemoryMonitor(browser) {
  const id = randomUUID().replaceAll('-', '')
  const scriptPath = `/tmp/rab-benchmark-${id}.sh`
  const peakPath = `/tmp/rab-benchmark-${id}.peak-kb`
  const stopPath = `/tmp/rab-benchmark-${id}.stop`
  const encoded = Buffer.from(MONITOR_SCRIPT).toString('base64')
  const start = checked(
    await browser.shell(
      `printf '%s' '${encoded}' | base64 -d > '${scriptPath}' && chmod 700 '${scriptPath}' && nohup '${scriptPath}' '${peakPath}' '${stopPath}' >/dev/null 2>&1 & echo $!`,
    ),
    'memory monitor startup',
  )
  const pid = start.stdout.trim().split(/\s+/).at(-1)
  if (!pid || !/^\d+$/.test(pid)) {
    throw new Error(
      `memory monitor did not return a pid: ${start.stdout.trim()}`,
    )
  }

  let stopped = false
  return async () => {
    if (stopped) return 0
    stopped = true
    const stop = checked(
      await browser.shell(
        `touch '${stopPath}'; for attempt in $(seq 1 20); do kill -0 '${pid}' 2>/dev/null || break; sleep 0.05; done; cat '${peakPath}' 2>/dev/null || echo 0`,
      ),
      'memory monitor shutdown',
    )
    const peakKb = Number(stop.stdout.trim().split(/\s+/).at(-1))
    if (!Number.isFinite(peakKb) || peakKb < 0) {
      throw new Error(
        `memory monitor returned an invalid peak: ${stop.stdout.trim()}`,
      )
    }
    return peakKb * 1024
  }
}

async function browserVersions(browser) {
  const result = checked(
    await browser.shell(
      'agent-browser --version; chromium --version; uname -m; getconf _NPROCESSORS_ONLN',
    ),
    'version detection',
  )
  const [agentBrowser, chromium, architecture, processors] = result.stdout
    .trim()
    .split('\n')
  return {
    agentBrowser,
    chromium,
    architecture,
    processors: Number(processors),
  }
}

async function runOnce(config, runNumber) {
  let browser
  let stopMemoryMonitor
  let peakMemoryBytes = 0
  const startedAt = performance.now()
  let createMs = 0
  let workloadMs = 0

  try {
    const createStartedAt = performance.now()
    browser = await AgentBrowser.create({
      image: config.image,
      timeoutMs: config.sandboxTimeoutMs,
      vcpus: config.vcpus,
      session: `benchmark-${Date.now()}-${runNumber}`,
      args: ['--engine', 'chrome'],
    })
    createMs = performance.now() - createStartedAt
    const versions = await browserVersions(browser)
    stopMemoryMonitor = await startMemoryMonitor(browser)

    const commands = []
    for (let page = 1; page <= config.pages; page++) {
      commands.push(
        ['open', benchmarkUrl(config.url, runNumber, page)],
        ['snapshot', '-i'],
      )
    }
    const encodedCommands = Buffer.from(JSON.stringify(commands)).toString(
      'base64',
    )
    const workloadStartedAt = performance.now()
    const batch = checked(
      await browser.shell(
        `printf '%s' '${encodedCommands}' | base64 -d | agent-browser --engine chrome batch --json`,
        { timeoutMs: config.commandTimeoutMs },
      ),
      'page batch',
    )
    assertBatch(batch, config.pages, config.expectedText)
    workloadMs = performance.now() - workloadStartedAt
    peakMemoryBytes = await stopMemoryMonitor()
    stopMemoryMonitor = undefined
    process.stdout.write(`${'.'.repeat(config.pages)}\n`)

    return {
      run: runNumber,
      success: true,
      pagesCompleted: config.pages,
      createMs,
      workloadMs,
      executionTimeMs: createMs + workloadMs,
      wallTimeMs: performance.now() - startedAt,
      peakMemoryBytes,
      versions,
    }
  } catch (error) {
    if (stopMemoryMonitor) {
      peakMemoryBytes = await stopMemoryMonitor().catch(() => peakMemoryBytes)
    }
    process.stdout.write('\n')
    return {
      run: runNumber,
      success: false,
      pagesCompleted: 0,
      createMs,
      workloadMs,
      executionTimeMs: createMs + workloadMs,
      wallTimeMs: performance.now() - startedAt,
      peakMemoryBytes,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function main() {
  if (process.env.RUN_BENCHMARK !== '1') {
    throw new Error(
      'This benchmark creates billable Vercel Sandboxes. Re-run with RUN_BENCHMARK=1.',
    )
  }

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const config = {
    pages: positiveInteger('BENCHMARK_PAGES', 100),
    runs: positiveInteger('BENCHMARK_RUNS', 1),
    vcpus: positiveInteger('BENCHMARK_VCPUS', 2),
    commandTimeoutMs: positiveInteger(
      'BENCHMARK_COMMAND_TIMEOUT_MS',
      5 * 60 * 1000,
    ),
    sandboxTimeoutMs: positiveInteger(
      'BENCHMARK_SANDBOX_TIMEOUT_MS',
      10 * 60 * 1000,
    ),
    url: process.env.BENCHMARK_URL ?? DEFAULT_URL,
    expectedText: process.env.BENCHMARK_EXPECTED_TEXT ?? DEFAULT_EXPECTED_TEXT,
    image: process.env.REMOTE_AGENT_BROWSER_IMAGE,
  }

  console.log(
    `Chromium benchmark: ${config.pages} page loads, ${config.runs} run(s), ${config.vcpus} vCPUs`,
  )
  console.log(`Fixture: ${config.url}`)

  const runs = []
  for (let run = 1; run <= config.runs; run++) {
    process.stdout.write(`Run ${run}/${config.runs} `)
    const result = await runOnce(config, run)
    runs.push(result)
    if (!result.success) console.error(result.error)
  }

  const summary = summarizeRuns(runs)
  const timestamp = new Date().toISOString()
  const report = {
    schemaVersion: 1,
    benchmark: 'chromium-page-loads',
    timestamp,
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    config: {
      ...config,
      image: config.image ?? 'remote-agent-browser:latest',
    },
    runs,
    summary,
  }

  const defaultOutput = resolve(
    'benchmarks/results',
    `chromium-${timestamp.replaceAll(':', '-')}.json`,
  )
  const output = resolve(process.env.BENCHMARK_OUTPUT ?? defaultOutput)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)

  console.log('\nMetric\tResult')
  console.log(
    `Execution time (${config.pages} pages)\t${formatDuration(summary.executionTimeMs.median)}`,
  )
  console.log(
    `Memory (peak, ${config.pages} pages)\t${formatBytes(summary.peakMemoryBytes.max)} PSS`,
  )
  console.log(`Successful runs\t${summary.successfulRuns}/${config.runs}`)
  console.log(`Raw result\t${output}`)

  if (summary.failedRuns > 0) process.exitCode = 1
}

await main()
