# Chromium benchmark

The benchmark measures execution time and peak memory for a repeated Chromium
workload running through `remote-agent-browser` in Vercel Sandbox.

## Workload

Each run creates a fresh two-vCPU Sandbox from the configured browser image.
The runner builds 100 pairs of commands:

1. Open `https://example.com/` with a unique query string.
2. Return an interactive accessibility snapshot.

The commands run through one `AgentBrowser.shell()` call using
`agent-browser batch`. Keeping one controller connection open measures browser
throughput without adding a Sandbox API round trip for every command.

Every batch result is parsed. Each navigation must succeed, and every snapshot
must contain `Example Domain` and at least one interactive element reference.
A fast but incomplete result therefore fails the run.

## Metrics

**Execution time** is measured by the calling Node.js process. It combines
Sandbox creation time with the complete 100-page batch. Version detection,
memory-monitor setup, result serialization, and cleanup are not included.

**Peak memory** is the proportional set size (PSS) of all Chromium and
agent-browser processes in the Sandbox. A background monitor reads
`/proc/<pid>/smaps_rollup` every 100ms and retains the largest combined sample.
PSS accounts proportionally for shared pages and is more representative than
summing resident set size across Chromium's processes.

For multiple successful runs, the report uses median execution time and maximum
peak memory. Failed runs remain in the result and cause the command to exit
nonzero; they are not included in the performance aggregation.

## Output

The runner prints the two metrics and writes a timestamped JSON report under
`benchmarks/results/`. The report records configuration, package and browser
versions, individual timings, success counts, and failures. Generated results
are ignored by Git.

## Running it

The benchmark creates billable Vercel Sandboxes and requires an authenticated,
linked project:

```bash
vercel env pull .env.local
set -a; source .env.local; set +a
RUN_BENCHMARK=1 BENCHMARK_RUNS=3 pnpm benchmark
```

One run and 100 pages are the defaults. The workload can be configured with
`BENCHMARK_RUNS`, `BENCHMARK_PAGES`, `BENCHMARK_VCPUS`, `BENCHMARK_URL`,
`BENCHMARK_EXPECTED_TEXT`, `BENCHMARK_COMMAND_TIMEOUT_MS`, and
`BENCHMARK_SANDBOX_TIMEOUT_MS`. When changing the fixture URL, also set the
expected text used by the correctness assertion.
