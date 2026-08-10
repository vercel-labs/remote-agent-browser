import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatBytes,
  formatDuration,
  median,
  summarizeRuns,
} from '../benchmarks/metrics.mjs'

test('median handles odd and even samples without mutating input', () => {
  const values = [9, 1, 5, 3]
  assert.equal(median(values), 4)
  assert.deepEqual(values, [9, 1, 5, 3])
  assert.equal(median([7, 1, 3]), 3)
  assert.equal(median([]), null)
})

test('summarizeRuns keeps failures visible and excludes them from metrics', () => {
  assert.deepEqual(
    summarizeRuns([
      { success: true, executionTimeMs: 1_000, peakMemoryBytes: 10 },
      { success: false, executionTimeMs: 50, peakMemoryBytes: 1 },
      { success: true, executionTimeMs: 3_000, peakMemoryBytes: 30 },
    ]),
    {
      successfulRuns: 2,
      failedRuns: 1,
      executionTimeMs: { median: 2_000, min: 1_000, max: 3_000 },
      peakMemoryBytes: { median: 20, max: 30 },
    },
  )
})

test('formatters produce README-friendly values', () => {
  assert.equal(formatDuration(12_345), '12.35s')
  assert.equal(formatDuration(null), 'n/a')
  assert.equal(formatBytes(128 * 1024 * 1024), '128.0MB')
  assert.equal(formatBytes(null), 'n/a')
})
