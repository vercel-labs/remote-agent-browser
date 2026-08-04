import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(
  new URL('../scripts/publish-image.sh', import.meta.url),
)

describe('publish-image.sh', () => {
  it('documents support for multiple image tags', () => {
    const result = spawnSync(script, ['--help'], { encoding: 'utf8' })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /\[tag \.\.\.\]/)
  })

  it('rejects an invalid image tag before accessing credentials', () => {
    const result = spawnSync(script, ['valid', 'not/valid'], {
      encoding: 'utf8',
    })

    assert.equal(result.status, 2)
    assert.match(result.stderr, /Invalid Docker image tag: not\/valid/)
  })
})
