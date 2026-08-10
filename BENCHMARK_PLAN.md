# Chromium performance benchmark plan

## Goal

Give users a compact, reproducible view of `remote-agent-browser` performance
using the same general metrics highlighted by Lightpanda: execution time and
peak memory for a repeated page workload.

The first version benchmarks Chromium only. It does not compare browser engines
or include LLM latency.

## Workload

Each run creates a fresh two-vCPU Vercel Sandbox, then uses the public
`AgentBrowser.shell()` API and `agent-browser batch` to load and snapshot
`https://example.com/` 100 times through one controller invocation. Every
iteration asserts that the snapshot contains the expected content and
interactive element references.

The query string changes for each navigation so the document is requested each
time while the browser remains in one realistic, stateful session.

## Published metrics

1. **Execution time (100 pages):** Sandbox creation plus all 100 successful
   open and snapshot operations, measured by the calling Node.js process.
2. **Memory (peak, 100 pages):** peak proportional set size (PSS) of Chromium
   and agent-browser processes, sampled every 100ms inside the Sandbox.

The raw result also retains setup and workload timings, versions, configuration,
successes, and failures. These support diagnosis without expanding the public
README table.

## Reproduction

The benchmark is billable and intentionally excluded from ordinary tests and
CI:

```bash
set -a; source .env.local; set +a
RUN_BENCHMARK=1 pnpm benchmark
```

`BENCHMARK_PAGES`, `BENCHMARK_RUNS`, `BENCHMARK_VCPUS`, `BENCHMARK_URL`, and
the timeout environment variables can override the documented defaults.
Timestamped raw JSON results are written under the ignored
`benchmarks/results/` directory.

## Delivery

1. Implement the guarded benchmark runner and PSS sampler.
2. Unit test result aggregation and display formatting.
3. Smoke test against a small page count.
4. Run the full 100-page workload.
5. Add the measured two-row table and methodology to the README.

The published baseline uses three successful runs. Execution time is reported
as their median and peak memory as the maximum observed value.
