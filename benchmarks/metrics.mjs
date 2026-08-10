export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function summarizeRuns(runs) {
  const successful = runs.filter((run) => run.success)
  const durations = successful.map((run) => run.executionTimeMs)
  const memory = successful.map((run) => run.peakMemoryBytes)

  return {
    successfulRuns: successful.length,
    failedRuns: runs.length - successful.length,
    executionTimeMs: {
      median: median(durations),
      min: durations.length === 0 ? null : Math.min(...durations),
      max: durations.length === 0 ? null : Math.max(...durations),
    },
    peakMemoryBytes: {
      median: median(memory),
      max: memory.length === 0 ? null : Math.max(...memory),
    },
  }
}

export function formatDuration(milliseconds) {
  if (milliseconds === null) return 'n/a'
  return `${(milliseconds / 1000).toFixed(2)}s`
}

export function formatBytes(bytes) {
  if (bytes === null) return 'n/a'
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
